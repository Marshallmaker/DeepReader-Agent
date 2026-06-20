"""
通用异常检测算法模块。
支持三种统计方法（中位数偏离、IQR、Z-Score）、自动选择、分组检测。
"""
import statistics
from typing import List, Dict, Optional
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.metric import ExtractedMetric
from app.models.report import Report
from app.models.metric_definition import MetricDefinition, BatchMetricRelation, ExpectedType


# ═══════════════════════════════════════════════════════════════
# 数据结构
# ═══════════════════════════════════════════════════════════════

@dataclass
class AnomalyResult:
    """单个值的异常检测结果"""
    value: float
    is_anomaly: bool
    method: str           # "median_deviation" | "iqr" | "zscore"
    threshold: float      # 本次检测使用的阈值
    deviation: float      # 偏离度（方法不同含义不同）
    direction: str        # "high" | "low" | "normal"


# ═══════════════════════════════════════════════════════════════
# 敏感度映射
# ═══════════════════════════════════════════════════════════════

SENSITIVITY_CONFIG: Dict[str, Dict[str, float]] = {
    "low": {
        "median_deviation": 0.10,   # 偏离中位数 10% 以上
        "iqr": 3.0,                  # 3.0 × IQR
        "zscore": 3.0,               # 3σ
    },
    "medium": {
        "median_deviation": 0.05,   # 偏离中位数 5% 以上
        "iqr": 1.5,                  # 1.5 × IQR（Tukey 标准）
        "zscore": 2.0,               # 2σ
    },
    "high": {
        "median_deviation": 0.03,   # 偏离中位数 3% 以上
        "iqr": 1.0,                  # 1.0 × IQR
        "zscore": 1.5,               # 1.5σ
    },
}

VALID_SENSITIVITIES = {"low", "medium", "high"}
VALID_METHODS = {"auto", "median_deviation", "iqr", "zscore"}
VALID_DIRECTIONS = {"both", "high", "low"}


# ═══════════════════════════════════════════════════════════════
# 内部工具
# ═══════════════════════════════════════════════════════════════

def _get_threshold(method: str, sensitivity: str) -> float:
    """获取指定方法和敏感度的阈值"""
    sens = SENSITIVITY_CONFIG.get(sensitivity, SENSITIVITY_CONFIG["medium"])
    return sens.get(method, 0.05)


def _compute_skew(values: List[float]) -> float:
    """
    计算样本偏度（skewness），衡量分布对称性。
    偏度绝对值 > 1 表示分布显著不对称，适合用 IQR 方法。
    """
    n = len(values)
    if n < 3:
        return 0.0
    mean_val = statistics.mean(values)
    std_val = statistics.stdev(values)
    if std_val == 0:
        return 0.0
    skew = sum(((v - mean_val) / std_val) ** 3 for v in values) * n / ((n - 1) * (n - 2))
    return skew


def _auto_select_method(values: List[float]) -> str:
    """
    根据数据特征自动选择最合适的检测方法。

    规则：
    - n < 3  → 跳过（样本不足）
    - n < 10 → median_deviation（小样本对离群值敏感，中位数更稳健）
    - |skew| > 1 → iqr（偏态分布不适合用均值和标准差）
    - 否则 → zscore（正态或近似正态分布）
    """
    n = len(values)
    if n < 3:
        return "median_deviation"
    if n < 10:
        return "median_deviation"
    skew = abs(_compute_skew(values))
    if skew > 1:
        return "iqr"
    return "zscore"


def _percentile(sorted_data: List[float], p: float) -> float:
    """计算百分位数，使用标准线性插值"""
    k = (len(sorted_data) - 1) * p
    f = int(k)
    c = k - f
    if f + 1 < len(sorted_data):
        return sorted_data[f] + c * (sorted_data[f + 1] - sorted_data[f])
    return sorted_data[f]


# ═══════════════════════════════════════════════════════════════
# 三种检测方法实现
# ═══════════════════════════════════════════════════════════════

def _detect_median_deviation(
    values: List[float],
    threshold: float,
    direction: str,
    method_name: str,
) -> List[AnomalyResult]:
    """
    中位数偏离检测：|v - median| / |median| > threshold

    适用于小样本或偏态分布。使用中位数作为中心度量，相对于 IQR
    更直观（结果以百分比表示）。
    """
    med = statistics.median(values)
    results: List[AnomalyResult] = []

    for v in values:
        if med == 0:
            deviation = 0.0 if v == 0 else float("inf")
        else:
            deviation = abs(v - med) / abs(med)

        is_anomaly = deviation > threshold

        # 判断偏离方向
        if is_anomaly:
            dir_str = "high" if v > med else "low"
        else:
            dir_str = "normal"

        # 方向过滤
        if direction == "high" and dir_str == "low":
            is_anomaly = False
            dir_str = "normal"
        elif direction == "low" and dir_str == "high":
            is_anomaly = False
            dir_str = "normal"

        results.append(AnomalyResult(
            value=v,
            is_anomaly=is_anomaly,
            method=method_name,
            threshold=threshold,
            deviation=round(deviation, 6) if deviation != float("inf") else deviation,
            direction=dir_str,
        ))

    return results


