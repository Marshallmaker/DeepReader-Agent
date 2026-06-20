"""
File upload API endpoints.
"""
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Query, Cookie, Header
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app.api.dependencies import get_current_user, get_token_from_cookie_or_header
from app.models.user import User
from app.models.batch import UploadBatch, BatchStatus
from app.models.report import Report, ReportStatus
from app.models.metric import ExtractedMetric
from app.models.metric_definition import MetricDefinition, BatchMetricRelation
from app.schemas.file import FileListItem, FileListResponse
from app.utils.file import calculate_md5, save_upload_file, delete_upload_file
from app.config import settings
from app.tasks.pdf_processor import process_batch
from jose import jwt, JWTError
from pydantic import BaseModel, Field
import logging
import concurrent.futures

router = APIRouter()
logger = logging.getLogger(__name__)

class ReportRenameRequest(BaseModel):
    """Report rename request."""
    original_filename: str = Field(..., min_length=1, max_length=255, description="New filename")


# 用于异步 Celery 任务调度的线程池（避免 Redis 连接阻塞主请求线程）
_dispatch_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)


def _dispatch_celery_task(batch_id: int) -> bool:
    """
    在独立线程中调度 Celery 任务，避免 Redis 连接阻塞上传接口响应。

    返回 True 表示调度成功，False 表示 Redis/Celery 不可用。
    """
    try:
        process_batch.delay(batch_id)
        return True
    except Exception as e:
        logger.warning(f"Celery 任务调度失败 (batch_id={batch_id}): {e}")
        return False


def _try_dispatch(batch_id: int) -> bool:
    """
    尝试调度 Celery 任务。

    优先直接调用 delay()（Redis 已就绪时毫秒级返回），
    若连接失败则通过线程池 + 超时兜底，避免主请求阻塞。
    """
    # 先尝试直接调度（Redis 正常时瞬时返回）
    try:
        process_batch.delay(batch_id)
        return True
    except Exception:
        pass  # 连接失败，回退到线程池方案

    # 兜底：线程池 + 3 秒超时
    try:
        future = _dispatch_executor.submit(_dispatch_celery_task, batch_id)
        return future.result(timeout=3)
    except (concurrent.futures.TimeoutError, Exception):
        logger.warning(f"Celery 任务调度失败 (batch_id={batch_id})，跳过异步处理")
        return False


def _resolve_metric_ids(db: Session, user_id: int, metric_ids: list[int]) -> list[int]:
    """
    解析指标 ID 列表：若用户未勾选任何指标，自动回退到系统预置指标。

    根据需求文档 3.7.2 节的双模混合分流机制：
    - 当 metric_ids 为空时，读取 is_system=True 的默认指标
    - 当 metric_ids 非空时，直接使用用户勾选的指标 ID
    """
    if metric_ids:
        return metric_ids

    # 兜底：加载系统预置指标（is_system=True，对所有用户可见）
    system_metrics = db.query(MetricDefinition.id).filter(
        MetricDefinition.is_system == True
    ).all()
    return [m.id for m in system_metrics]


def _bind_metrics_to_batch(db: Session, batch_id: int, metric_ids: list[int]) -> None:
    """将指标绑定到批次（写入 batch_metric_relations 表）。"""
    for metric_def_id in metric_ids:
        relation = BatchMetricRelation(
            batch_id=batch_id,
            metric_def_id=metric_def_id
        )
        db.add(relation)
    db.commit()


def _copy_metrics(db: Session, source_report_id: int, target_report_id: int) -> None:
    """将已提取的指标从源报告复制到目标报告（用于 MD5 秒传）。"""
    source_metrics = db.query(ExtractedMetric).filter(
        ExtractedMetric.report_id == source_report_id
    ).all()

    for metric in source_metrics:
        new_metric = ExtractedMetric(
            report_id=target_report_id,
            metric_name=metric.metric_name,
            metric_display_name=metric.metric_display_name,
            metric_value_num=metric.metric_value_num,
            metric_value_raw=metric.metric_value_raw,
            fiscal_year=metric.fiscal_year,
            unit=metric.unit,
            confidence=metric.confidence
        )
        db.add(new_metric)
    db.commit()


