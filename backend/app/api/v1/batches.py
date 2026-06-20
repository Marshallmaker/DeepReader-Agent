"""
Batch management API endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import List, Dict, Optional, Set
from app.database import get_db
from app.api.dependencies import get_current_user, get_current_admin_user
from app.models.user import User
from app.models.batch import UploadBatch, BatchStatus
from app.models.report import Report, ReportStatus
from app.models.metric import ExtractedMetric
from app.models.metric_definition import MetricDefinition, BatchMetricRelation
from app.schemas.batch import BatchResponse, BatchListResponse, BatchDetailResponse, ReportSummary
from app.schemas.metric import MetricColumnDef, ReportCompareItem, MetricMatrixResponse, MetricTagInfo
from app.utils.anomaly_detection import detect_batch_anomalies
from app.utils.file import delete_upload_file
import logging


class BatchRenameRequest(BaseModel):
    """Batch rename request."""
    batch_name: str = Field(..., min_length=1, max_length=255, description="New batch name")

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("", response_model=BatchListResponse)
async def get_batches(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(10, ge=1, le=100, description="Items per page"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get paginated list of user's upload batches.
    """
    # Calculate offset
    offset = (page - 1) * page_size

    # Query total count
    total = db.query(UploadBatch).filter(UploadBatch.user_id == current_user.id).count()

    # Query batches with pagination
    batches = db.query(UploadBatch).filter(
        UploadBatch.user_id == current_user.id
    ).order_by(UploadBatch.created_at.desc()).offset(offset).limit(page_size).all()

    # 批量加载指标绑定关系（一次查询，避免 N+1）
    batch_ids = [b.id for b in batches]
    metric_tags_map: Dict[int, list] = {}

    if batch_ids:
        all_relations = db.query(BatchMetricRelation).filter(
            BatchMetricRelation.batch_id.in_(batch_ids)
        ).all()
        all_metric_def_ids = list(set(r.metric_def_id for r in all_relations))
        all_metric_defs = db.query(MetricDefinition).filter(
            MetricDefinition.id.in_(all_metric_def_ids)
        ).all() if all_metric_def_ids else []
        metric_def_map = {md.id: md for md in all_metric_defs}

        # 按批次分组
        relations_by_batch: Dict[int, list] = {}
        for r in all_relations:
            relations_by_batch.setdefault(r.batch_id, []).append(r)

        for batch in batches:
            tags = []
            for rel in relations_by_batch.get(batch.id, []):
                md = metric_def_map.get(rel.metric_def_id)
                if md:
                    tags.append(MetricTagInfo(
                        metric_key=md.metric_key,
                        metric_label=md.metric_label,
                        expected_type=md.expected_type.value,
                    ))
            metric_tags_map[batch.id] = tags

    # 处理旧批次（无 BatchMetricRelation）：回退系统指标
    for batch in batches:
        if batch.id not in metric_tags_map:
            # 旧批次回退
            sys_defs = db.query(MetricDefinition).filter(
                MetricDefinition.is_system == True
            ).all()
            metric_tags_map[batch.id] = [
                MetricTagInfo(
                    metric_key=md.metric_key,
                    metric_label=md.metric_label,
                    expected_type=md.expected_type.value,
                )
                for md in sys_defs
            ]

    # Convert to response
    items = [
        BatchResponse(
            batch_id=batch.id,
            batch_name=batch.batch_name,
            status=batch.status.value,
            total_files=batch.total_files,
            processed_files=batch.processed_files,
            created_at=batch.created_at,
            metric_tags=metric_tags_map.get(batch.id, []),
        )
        for batch in batches
    ]

    return BatchListResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=items
    )


# ── 辅助函数 ──────────────────────────────────────────────