def _detect_iqr(
    values: List[float],
    threshold: float,
    direction: str,
    method_name: str,
) -> List[AnomalyResult]:
    """
    IQR（四分位距）异常检测：
    - 下界 = Q1 - threshold × IQR
    - 上界 = Q3 + threshold × IQR
    - 超出边界即为异常

    标准 Tukey 方法使用 threshold=1.5，threshold=3.0 用于极端异常。
    """
    sorted_vals = sorted(values)
    q1 = _percentile(sorted_vals, 0.25)
    q3 = _percentile(sorted_vals, 0.75)
    iqr = q3 - q1

    lower_bound = q1 - threshold * iqr
    upper_bound = q3 + threshold * iqr

    results: List[AnomalyResult] = []

    for v in values:
        if iqr == 0:
            # 所有值相同，无异常
            results.append(AnomalyResult(
                value=v, is_anomaly=False, method=method_name,
                threshold=threshold, deviation=0.0, direction="normal",
            ))
            continue

        if v < lower_bound:
            deviation = (lower_bound - v) / iqr
            is_anomaly = True
            dir_str = "low"
        elif v > upper_bound:
            deviation = (v - upper_bound) / iqr
            is_anomaly = True
            dir_str = "high"
        else:
            deviation = 0.0
            is_anomaly = False
            dir_str = "normal"

        # 方向过滤
        if direction == "high" and dir_str == "low":
            is_anomaly = False
            dir_str = "normal"
            deviation = 0.0
        elif direction == "low" and dir_str == "high":
            is_anomaly = False
            dir_str = "normal"
            deviation = 0.0

        results.append(AnomalyResult(
            value=v,
            is_anomaly=is_anomaly,
            method=method_name,
            threshold=threshold,
            deviation=round(deviation, 6),
            direction=dir_str,
        ))

    return results


def _detect_zscore(
    values: List[float],
    threshold: float,
    direction: str,
    method_name: str,
) -> List[AnomalyResult]:
    """
    Z-Score 异常检测：|v - μ| / σ > threshold

    适用于近似正态分布的大样本。threshold=2.0 对应约 95% 置信区间，
    threshold=3.0 对应约 99.7% 置信区间。
    """
    mean_val = statistics.mean(values)
    # 样本标准差（ddof=1，与 pandas std() 默认一致）
    std_val = statistics.stdev(values) if len(values) >= 2 else 0.0

    results: List[AnomalyResult] = []

    for v in values:
        if std_val == 0:
            zscore = 0.0
        else:
            zscore = abs(v - mean_val) / std_val

        is_anomaly = zscore > threshold

        if is_anomaly:
            dir_str = "high" if v > mean_val else "low"
        else:
            dir_str = "normal"

        # 方向过滤
        if direction == "high" and dir_str == "low":
            is_anomaly = False
            dir_str = "normal"
        elif direction == "low" and dir_str == "high":
            is_anomaly = False
            dir_str = "normal"

        results.append(AnomalyResult(
            value=v,
            is_anomaly=is_anomaly,
            method=method_name,
            threshold=threshold,
            deviation=round(zscore, 6),
            direction=dir_str,
        ))

    return results


# ═══════════════════════════════════════════════════════════════
# 公开 API
# ═══════════════════════════════════════════════════════════════

def detect_anomalies(
    values: List[float],
    method: str = "auto",
    sensitivity: str = "medium",
    direction: str = "both",
) -> List[AnomalyResult]:
    """
    对一组数值进行异常检测。

    Args:
        values: 待检测的数值列表
        method: 检测方法
            - "auto": 自动选择（n<10→median_deviation, |skew|>1→iqr, 否则→zscore）
            - "median_deviation": |v - median| / |median| > threshold
            - "iqr": v < Q1 - k×IQR 或 v > Q3 + k×IQR
            - "zscore": |v - μ| / σ > threshold
        sensitivity: 敏感度 "low" | "medium" | "high"
        direction: 检测方向 "both" | "high"（仅偏高） | "low"（仅偏低）

    Returns:
        AnomalyResult 列表，与输入顺序一一对应。

    Raises:
        ValueError: 参数无效时
    """
    # 参数校验
    if method not in VALID_METHODS:
        raise ValueError(f"无效的检测方法: {method}，支持: {sorted(VALID_METHODS)}")
    if sensitivity not in VALID_SENSITIVITIES:
        raise ValueError(f"无效的敏感度: {sensitivity}，支持: {sorted(VALID_SENSITIVITIES)}")
    if direction not in VALID_DIRECTIONS:
        raise ValueError(f"无效的检测方向: {direction}，支持: {sorted(VALID_DIRECTIONS)}")

    # 空列表直接返回
    if not values:
        return []

    # 样本过少：全部标记为正常
    if len(values) < 3:
        return [
            AnomalyResult(
                value=v, is_anomaly=False, method=method,
                threshold=0.0, deviation=0.0, direction="normal",
            )
            for v in values
        ]

    # 自动选择方法
    actual_method = _auto_select_method(values) if method == "auto" else method
    threshold = _get_threshold(actual_method, sensitivity)

    if actual_method == "median_deviation":
        return _detect_median_deviation(values, threshold, direction, actual_method)
    elif actual_method == "iqr":
        return _detect_iqr(values, threshold, direction, actual_method)
    elif actual_method == "zscore":
        return _detect_zscore(values, threshold, direction, actual_method)
    else:
        raise ValueError(f"未知的检测方法: {actual_method}")