@router.post("/upload")
async def upload_files(
    files: List[UploadFile] = File(...),
    batch_name: str = Form(None),
    metric_ids: List[int] = Form(default=[]),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Upload PDF files and process them asynchronously using Celery.
    
    - Maximum 10 files per batch
    - Maximum 20MB per file
    - MD5 deduplication for existing files
    - Returns batch_id for tracking
    """
    # Validate file count
    if len(files) > settings.MAX_UPLOAD_FILES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"单次批量上传最大文件数为 {settings.MAX_UPLOAD_FILES} 个"
        )
    
    # 第一阶段：读取并校验所有文件（在创建数据库记录之前）
    # 这样任何文件校验失败都不会产生孤立批次
    processed_files: list[dict] = []

    for file in files:
        if not file.filename or not file.filename.lower().endswith('.pdf'):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="仅允许上传 PDF 文件"
            )

        # 读取文件内容
        file_content = await file.read()

        # 检查文件大小
        if len(file_content) > settings.MAX_FILE_SIZE_MB * 1024 * 1024:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"文件 {file.filename} 超过最大 {settings.MAX_FILE_SIZE_MB}MB 限制"
            )

        # 计算 MD5
        file_md5 = calculate_md5(file_content)

        # 检查是否存在相同 MD5 的报告
        existing_report = db.query(Report).filter(
            Report.pdf_md5 == file_md5,
            Report.status == ReportStatus.SUCCESS
        ).first()

        processed_files.append({
            "filename": file.filename,
            "content": file_content,
            "md5": file_md5,
            "existing_report": existing_report
        })

    # 第二阶段：所有文件校验通过后，创建批次和报告记录
    new_batch = UploadBatch(
        user_id=current_user.id,
        batch_name=batch_name or "未命名批次",
        status=BatchStatus.PENDING,
        total_files=len(files),
        processed_files=0
    )
    db.add(new_batch)
    db.commit()
    db.refresh(new_batch)

    # 2.5: 解析指标集并绑定到批次（双模分流：空→系统默认，非空→用户勾选）
    resolved_ids = _resolve_metric_ids(db, current_user.id, metric_ids)
    _bind_metrics_to_batch(db, new_batch.id, resolved_ids)

    for pf in processed_files:
        if pf["existing_report"]:
            # 复用已有文件 — 同时复用已提取的指标
            new_report = Report(
                batch_id=new_batch.id,
                original_filename=pf["filename"],
                stored_path=pf["existing_report"].stored_path,
                pdf_md5=pf["md5"],
                file_size=len(pf["content"]),
                status=ReportStatus.SUCCESS,  # 已有文件直接标记成功
                raw_markdown=pf["existing_report"].raw_markdown
            )
            db.add(new_report)
            db.commit()
            db.refresh(new_report)

            # 复制已提取的指标到新报告
            _copy_metrics(db, pf["existing_report"].id, new_report.id)
            new_batch.processed_files += 1
        else:
            # 保存新文件
            stored_path, _ = save_upload_file(pf["content"], pf["filename"], current_user.id)

            new_report = Report(
                batch_id=new_batch.id,
                original_filename=pf["filename"],
                stored_path=stored_path,
                pdf_md5=pf["md5"],
                file_size=len(pf["content"]),
                status=ReportStatus.PENDING
            )
            db.add(new_report)
            db.commit()

    # 更新批次的 processed_files 计数
    db.commit()

    # 获取批次中所有报告的最终状态
    pending_count = db.query(Report).filter(
        Report.batch_id == new_batch.id,
        Report.status == ReportStatus.PENDING
    ).count()

    success_count = db.query(Report).filter(
        Report.batch_id == new_batch.id,
        Report.status == ReportStatus.SUCCESS
    ).count()

    celery_dispatched = False
    if pending_count > 0:
        celery_dispatched = _try_dispatch(new_batch.id)
    else:
        # 无待处理报告：秒传场景，同步更新批次终态
        if success_count == new_batch.total_files:
            new_batch.status = BatchStatus.COMPLETED
        else:
            new_batch.status = BatchStatus.PARTIAL
        db.commit()

    return {
        "batch_id": new_batch.id,
        "status": "accepted",
        "total_files": new_batch.total_files,
        "celery_dispatched": celery_dispatched,
        "message": (
            "文件上传成功，后台异步处理任务已调度"
            if celery_dispatched else
            "文件上传成功（所有文件已秒传）"
            if pending_count == 0 else
            "文件上传成功，但异步任务调度失败（Redis/Celery 未就绪），请联系管理员"
        )
    }


@router.delete("/reports/{report_id}")
async def delete_report(
    report_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    删除单个报告及其关联指标。

    如果批次内仅剩此报告，则同时删除整个批次。
    权限：用户只能删除自己的报告，管理员可删除任意用户的。
    """
    report = db.query(Report).filter(Report.id == report_id).first()

    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="报告不存在"
        )

    # 权限检查：通过批次归属验证
    batch = db.query(UploadBatch).filter(UploadBatch.id == report.batch_id).first()
    if not current_user.is_admin and (not batch or batch.user_id != current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权删除此报告"
        )

    batch_id = report.batch_id
    stored_path = report.stored_path

    # 检查批次内报告数量
    report_count = db.query(Report).filter(Report.batch_id == batch_id).count()

    if report_count <= 1:
        # 批次内仅剩此报告，直接删除整个批次
        db.delete(batch)
        db.commit()
        if stored_path:
            delete_upload_file(stored_path)
        return {"message": f"报告 #{report_id} 及所属批次已删除"}
    else:
        # 仅删除单个报告，更新批次计数
        db.delete(report)
        if batch:
            batch.total_files = max(0, batch.total_files - 1)
            if report.status == ReportStatus.SUCCESS:
                batch.processed_files = max(0, batch.processed_files - 1)
        db.commit()
        if stored_path:
            delete_upload_file(stored_path)
        return {"message": f"报告 #{report_id} 已删除"}