def _get_batch_metric_signature(db: Session, batch_id: int) -> Set[str]:
    """获取批次的指标签名 — metric_key 集合"""
    relations = db.query(BatchMetricRelation).filter(
        BatchMetricRelation.batch_id == batch_id
    ).all()
    if relations:
        ids = [r.metric_def_id for r in relations]
        defs = db.query(MetricDefinition).filter(MetricDefinition.id.in_(ids)).all()
        return {d.metric_key for d in defs}
    # 旧批次回退
    defs = db.query(MetricDefinition).filter(MetricDefinition.is_system == True).all()
    return {d.metric_key for d in defs}


class CompatibleCheckResponse(BaseModel):
    """批次兼容性校验响应"""
    compatible: bool
    common_metrics: list = []      # list of MetricTagInfo
    incompatible_batches: list[int] = []


class BatchMetricBindRequest(BaseModel):
    """批次指标绑定请求"""
    metric_ids: List[int] = Field(..., min_length=1, description="指标定义 ID 列表")


@router.get("/compatible")
async def check_compatibility(
    batch_ids: List[int] = Query(..., description="批次 ID 列表"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """校验所选批次是否有相同的指标集，可用于跨批次分析。"""
    if not batch_ids or len(batch_ids) < 2:
        return CompatibleCheckResponse(
            compatible=len(batch_ids) == 1,
            common_metrics=[],
            incompatible_batches=[],
        )

    first_sig = _get_batch_metric_signature(db, batch_ids[0])
    incompatible: list[int] = []

    for bid in batch_ids[1:]:
        sig = _get_batch_metric_signature(db, bid)
        if sig != first_sig:
            incompatible.append(bid)

    compatible = len(incompatible) == 0

    # 获取共同指标标签
    common_metrics = []
    if compatible:
        # 取第一个批次的指标
        relations = db.query(BatchMetricRelation).filter(
            BatchMetricRelation.batch_id == batch_ids[0]
        ).all()
        if relations:
            ids = [r.metric_def_id for r in relations]
            defs = db.query(MetricDefinition).filter(MetricDefinition.id.in_(ids)).order_by(
                MetricDefinition.is_system.desc(), MetricDefinition.id.asc()
            ).all()
        else:
            defs = db.query(MetricDefinition).filter(MetricDefinition.is_system == True).order_by(
                MetricDefinition.id.asc()
            ).all()
        common_metrics = [
            {"metric_key": d.metric_key, "metric_label": d.metric_label, "expected_type": d.expected_type.value}
            for d in defs
        ]

    return CompatibleCheckResponse(
        compatible=compatible,
        common_metrics=common_metrics,
        incompatible_batches=incompatible,
    )


@router.put("/{batch_id}/metrics")
async def update_batch_metrics(
    batch_id: int,
    bind_data: BatchMetricBindRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """更新批次的指标绑定。删除旧绑定，写入新绑定。"""
    # 校验批次存在 + 归属权
    batch = db.query(UploadBatch).filter(
        UploadBatch.id == batch_id,
        UploadBatch.user_id == current_user.id,
    ).first()

    if not batch:
        raise HTTPException(status_code=404, detail="批次不存在")

    # 校验所有 metric_ids 有效
    existing_defs = db.query(MetricDefinition).filter(
        MetricDefinition.id.in_(bind_data.metric_ids)
    ).all()
    existing_ids = {d.id for d in existing_defs}
    invalid_ids = set(bind_data.metric_ids) - existing_ids
    if invalid_ids:
        raise HTTPException(
            status_code=422,
            detail=f"无效的指标 ID: {sorted(invalid_ids)}"
        )

    # 删除旧绑定
    db.query(BatchMetricRelation).filter(
        BatchMetricRelation.batch_id == batch_id
    ).delete()

    # 写入新绑定
    for metric_def_id in bind_data.metric_ids:
        relation = BatchMetricRelation(
            batch_id=batch_id,
            metric_def_id=metric_def_id,
        )
        db.add(relation)

    db.commit()

    return {
        "message": "批次指标已更新（历史数据不变，建议重新上传文件以匹配新指标集）",
        "batch_id": batch_id,
        "metric_count": len(bind_data.metric_ids),
    }


@router.get("/{batch_id}", response_model=BatchDetailResponse)
async def get_batch_detail(
    batch_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get detailed information about a specific batch including all reports.
    """
    # Query batch
    batch = db.query(UploadBatch).filter(
        UploadBatch.id == batch_id,
        UploadBatch.user_id == current_user.id
    ).first()

    if not batch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="批次不存在"
        )

    # 查询批次绑定的指标标签
    relations = db.query(BatchMetricRelation).filter(
        BatchMetricRelation.batch_id == batch_id
    ).all()

    if relations:
        metric_def_ids = [r.metric_def_id for r in relations]
        metric_defs = db.query(MetricDefinition).filter(
            MetricDefinition.id.in_(metric_def_ids)
        ).order_by(MetricDefinition.is_system.desc(), MetricDefinition.id.asc()).all()
    else:
        # 旧批次回退系统指标
        metric_defs = db.query(MetricDefinition).filter(
            MetricDefinition.is_system == True
        ).order_by(MetricDefinition.id.asc()).all()

    metric_tags = [
        MetricTagInfo(
            metric_key=md.metric_key,
            metric_label=md.metric_label,
            expected_type=md.expected_type.value,
        )
        for md in metric_defs
    ]

    # Query reports
    reports = db.query(Report).filter(Report.batch_id == batch_id).all()

    report_summaries = [
        ReportSummary(
            id=report.id,
            original_filename=report.original_filename,
            status=report.status.value,
            created_at=report.created_at
        )
        for report in reports
    ]

    return BatchDetailResponse(
        batch_id=batch.id,
        batch_name=batch.batch_name,
        status=batch.status.value,
        total_files=batch.total_files,
        processed_files=batch.processed_files,
        created_at=batch.created_at,
        reports=report_summaries,
        metric_tags=metric_tags,
    )


@router.get("/{batch_id}/compare", response_model=MetricMatrixResponse)
async def get_batch_comparison(
    batch_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get comparison matrix for all reports in a batch.
    Includes anomaly detection for price and volume.
    """
    # Query batch
    batch = db.query(UploadBatch).filter(
        UploadBatch.id == batch_id,
        UploadBatch.user_id == current_user.id
    ).first()
    
    if not batch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="批次不存在"
        )
    
    # 发现批次绑定的指标定义（通过 BatchMetricRelation）
    relations = db.query(BatchMetricRelation).filter(
        BatchMetricRelation.batch_id == batch_id
    ).all()

    if relations:
        metric_def_ids = [r.metric_def_id for r in relations]
        metric_defs = db.query(MetricDefinition).filter(
            MetricDefinition.id.in_(metric_def_ids)
        ).order_by(MetricDefinition.is_system.desc(), MetricDefinition.id.asc()).all()
    else:
        # 旧批次兼容：无 BatchMetricRelation 记录时回退系统预置指标
        metric_defs = db.query(MetricDefinition).filter(
            MetricDefinition.is_system == True
        ).order_by(MetricDefinition.id.asc()).all()

    # 构建列定义列表
    metric_definitions = [
        MetricColumnDef(
            metric_key=md.metric_key,
            metric_label=md.metric_label,
            expected_type=md.expected_type.value,
        )
        for md in metric_defs
    ]

    # 查询报告及所有指标（批量加载，避免 N+1）
    reports = db.query(Report).filter(Report.batch_id == batch_id).all()
    report_ids = [r.id for r in reports]

    all_metrics = db.query(ExtractedMetric).filter(
        ExtractedMetric.report_id.in_(report_ids)
    ).all()
    metrics_by_report: dict = {}
    for m in all_metrics:
        if m.report_id not in metrics_by_report:
            metrics_by_report[m.report_id] = {}
        metrics_by_report[m.report_id][m.metric_name] = m

    # 异常检测（容错：检测失败不阻断对比接口）
    try:
        batch_anomalies = detect_batch_anomalies(db, batch_id, group_by="stock_code")
        # 转换为 ReportCompareItem 需要的字符串格式
        anomalies = {}
        for rid, metric_results in batch_anomalies.items():
            anomalies[rid] = {
                mk: ar.direction for mk, ar in metric_results.items()
            }
    except Exception as e:
        logger.warning(f"异常检测失败 (batch_id={batch_id}): {e}")
        anomalies = {}

    # 构建对比数据 — 按批次绑定的指标动态组装
    comparison_data = []

    for report in reports:
        metric_dict = metrics_by_report.get(report.id, {})

        # 动态构建 metrics 字典
        metrics = {}
        for md in metric_defs:
            m = metric_dict.get(md.metric_key)
            if md.expected_type.value == "NUMERIC":
                metrics[md.metric_key] = float(m.metric_value_num) if m and m.metric_value_num is not None else None
            else:
                metrics[md.metric_key] = m.metric_value_raw if m else None

        report_anomalies = anomalies.get(report.id, {})

        comparison_data.append(ReportCompareItem(
            report_id=report.id,
            filename=report.original_filename,
            metrics=metrics,
            anomalies=report_anomalies,
        ))

    return MetricMatrixResponse(
        batch_id=batch.id,
        batch_name=batch.batch_name,
        total_reports=len(reports),
        metric_definitions=metric_definitions,
        reports=comparison_data
    )


@router.delete("/{batch_id}")
async def delete_batch(
    batch_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    删除批次及其所有关联的报告和指标。

    权限：用户只能删除自己的批次，管理员可删除任意用户的批次。
    """
    batch = db.query(UploadBatch).filter(UploadBatch.id == batch_id).first()

    if not batch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="批次不存在"
        )

    # 权限检查
    if not current_user.is_admin and batch.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权删除此批次"
        )

    # 收集所有需要删除的磁盘文件路径
    reports = db.query(Report).filter(Report.batch_id == batch_id).all()
    file_paths = [r.stored_path for r in reports if r.stored_path]

    # 数据库级联删除（reports → extracted_metrics 通过 CASCADE 自动清除）
    db.delete(batch)
    db.commit()

    # 删除磁盘文件（数据库事务提交成功后才执行）
    for path in file_paths:
        delete_upload_file(path)

    return {"message": f"批次 #{batch_id} 已删除"}


@router.delete("")
async def delete_all_batches(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    一键删除当前用户的所有批次。

    权限：用户删除自己的所有批次，管理员删除所有用户的所有批次。
    """
    # 管理员可删除所有，普通用户只删除自己的
    if current_user.is_admin:
        batches = db.query(UploadBatch).all()
    else:
        batches = db.query(UploadBatch).filter(
            UploadBatch.user_id == current_user.id
        ).all()

    if not batches:
        return {"message": "没有需要删除的批次", "deleted_count": 0}

    deleted_count = 0
    file_paths_to_delete: list = []

    for batch in batches:
        # 收集磁盘文件
        reports = db.query(Report).filter(Report.batch_id == batch.id).all()
        for r in reports:
            if r.stored_path:
                file_paths_to_delete.append(r.stored_path)
        db.delete(batch)
        deleted_count += 1

    db.commit()

    # 删除磁盘文件
    for path in file_paths_to_delete:
        delete_upload_file(path)

    return {"message": f"已删除 {deleted_count} 个批次", "deleted_count": deleted_count}


@router.put("/{batch_id}")
async def rename_batch(
    batch_id: int,
    rename_data: BatchRenameRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    重命名批次。

    权限：用户只能重命名自己的批次，管理员可重命名任意用户的批次。
    """
    batch = db.query(UploadBatch).filter(UploadBatch.id == batch_id).first()

    if not batch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="批次不存在"
        )

    # 权限检查
    if not current_user.is_admin and batch.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权重命名此批次"
        )

    batch.batch_name = rename_data.batch_name.strip()
    db.commit()

    return {"message": "批次已重命名", "batch_name": batch.batch_name}