def detect_batch_anomalies(
    db: Session,
    batch_id: int,
    group_by: Optional[str] = None,
    method: str = "auto",
    sensitivity: str = "medium",
    direction: str = "both",
) -> Dict[int, Dict[str, AnomalyResult]]:
    """
    检测批次中所有报告的异常指标。

    自动发现批次绑定的 NUMERIC 型指标，对每个指标在同一组报告内
    运行统计异常检测，返回异常结果字典。

    Args:
        db: 数据库会话
        batch_id: 批次 ID
        group_by: 分组字段
            - None: 不分组，批次内所有报告直接比较
            - "stock_code": 按股票代码分组后组内检测
            - "entity_name": 按公司名称分组后组内检测
        method: 检测方法（同 detect_anomalies）
        sensitivity: 敏感度（同 detect_anomalies）
        direction: 检测方向（同 detect_anomalies）

    Returns:
        {report_id: {metric_key: AnomalyResult}}
        仅包含检测到异常的报告和指标，正常值不出现在结果中。
    """
    # ── 获取批次绑定的 NUMERIC 指标定义 ──
    relations = db.query(BatchMetricRelation).filter(
        BatchMetricRelation.batch_id == batch_id
    ).all()

    if relations:
        metric_def_ids = [r.metric_def_id for r in relations]
        metric_defs = db.query(MetricDefinition).filter(
            MetricDefinition.id.in_(metric_def_ids),
            MetricDefinition.expected_type == ExpectedType.NUMERIC,
        ).all()
    else:
        # 旧批次回退：使用系统预置指标
        metric_defs = db.query(MetricDefinition).filter(
            MetricDefinition.is_system == True,
            MetricDefinition.expected_type == ExpectedType.NUMERIC,
        ).all()

    numeric_metric_keys = {md.metric_key for md in metric_defs}
    if not numeric_metric_keys:
        return {}

    # ── 获取所有报告 ──
    reports = db.query(Report).filter(Report.batch_id == batch_id).all()
    if not reports:
        return {}

    report_ids = [r.id for r in reports]

    # ── 批量加载指标 ──
    all_metrics = db.query(ExtractedMetric).filter(
        ExtractedMetric.report_id.in_(report_ids)
    ).all()

    # 按 report_id 分组指标
    metrics_by_report: Dict[int, Dict[str, ExtractedMetric]] = {}
    for m in all_metrics:
        metrics_by_report.setdefault(m.report_id, {})[m.metric_name] = m

    # ── 辅助函数：安全获取指标值 ──
    def _get_num(rid: int, metric_key: str) -> Optional[float]:
        d = metrics_by_report.get(rid, {})
        m = d.get(metric_key)
        if m and m.metric_value_num is not None:
            return float(m.metric_value_num)
        return None

    def _get_raw(rid: int, metric_key: str) -> str:
        d = metrics_by_report.get(rid, {})
        m = d.get(metric_key)
        return m.metric_value_raw if m else "unknown"

    # ── 分组 ──
    if group_by == "stock_code":
        groups: Dict[str, List[int]] = {}
        for r in reports:
            code = _get_raw(r.id, "stock_code")
            key = code if code and code != "unknown" else f"__unknown_{r.id}"
            groups.setdefault(key, []).append(r.id)
    elif group_by == "entity_name":
        groups: Dict[str, List[int]] = {}
        for r in reports:
            name = r.entity_name or f"__unknown_{r.id}"
            groups.setdefault(name, []).append(r.id)
    else:
        # 不分组：所有报告作为一组
        groups = {"__all__": [r.id for r in reports]}

    # ── 组内检测 ──
    results: Dict[int, Dict[str, AnomalyResult]] = {}

    for _group_key, group_report_ids in groups.items():
        if len(group_report_ids) < 3:
            # 小样本边界防护：N < 3 时跳过该组
            continue

        for metric_key in numeric_metric_keys:
            # 收集该组内该指标的所有 (report_id, value) 对
            report_value_pairs: List[tuple] = []
            for rid in group_report_ids:
                val = _get_num(rid, metric_key)
                if val is not None:
                    report_value_pairs.append((rid, val))

            values = [v for _, v in report_value_pairs]
            if len(values) < 3:
                continue

            # 运行检测
            try:
                anomaly_results = detect_anomalies(
                    values, method=method, sensitivity=sensitivity, direction=direction,
                )
            except Exception:
                # 检测容错：单个指标的失败不影响其他指标
                continue

            # 回填结果（仅写入异常项）
            for (rid, _val), ar in zip(report_value_pairs, anomaly_results):
                if ar.is_anomaly:
                    results.setdefault(rid, {})[metric_key] = ar

    return results