@router.put("/reports/{report_id}")
async def rename_report(
    report_id: int,
    rename_data: ReportRenameRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    重命名报告（修改 original_filename）。

    权限：用户只能重命名自己的报告，管理员可重命名任意用户的。
    """
    report = db.query(Report).filter(Report.id == report_id).first()

    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="报告不存在"
        )

    # 权限检查
    batch = db.query(UploadBatch).filter(UploadBatch.id == report.batch_id).first()
    if not current_user.is_admin and (not batch or batch.user_id != current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权重命名此报告"
        )

    report.original_filename = rename_data.original_filename.strip()
    db.commit()

    return {
        "message": "报告已重命名",
        "report_id": report.id,
        "original_filename": report.original_filename
    }


class ReportContentResponse(BaseModel):
    """报告内容查看响应"""
    report_id: int
    filename: str
    batch_id: int
    batch_name: Optional[str] = None
    entity_name: Optional[str] = None
    status: str
    file_size: int
    raw_markdown: Optional[str] = None
    metrics_count: int = 0
    created_at: str


@router.get("/reports/{report_id}", response_model=ReportContentResponse)
async def get_report_content(
    report_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """查看报告内容（AI 提取的 Markdown 文本及基本元数据）。"""
    # 查询报告并通过批次校验归属权
    report = db.query(Report).filter(Report.id == report_id).first()

    if not report:
        raise HTTPException(status_code=404, detail="报告不存在")

    batch = db.query(UploadBatch).filter(UploadBatch.id == report.batch_id).first()
    if not current_user.is_admin and (not batch or batch.user_id != current_user.id):
        raise HTTPException(status_code=403, detail="无权查看此报告")

    # 指标数量
    metrics_count = db.query(ExtractedMetric).filter(
        ExtractedMetric.report_id == report_id
    ).count()

    return ReportContentResponse(
        report_id=report.id,
        filename=report.original_filename,
        batch_id=report.batch_id,
        batch_name=batch.batch_name if batch else None,
        entity_name=report.entity_name,
        status=report.status.value,
        file_size=report.file_size or 0,
        raw_markdown=report.raw_markdown,
        metrics_count=metrics_count,
        created_at=report.created_at.isoformat() if report.created_at else "",
    )


@router.get("/reports/{report_id}/pdf")
async def get_report_pdf(
    report_id: int,
    token: Optional[str] = Query(None, description="JWT access token（iframe 内嵌时通过查询参数传递）"),
    access_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """返回原始 PDF 文件（浏览器内嵌预览），支持 Header/Cookie/Query 三种 Token 传递方式。"""
    # 从多种来源提取并验证 JWT token
    token_str = get_token_from_cookie_or_header(access_token, authorization) or token
    if not token_str:
        raise HTTPException(status_code=401, detail="无法验证凭证")

    try:
        payload = jwt.decode(token_str, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id = payload.get("sub")
        token_type = payload.get("type")
        if user_id is None or token_type != "access":
            raise HTTPException(status_code=401, detail="无效的凭证")
    except JWTError:
        raise HTTPException(status_code=401, detail="无效的凭证")

    current_user = db.query(User).filter(User.id == int(user_id)).first()
    if not current_user or not current_user.is_active:
        raise HTTPException(status_code=401, detail="用户不存在或已禁用")

    # 查询报告并校验权限
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="报告不存在")

    batch = db.query(UploadBatch).filter(UploadBatch.id == report.batch_id).first()
    if not current_user.is_admin and (not batch or batch.user_id != current_user.id):
        raise HTTPException(status_code=403, detail="无权访问此报告")

    stored_path = Path(report.stored_path)
    # 兜底：兼容历史相对路径（相对于 UPLOAD_DIR 解析）
    if not stored_path.is_absolute():
        stored_path = Path(settings.UPLOAD_DIR).resolve() / report.stored_path
    if not stored_path.exists():
        raise HTTPException(status_code=404, detail="PDF 文件不存在或已被删除")

    return FileResponse(
        stored_path,
        media_type="application/pdf",
        filename=report.original_filename,
        headers={"Content-Disposition": "inline"},
    )


# ── 跨批次文件列表 ──────────────────────────────────────

@router.get("", response_model=FileListResponse)
async def get_files(
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    batch_id: Optional[int] = Query(None, description="按批次筛选"),
    status_filter: Optional[str] = Query(None, alias="status", description="按状态筛选"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取当前用户所有文件（跨批次），支持分页和筛选。"""
    # 基础查询：用户的所有报告
    query = db.query(Report).join(
        UploadBatch, Report.batch_id == UploadBatch.id
    ).filter(
        UploadBatch.user_id == current_user.id
    )

    # 可选筛选
    if batch_id is not None:
        query = query.filter(Report.batch_id == batch_id)
    if status_filter:
        query = query.filter(Report.status == status_filter)

    # 总数
    total = query.count()

    # 分页
    reports = query.order_by(Report.created_at.desc()).offset(
        (page - 1) * page_size
    ).limit(page_size).all()

    # 批量获取批次名称
    batch_ids = list(set(r.batch_id for r in reports))
    batches = db.query(UploadBatch).filter(UploadBatch.id.in_(batch_ids)).all() if batch_ids else []
    batch_name_map = {b.id: b.batch_name for b in batches}

    items = [
        FileListItem(
            report_id=r.id,
            original_filename=r.original_filename,
            batch_id=r.batch_id,
            batch_name=batch_name_map.get(r.batch_id),
            entity_name=r.entity_name,
            status=r.status.value,
            file_size=r.file_size or 0,
            created_at=r.created_at,
        )
        for r in reports
    ]

    return FileListResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=items,
    )