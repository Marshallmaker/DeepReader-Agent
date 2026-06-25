"""
自定义指标管理 API 接口。
支持用户自定义新增、获取、删除提取指标。
"""
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from typing import List, Optional
from pydantic import BaseModel, Field
import fitz  # PyMuPDF
from app.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.metric_definition import MetricDefinition, ExpectedType
from app.models.batch import UploadBatch
from app.models.report import Report
import asyncio
import json as _json
from app.services.ai_metric_recommender import (
    recommend_metrics_from_report, recommend_metrics_from_text,
    recommend_metrics_stream, _extract_json_from_text, RECOMMEND_SYSTEM_PROMPT,
)
from app.utils.http_client import get_openai_client
from app.config import get_settings
from app.schemas.metric import (
    MetricDefinitionCreate,
    MetricUpdate,
    MetricDefinitionResponse,
    MetricDefinitionListResponse
)
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/definitions", response_model=MetricDefinitionResponse, status_code=status.HTTP_201_CREATED)
async def create_metric_definition(
    data: MetricDefinitionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    用户自定义新增提取指标
    
    功能说明：
    - 从 Token 中解析 user_id
    - 校验 metric_key 是否在该用户下唯一
    - 若唯一，则向 metric_definitions 表中持久化写入该条配置元数据
    
    Args:
        data: 指标定义数据（metric_key, metric_label, expected_type, prompt_instruction）
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        新创建的指标定义信息
    """
    # 校验 metric_key 是否已存在（用户自定义 + 系统预置均不可重复）
    existing = db.query(MetricDefinition).filter(
        MetricDefinition.metric_key == data.metric_key,
        or_(
            MetricDefinition.user_id == current_user.id,
            MetricDefinition.is_system == True,
        ),
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"指标键 '{data.metric_key}' 已存在，请使用不同的键名"
        )
    
    # 创建新的指标定义
    new_metric = MetricDefinition(
        user_id=current_user.id,
        metric_key=data.metric_key,
        metric_label=data.metric_label,
        expected_type=data.expected_type,
        prompt_instruction=data.prompt_instruction,
        is_system=False  # 用户自定义指标，非系统预置
    )
    
    db.add(new_metric)
    db.commit()
    db.refresh(new_metric)
    
    logger.info(f"用户 {current_user.email} 创建了新指标: {data.metric_key}")
    
    return MetricDefinitionResponse(
        status="success",
        message="自定义指标配置创建成功。",
        data={
            "id": new_metric.id,
            "metric_key": new_metric.metric_key,
            "metric_label": new_metric.metric_label,
            "expected_type": new_metric.expected_type.value,
            "prompt_instruction": new_metric.prompt_instruction,
            "is_system": new_metric.is_system
        }
    )


@router.get("/definitions", response_model=MetricDefinitionListResponse)
async def get_metric_definitions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    获取当前用户配置的所有自定义指标列表
    
    功能说明：
    - 返回用户自己定义的指标 + 系统预置的默认指标（user_id=1）
    - 支持前端指标勾选矩阵展示
    
    Args:
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        指标定义列表
    """
    # 获取所有指标（系统预置指标仅返回启用的，用户自定义指标全部返回）
    all_metrics = db.query(MetricDefinition).filter(
        or_(
            and_(
                MetricDefinition.is_system == True,
                MetricDefinition.is_active == True
            ),
            and_(
                MetricDefinition.user_id == current_user.id,
                MetricDefinition.is_system == False
            )
        )
    ).order_by(MetricDefinition.is_system.desc(), MetricDefinition.id).all()

    # Python去重
    seen_ids = {}
    unique_metrics = []
    for m in all_metrics:
        if m.id not in seen_ids:
            seen_ids[m.id] = True
            unique_metrics.append(m)

    return MetricDefinitionListResponse(
        status="success",
        data=[
            {
                "id": m.id,
                "metric_key": m.metric_key,
                "metric_label": m.metric_label,
                "expected_type": m.expected_type.value,
                "prompt_instruction": m.prompt_instruction,
                "is_system": m.is_system,
                "is_active": m.is_active
            }
            for m in unique_metrics
        ]
    )


# ── 批量删除 ──────────────────────────────────────────────────

class BatchDeleteRequest(BaseModel):
    """批量删除请求"""
    ids: List[int] = Field(..., min_length=1, max_length=200, description="要删除的指标 ID 列表")


class BatchDeleteResponse(BaseModel):
    """批量删除响应"""
    status: str = "success"
    message: str
    deleted_count: int = 0
    skipped_count: int = 0
    skipped_labels: List[str] = Field(default_factory=list, description="被跳过的指标名称")


@router.delete("/definitions/batch", response_model=BatchDeleteResponse)
async def batch_delete_metric_definitions(
    body: BatchDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    批量删除用户的自定义指标定义。

    逐条校验归属权和非系统预置，满足条件的在一个事务中删除。

    Args:
        body: 包含要删除的指标 ID 列表
        current_user: 当前登录用户
        db: 数据库会话

    Returns:
        BatchDeleteResponse（含 deleted_count, skipped_count, skipped_labels）
    """
    deleted = 0
    skipped = 0
    skipped_labels: List[str] = []

    for metric_id in body.ids:
        metric = db.query(MetricDefinition).filter(
            MetricDefinition.id == metric_id
        ).first()

        if not metric:
            skipped += 1
            skipped_labels.append(f"ID#{metric_id}(不存在)")
            continue

        if metric.user_id != current_user.id:
            skipped += 1
            skipped_labels.append(metric.metric_label)
            continue

        if metric.is_system:
            skipped += 1
            skipped_labels.append(metric.metric_label)
            continue

        db.delete(metric)
        deleted += 1

    db.commit()

    logger.info(
        f"用户 {current_user.email} 批量删除指标: 成功 {deleted} 个, 跳过 {skipped} 个"
    )

    msg_parts = [f"成功删除 {deleted} 个指标"]
    if skipped > 0:
        msg_parts.append(f"跳过 {skipped} 个（系统预置或无权操作）")

    return BatchDeleteResponse(
        message="；".join(msg_parts),
        deleted_count=deleted,
        skipped_count=skipped,
        skipped_labels=skipped_labels,
    )


@router.delete("/definitions/{metric_id}")
async def delete_metric_definition(
    metric_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    删除用户的自定义指标定义
    
    功能说明：
    - 从 Token 中解析 user_id
    - 必须校验该 id 对应的配置是否属于当前登录用户（严禁越权删除他人指标配置）
    - 系统预置指标（is_system=True）不可删除
    - 确认无误后执行删除
    
    Args:
        metric_id: 指标配置项的自增主键
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        删除成功消息
    """
    # 查找指标定义
    metric = db.query(MetricDefinition).filter(
        MetricDefinition.id == metric_id
    ).first()
    
    if not metric:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="要删除的指标 ID 不存在"
        )
    
    # 校验是否属于当前用户
    if metric.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="尝试删除不属于自己的指标配置，越权拦截"
        )
    
    # 系统预置指标不可删除
    if metric.is_system:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="系统预置指标不可删除"
        )
    
    # 执行删除
    db.delete(metric)
    db.commit()
    
    logger.info(f"用户 {current_user.email} 删除了指标: {metric.metric_key}")

    return {
        "status": "success",
        "message": "指标配置已成功删除，未来异步任务将不再以此指标调度大模型。"
    }


