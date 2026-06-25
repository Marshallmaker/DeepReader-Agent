"""
可视化分析 API — 趋势图（折线）和对比图（柱状）。
支持多批次、多指标的系列数据查询。
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Dict, Set
from app.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.batch import UploadBatch
from app.models.report import Report
from app.models.metric import ExtractedMetric
from app.models.metric_definition import MetricDefinition, BatchMetricRelation
from app.schemas.metric import (
    MultiSeriesDataPoint, SeriesData,
    MultiSeriesTrendResponse, MultiSeriesComparisonResponse,
)
from app.utils.anomaly_detection import detect_batch_anomalies
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


# ── 辅助函数 ──────────────────────────────────────────────

def _get_metric_signature(db: Session, batch_id: int) -> Set[str]:
    """获取批次的指标签名 — 排序后的 metric_key 集合"""
    relations = db.query(BatchMetricRelation).filter(
        BatchMetricRelation.batch_id == batch_id
    ).all()

    if relations:
        metric_def_ids = [r.metric_def_id for r in relations]
        defs = db.query(MetricDefinition).filter(
            MetricDefinition.id.in_(metric_def_ids)
        ).all()
        return {d.metric_key for d in defs}

    # 旧批次回退：系统预置指标（仅启用的）
    defs = db.query(MetricDefinition).filter(
        MetricDefinition.is_system == True,
        MetricDefinition.is_active == True
    ).all()
    return {d.metric_key for d in defs}


def _validate_compatibility(db: Session, batch_ids: List[int], current_user_id: int) -> List[MetricDefinition]:
    """
    校验所有批次的指标兼容性和归属权。
    返回共同的 MetricDefinition 列表。
    不兼容或无权访问时抛出 HTTPException。
    """
    if not batch_ids:
        raise HTTPException(status_code=422, detail="请至少选择一个批次")

    # 校验归属权 + 获取第一个批次的签名
    first_batch = db.query(UploadBatch).filter(
        UploadBatch.id == batch_ids[0],
        UploadBatch.user_id == current_user_id,
    ).first()
    if not first_batch:
        raise HTTPException(status_code=404, detail=f"批次 #{batch_ids[0]} 不存在")

    first_signature = _get_metric_signature(db, batch_ids[0])

    for bid in batch_ids[1:]:
        b = db.query(UploadBatch).filter(
            UploadBatch.id == bid,
            UploadBatch.user_id == current_user_id,
        ).first()
        if not b:
            raise HTTPException(status_code=404, detail=f"批次 #{bid} 不存在")
        sig = _get_metric_signature(db, bid)
        if sig != first_signature:
            raise HTTPException(
                status_code=422,
                detail=f"所选批次的指标集不一致，无法进行数据分析（批次 #{batch_ids[0]} 与批次 #{bid} 指标不同）"
            )

    # 获取共同的指标定义
    metric_defs = _resolve_metric_definitions(db, batch_ids[0])
    return metric_defs


def _resolve_metric_definitions(db: Session, batch_id: int) -> List[MetricDefinition]:
    """获取批次的指标定义列表"""
    relations = db.query(BatchMetricRelation).filter(
        BatchMetricRelation.batch_id == batch_id
    ).all()

    if relations:
        ids = [r.metric_def_id for r in relations]
        return db.query(MetricDefinition).filter(
            MetricDefinition.id.in_(ids)
        ).order_by(MetricDefinition.is_system.desc(), MetricDefinition.id.asc()).all()

    # 旧批次回退（仅启用的系统指标）
    return db.query(MetricDefinition).filter(
        MetricDefinition.is_system == True,
        MetricDefinition.is_active == True
    ).order_by(MetricDefinition.id.asc()).all()


def _build_fiscal_year(metric_dict: Dict[str, ExtractedMetric]) -> str:
    """从指标字典中提取活跃年度"""
    for key in ("submission_date", "repurchase_date", "fiscal_year"):
        m = metric_dict.get(key)
        if m and m.metric_value_raw:
            raw = m.metric_value_raw.strip()
            if raw:
                # 取前4位年份或前10位日期
                return raw[:10] if len(raw) >= 10 else raw
    return ""


# ── 趋势图接口 ────────────────────────────────────────────

@router.get("/trend", response_model=MultiSeriesTrendResponse)
async def get_trend_data(
    batch_ids: List[int] = Query(..., description="批次 ID 列表"),
    metric_keys: List[str] = Query(..., description="指标键名列表"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取多批次、多指标的折线图趋势数据。"""
    # 校验兼容性
    metric_defs = _validate_compatibility(db, batch_ids, current_user.id)

    # 筛选用户请求的指标
    requested_defs = [md for md in metric_defs if md.metric_key in metric_keys]
    if not requested_defs:
        raise HTTPException(status_code=422, detail="未找到有效的指标")

    # 收集所有批次的所有报告
    all_reports = db.query(Report).filter(
        Report.batch_id.in_(batch_ids)
    ).all()
    report_ids = [r.id for r in all_reports]

    # 批量加载所有指标
    all_metrics = db.query(ExtractedMetric).filter(
        ExtractedMetric.report_id.in_(report_ids)
    ).all()
    metrics_by_report: Dict[int, Dict[str, ExtractedMetric]] = {}
    for m in all_metrics:
        metrics_by_report.setdefault(m.report_id, {})[m.metric_name] = m

    # 为每个请求的 metric_key 构建一个系列
    series_list: List[SeriesData] = []

    for md in requested_defs:
        data_points: List[MultiSeriesDataPoint] = []

        for report in all_reports:
            mdict = metrics_by_report.get(report.id, {})
            m = mdict.get(md.metric_key)

            if m and m.metric_value_num is not None:
                fiscal_year = _build_fiscal_year(mdict) or str(report.created_at.year)
                data_points.append(MultiSeriesDataPoint(
                    report_id=report.id,
                    fiscal_year=fiscal_year,
                    report_name=report.original_filename,
                    entity_name=report.entity_name,
                    batch_id=report.batch_id,
                    value=float(m.metric_value_num),
                    unit=m.unit or "元",
                ))

        # 按 fiscal_year 排序
        data_points.sort(key=lambda d: d.fiscal_year)

        series_list.append(SeriesData(
            metric_key=md.metric_key,
            metric_label=md.metric_label,
            data=data_points,
        ))

    # ── 异常检测：为每个批次独立检测，然后标注数据点 ──
    unique_batch_ids = set(batch_ids)
    # {batch_id: {report_id: {metric_key: AnomalyResult}}}
    all_anomalies: Dict[int, Dict[int, dict]] = {}
    for bid in unique_batch_ids:
        try:
            all_anomalies[bid] = detect_batch_anomalies(
                db, bid, group_by="stock_code",
            )
        except Exception as e:
            logger.warning(f"异常检测失败 (batch_id={bid}): {e}")
            all_anomalies[bid] = {}

    for series in series_list:
        for dp in series.data:
            if dp.report_id is None:
                continue
            batch_anom = all_anomalies.get(dp.batch_id, {})
            report_anom = batch_anom.get(dp.report_id, {})
            ar = report_anom.get(series.metric_key)
            if ar is not None and ar.is_anomaly:
                dp.is_anomaly = True
                dp.anomaly_deviation = ar.deviation
                dp.anomaly_direction = ar.direction
                dp.anomaly_method = ar.method
                dp.anomaly_threshold = ar.threshold

    return MultiSeriesTrendResponse(
        batch_ids=batch_ids,
        series=series_list,
    )


