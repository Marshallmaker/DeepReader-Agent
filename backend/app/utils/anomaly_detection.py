"""
异常检测算法模块。
实现价格偏离度检测和吞吐量异动检测。
"""
from sqlalchemy.orm import Session
from app.models.metric import ExtractedMetric
from app.models.report import Report
from statistics import median, mean
from typing import List, Dict, Optional, Tuple


def detect_anomalies(db: Session, batch_id: int) -> Dict[int, Dict[str, str]]:
    """
    检测批次中所有报告的异常指标。

    功能说明：
    - 价格价差异常：当前文件的 highest_price_paid 或 lowest_price_paid 偏离同批次同股票中位数的 ±5% 以上
    - 吞吐量异动：单日购回数量或付出总额超过同批次同股票其他报告均值的 200% 以上
    - 小样本边界防护：同一股票报告数 N < 3 时跳过检测

    Args:
        db: 数据库会话
        batch_id: 批次 ID

    Returns:
        异常检测结果字典，key 为 report_id，value 为异常详情
    """
    results = {}

    # 获取批次中所有报告
    reports = db.query(Report).filter(Report.batch_id == batch_id).all()

    if not reports:
        return results

    report_ids = [r.id for r in reports]

    # 批量加载所有指标（一次查询替代 N 次查询）
    all_metrics = db.query(ExtractedMetric).filter(
        ExtractedMetric.report_id.in_(report_ids)
    ).all()

    # 按 report_id 分组指标
    metrics_by_report: Dict[int, Dict[str, ExtractedMetric]] = {}
    for m in all_metrics:
        if m.report_id not in metrics_by_report:
            metrics_by_report[m.report_id] = {}
        metrics_by_report[m.report_id][m.metric_name] = m

    # 辅助函数：安全获取指标值（转为 float 避免 Decimal 与 float 运算冲突）
    def _get_metric(report_id: int, name: str):
        d = metrics_by_report.get(report_id, {})
        m = d.get(name)
        return float(m.metric_value_num) if m and m.metric_value_num is not None else None

    def _get_metric_raw(report_id: int, name: str) -> str:
        d = metrics_by_report.get(report_id, {})
        m = d.get(name)
        return m.metric_value_raw if m else "unknown"

    # 按股票代码分组
    stock_groups: Dict[str, list] = {}
    for report in reports:
        stock_code = _get_metric_raw(report.id, "stock_code")
        if stock_code not in stock_groups:
            stock_groups[stock_code] = []
        stock_groups[stock_code].append(report)

    # 对每个股票组进行异常检测
    for stock_code, stock_reports in stock_groups.items():
        # 小样本边界防护：N < 3 时跳过检测
        if len(stock_reports) < 3:
            continue

        # 构建价格数据
        price_data = [
            {
                "report_id": r.id,
                "highest": _get_metric(r.id, "highest_price_paid"),
                "lowest": _get_metric(r.id, "lowest_price_paid"),
            }
            for r in stock_reports
        ]

        # 检测价格异常
        price_anomalies = _detect_price_anomalies(price_data)

        # 构建吞吐量数据
        volume_data = [
            {
                "report_id": r.id,
                "shares": _get_metric(r.id, "shares_repurchased"),
                "total": _get_metric(r.id, "total_consideration"),
            }
            for r in stock_reports
        ]

        # 检测吞吐量异常
        volume_anomalies = _detect_volume_anomalies(volume_data)

        # 合并异常结果
        for report_id, anomalies in price_anomalies.items():
            results.setdefault(report_id, {}).update(anomalies)

        for report_id, anomalies in volume_anomalies.items():
            results.setdefault(report_id, {}).update(anomalies)

    return results


def _detect_price_anomalies(price_data: List[Dict]) -> Dict[int, Dict[str, str]]:
    """
    检测价格异常：偏离中位数 ±5% 以上。
    
    Args:
        price_data: 价格数据列表
        
    Returns:
        异常检测结果
    """
    results = {}
    
    # 过滤有效数据
    valid_high = [d["highest"] for d in price_data if d["highest"] is not None]
    valid_low = [d["lowest"] for d in price_data if d["lowest"] is not None]
    
    if not valid_high or not valid_low:
        return results
    
    # 计算中位数（确保转为 float 避免 Decimal 类型冲突）
    high_median = float(median(valid_high))
    low_median = float(median(valid_low))

    # 计算阈值（±5%）
    high_upper_threshold = high_median * 1.05
    high_lower_threshold = high_median * 0.95
    low_upper_threshold = low_median * 1.05
    low_lower_threshold = low_median * 0.95
    
    # 检测每个报告
    for data in price_data:
        report_id = data["report_id"]
        highest = data["highest"]
        lowest = data["lowest"]
        
        anomalies = {}
        
        if highest is not None:
            if highest > high_upper_threshold:
                anomalies["highest_price_paid"] = "high"  # 高于中位数5%以上
            elif highest < high_lower_threshold:
                anomalies["highest_price_paid"] = "low"   # 低于中位数5%以上
        
        if lowest is not None:
            if lowest > low_upper_threshold:
                anomalies["lowest_price_paid"] = "high"
            elif lowest < low_lower_threshold:
                anomalies["lowest_price_paid"] = "low"
        
        if anomalies:
            results[report_id] = anomalies
    
    return results


def _detect_volume_anomalies(volume_data: List[Dict]) -> Dict[int, Dict[str, str]]:
    """
    检测吞吐量异常：超过其他报告均值的 200% 以上。
    
    Args:
        volume_data: 吞吐量数据列表
        
    Returns:
        异常检测结果
    """
    results = {}
    
    # 检测每个报告
    for i, data in enumerate(volume_data):
        report_id = data["report_id"]
        shares = data["shares"]
        total = data["total"]
        
        # 获取其他报告的数据（排除当前报告）
        other_shares = [
            volume_data[j]["shares"] 
            for j in range(len(volume_data)) 
            if j != i and volume_data[j]["shares"] is not None
        ]
        other_totals = [
            volume_data[j]["total"] 
            for j in range(len(volume_data)) 
            if j != i and volume_data[j]["total"] is not None
        ]
        
        anomalies = {}
        
        # 检测购回数量异常
        if shares is not None and other_shares:
            other_mean = float(mean(other_shares))
            threshold = other_mean * 2.0  # 200%
            if shares > threshold:
                anomalies["shares_repurchased"] = "high"

        # 检测付出总额异常
        if total is not None and other_totals:
            other_mean = float(mean(other_totals))
            threshold = other_mean * 2.0  # 200%
            if total > threshold:
                anomalies["total_consideration"] = "high"
        
        if anomalies:
            results[report_id] = anomalies
    
    return results


def get_anomaly_status(anomaly_type: str) -> str:
    """
    获取异常状态描述。
    
    Args:
        anomaly_type: 异常类型（high/low）
        
    Returns:
        状态描述
    """
    if anomaly_type == "high":
        return "高于正常范围"
    elif anomaly_type == "low":
        return "低于正常范围"
    return "正常"