@router.put("/definitions/{metric_id}", response_model=MetricDefinitionResponse)
async def update_metric_definition(
    metric_id: int,
    data: MetricUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    更新用户自定义指标定义

    功能说明：
    - 仅允许修改 metric_label、expected_type、prompt_instruction
    - metric_key 和 is_system 不可修改
    - 系统预置指标不可编辑
    - 非管理员仅可编辑自己的指标

    Args:
        metric_id: 指标配置项的自增主键
        data: 待更新的字段（仅传入非 None 的字段会被更新）
        current_user: 当前登录用户
        db: 数据库会话

    Returns:
        更新后的指标定义信息
    """
    # 1. 查找指标定义
    metric = db.query(MetricDefinition).filter(
        MetricDefinition.id == metric_id
    ).first()

    if not metric:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="要编辑的指标 ID 不存在"
        )

    # 2. 系统预置指标不可编辑
    if metric.is_system:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="系统预置指标不可编辑"
        )

    # 3. 校验所有权（非管理员仅可编辑自己的指标）
    if metric.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="尝试编辑不属于自己的指标配置，越权拦截"
        )

    # 4. 部分更新：仅更新请求中显式传入了的字段
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(metric, field, value)

    db.commit()
    db.refresh(metric)

    logger.info(f"用户 {current_user.email} 更新了指标 {metric.id}: {metric.metric_key}")

    return MetricDefinitionResponse(
        status="success",
        message="自定义指标配置更新成功。",
        data={
            "id": metric.id,
            "metric_key": metric.metric_key,
            "metric_label": metric.metric_label,
            "expected_type": metric.expected_type.value,
            "prompt_instruction": metric.prompt_instruction,
            "is_system": metric.is_system
        }
    )


# ── AI 指标推荐 ──────────────────────────────────────────────

class AIRecommendRequest(BaseModel):
    """AI 指标推荐请求"""
    batch_id: Optional[int] = Field(None, description="已有批次的 ID")
    report_id: Optional[int] = Field(None, description="指定要分析的报告 ID，优先于 batch_id")
    report_type_hint: Optional[str] = Field(None, max_length=200, description="报告类型提示")


class RecommendedMetricItem(BaseModel):
    """推荐的单条指标"""
    metric_key: str
    metric_label: str
    expected_type: str
    prompt_instruction: Optional[str] = ""


class AIRecommendResponse(BaseModel):
    """AI 指标推荐响应"""
    status: str = "success"
    report_type: str
    recommended_metrics: List[RecommendedMetricItem]


@router.post("/ai-recommend", response_model=AIRecommendResponse)
async def ai_recommend_metrics(
    body: AIRecommendRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """AI 智能推荐指标 + 自动生成提示词"""
    if body.report_id:
        # 精确指定报告 ID（验证所属权 + 内容完整性）
        report = db.query(Report).join(
            UploadBatch, Report.batch_id == UploadBatch.id
        ).filter(
            Report.id == body.report_id,
            UploadBatch.user_id == current_user.id,
            Report.raw_markdown.isnot(None),
            Report.raw_markdown != "",
        ).first()

        if not report:
            raise HTTPException(
                status_code=404,
                detail="未找到指定的报告或报告尚未处理完成"
            )

        result = await asyncio.to_thread(
            recommend_metrics_from_report,
            report.raw_markdown,
            report_type_hint=body.report_type_hint,
        )
    elif body.batch_id:
        # 批次模式：取第一份已完成报告（按 ID 排序确保确定性）
        report = db.query(Report).join(
            UploadBatch, Report.batch_id == UploadBatch.id
        ).filter(
            Report.batch_id == body.batch_id,
            UploadBatch.user_id == current_user.id,
            Report.raw_markdown.isnot(None),
            Report.raw_markdown != "",
        ).order_by(Report.id).first()

        if not report:
            raise HTTPException(
                status_code=404,
                detail="未找到可用的 PDF 解析内容，请确保批次中有已完成处理的报告"
            )

        result = await asyncio.to_thread(
            recommend_metrics_from_report,
            report.raw_markdown,
            report_type_hint=body.report_type_hint,
        )
    elif body.report_type_hint:
        # 纯文本模式：用户描述报告类型
        result = await asyncio.to_thread(
            recommend_metrics_from_text,
            body.report_type_hint,
        )
    else:
        raise HTTPException(
            status_code=400,
            detail="请提供 batch_id、report_id 或 report_type_hint"
        )

    return AIRecommendResponse(
        report_type=result.get("report_type", "未知"),
        recommended_metrics=result.get("recommended_metrics", []),
    )


@router.post("/ai-recommend/stream")
async def ai_recommend_stream(
    body: AIRecommendRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    AI 智能推荐指标 — SSE 流式输出版本。

    逐 token 推送生成内容，前端实时渲染，大幅提升感知速度。
    """
    if body.report_id:
        report = db.query(Report).join(
            UploadBatch, Report.batch_id == UploadBatch.id
        ).filter(
            Report.id == body.report_id,
            UploadBatch.user_id == current_user.id,
            Report.raw_markdown.isnot(None),
            Report.raw_markdown != "",
        ).first()
        if not report:
            raise HTTPException(status_code=404, detail="未找到指定的报告或报告尚未处理完成")
        markdown = report.raw_markdown
        hint = body.report_type_hint
    elif body.batch_id:
        report = db.query(Report).join(
            UploadBatch, Report.batch_id == UploadBatch.id
        ).filter(
            Report.batch_id == body.batch_id,
            UploadBatch.user_id == current_user.id,
            Report.raw_markdown.isnot(None),
            Report.raw_markdown != "",
        ).order_by(Report.id).first()
        if not report:
            raise HTTPException(status_code=404, detail="未找到可用的 PDF 解析内容")
        markdown = report.raw_markdown
        hint = body.report_type_hint
    elif body.report_type_hint:
        markdown = body.report_type_hint
        hint = None
    else:
        raise HTTPException(status_code=400, detail="请提供 batch_id、report_id 或 report_type_hint")

    # 区分报告分析和纯文本描述
    if body.report_type_hint and not body.batch_id and not body.report_id:
        # 文本模式流式
        async def event_generator():
            client = get_openai_client()
            settings = get_settings()
            user_prompt = f"请为以下类型的报告推荐指标体系：{body.report_type_hint}"
            full = ""
            try:
                response = client.chat.completions.create(
                    model=settings.SILICONFLOW_MODEL,
                    messages=[
                        {"role": "system", "content": RECOMMEND_SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=0.3,
                    max_tokens=2000,
                    stream=True,
                )
                for chunk in response:
                    delta = chunk.choices[0].delta
                    if delta.content:
                        full += delta.content
                        yield f"data: {_json.dumps({'chunk': delta.content})}\n\n"
                parsed = _extract_json_from_text(full)
                if parsed:
                    yield f"data: {_json.dumps({'done': True, 'result': parsed})}\n\n"
                else:
                    yield f"data: {_json.dumps({'error': '无法解析 AI 返回内容'})}\n\n"
            except Exception as e:
                yield f"data: {_json.dumps({'error': str(e)})}\n\n"
        return StreamingResponse(event_generator(), media_type="text/event-stream")
    else:
        # 报告模式流式
        async def event_generator():
            for sse in recommend_metrics_stream(markdown, hint):
                yield sse
        return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/ai-recommend-from-file", response_model=AIRecommendResponse)
async def ai_recommend_from_file(
    file: UploadFile = File(...),
    report_type_hint: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
):
    """从前端上传的单个 PDF 文件中直接提取文本并推荐指标。

    不创建批次、不存储文件、不写入数据库 — 纯一次性分析。
    适用于用户在上传前预览 PDF 内容以获取 AI 推荐的指标体系。
    """
    # 校验文件类型
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(
            status_code=400,
            detail="只支持 PDF 文件格式"
        )

    # 校验文件大小（最大 20MB）
    file_content = await file.read()
    if len(file_content) > 20 * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail="文件大小超过 20MB 限制"
        )

    # 使用 PyMuPDF 从内存中解析 PDF 文本
    try:
        doc = fitz.open(stream=file_content, filetype="pdf")
        total_pages = len(doc)
        max_pages = min(total_pages, 20)

        text_parts = []
        for page_num in range(max_pages):
            page = doc[page_num]
            text = page.get_text()
            if text.strip():
                text_parts.append(text)

        doc.close()
        pdf_text = "\n\n".join(text_parts)

        if not pdf_text.strip():
            raise HTTPException(
                status_code=400,
                detail="PDF 中未提取到可读文本内容，请确认文件不是扫描版图片 PDF"
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"PDF 解析失败: {e}")
        raise HTTPException(
            status_code=400,
            detail=f"PDF 文件解析失败: {str(e)}"
        )

    # 调用 AI 推荐服务
    try:
        result = await asyncio.to_thread(
            recommend_metrics_from_report,
            pdf_text,
            report_type_hint=report_type_hint,
        )
    except Exception as e:
        logger.error(f"AI 推荐服务异常: {e}")
        raise HTTPException(
            status_code=500,
            detail="AI 指标推荐服务暂时不可用，请稍后重试"
        )

    return AIRecommendResponse(
        report_type=result.get("report_type", "未知"),
        recommended_metrics=result.get("recommended_metrics", []),
    )