# ── 柱状图接口 ────────────────────────────────────────────

@router.get("/comparison", response_model=MultiSeriesComparisonResponse)
async def get_comparison_data(
    batch_ids: List[int] = Query(..., description="批次 ID 列表"),
    metric_keys: List[str] = Query(..., description="指标键名列表"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取多批次、多指标的柱状图对比数据。"""
    # 校验兼容性
    metric_defs = _validate_compatibility(db, batch_ids, current_user.id)

    # 筛选用户请求的指标
    requested_defs = [md for md in metric_defs if md.metric_key in metric_keys]
    if not requested_defs:
        raise HTTPException(status_code=422, detail="未找到有效的指标")

    # 收集所有报告
    all_reports = db.query(Report).filter(
        Report.batch_id.in_(batch_ids)
    ).order_by(Report.created_at.asc()).all()
    report_ids = [r.id for r in all_reports]

    # 批量加载指标
    all_metrics = db.query(ExtractedMetric).filter(
        ExtractedMetric.report_id.in_(report_ids)
    ).all()
    metrics_by_report: Dict[int, Dict[str, ExtractedMetric]] = {}
    for m in all_metrics:
        metrics_by_report.setdefault(m.report_id, {})[m.metric_name] = m

    # 构建批次名称映射
    batch_names: Dict[int, str] = {}
    for bid in batch_ids:
        b = db.query(UploadBatch).filter(UploadBatch.id == bid).first()
        batch_names[bid] = b.batch_name or f"批次{bid}" if b else f"批次{bid}"

    # 为每个请求的 metric_key 构建一个系列
    series_list: List[SeriesData] = []

    for md in requested_defs:
        data_points: List[MultiSeriesDataPoint] = []

        for report in all_reports:
            mdict = metrics_by_report.get(report.id, {})
            m = mdict.get(md.metric_key)

            # 报告名格式：[批次名] 文件名
            report_label = f"[{batch_names.get(report.batch_id, '?')}] {report.original_filename}"

            if m and m.metric_value_num is not None:
                data_points.append(MultiSeriesDataPoint(
                    report_id=report.id,
                    report_name=report_label,
                    entity_name=report.entity_name,
                    batch_id=report.batch_id,
                    value=float(m.metric_value_num),
                    unit=m.unit or "元",
                ))
            else:
                # 无数据也占位，保证 X 轴对齐
                data_points.append(MultiSeriesDataPoint(
                    report_id=report.id,
                    report_name=report_label,
                    batch_id=report.batch_id,
                    value=None,
                ))

        series_list.append(SeriesData(
            metric_key=md.metric_key,
            metric_label=md.metric_label,
            data=data_points,
        ))

    # ── 异常检测：为每个批次独立检测，然后标注数据点 ──
    unique_batch_ids = set(batch_ids)
    all_anomalies: Dict[int, Dict[int, dict]] = {}
    for bid in unique_batch_ids:
        try:
            all_anomalies[bid] = detect_batch_anomalies(
                db, bid, group_by="stock_code",
            )
        except Exception as e:
            logger.warning(f"异常检测失败 (batch_id={bid}): {e}")
            all_anomalies[bid] = {}

    for series in series_list:
        for dp in series.data:
            if dp.report_id is None or dp.value is None:
                continue
            batch_anom = all_anomalies.get(dp.batch_id, {})
            report_anom = batch_anom.get(dp.report_id, {})
            ar = report_anom.get(series.metric_key)
            if ar is not None and ar.is_anomaly:
                dp.is_anomaly = True
                dp.anomaly_deviation = ar.deviation
                dp.anomaly_direction = ar.direction
                dp.anomaly_method = ar.method
                dp.anomaly_threshold = ar.threshold

    return MultiSeriesComparisonResponse(
        batch_ids=batch_ids,
        series=series_list,
    )
