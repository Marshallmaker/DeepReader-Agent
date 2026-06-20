"""
指标模板 CRUD API 接口。
支持系统预置模板和用户自定义模板的管理，以及从模板导入指标定义。
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional
from app.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.metric_template import MetricTemplate
from app.models.metric_definition import MetricDefinition, ExpectedType
from app.schemas.metric_template import (
    TemplateCreate,
    TemplateUpdate,
    TemplateResponse,
    TemplateListResponse,
    TemplateImportResponse,
    MetricItem,
)
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


def _template_to_response(tmpl: MetricTemplate) -> TemplateResponse:
    """
    将 MetricTemplate ORM 对象转换为 TemplateResponse 响应模型。

    参数:
        tmpl: MetricTemplate 数据库对象

    返回:
        TemplateResponse 实例
    """
    metrics_list = []
    if tmpl.metrics:
        for m in tmpl.metrics:
            metrics_list.append(MetricItem(
                metric_key=m.get("key", ""),
                metric_label=m.get("label", ""),
                expected_type=m.get("type", "NUMERIC"),
                prompt_instruction=m.get("prompt_instruction"),
            ))

    return TemplateResponse(
        id=tmpl.id,
        name=tmpl.name,
        description=tmpl.description,
        category=tmpl.category,
        is_system=tmpl.is_system,
        user_id=tmpl.user_id,
        metrics=metrics_list,
        metric_count=len(metrics_list),
        created_at=tmpl.created_at,
        updated_at=tmpl.updated_at,
    )


@router.get("/templates", response_model=TemplateListResponse)
async def list_templates(
    category: Optional[str] = Query(None, description="按分类筛选模板"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    获取当前用户可见的指标模板列表。

    功能说明：
    - 返回系统预置模板（is_system=True）和当前用户的自定义模板
    - 支持按 category 可选筛选
    - 按 is_system DESC, created_at DESC 排序

    参数:
        category: 可选分类筛选
        current_user: 当前登录用户
        db: 数据库会话

    返回:
        模板列表
    """
    query = db.query(MetricTemplate).filter(
        or_(
            MetricTemplate.is_system == True,
            MetricTemplate.user_id == current_user.id,
        )
    )

    if category:
        query = query.filter(MetricTemplate.category == category)

    templates = query.order_by(
        MetricTemplate.is_system.desc(),
        MetricTemplate.created_at.desc(),
    ).all()

    return TemplateListResponse(
        status="success",
        data=[_template_to_response(t) for t in templates],
    )


@router.post("/templates", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_template(
    data: TemplateCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    创建用户自定义指标模板。

    功能说明：
    - 创建的模板归属当前用户（is_system=False, user_id=current_user.id）
    - metrics 以 JSON 数组形式存储

    参数:
        data: 模板创建数据（name, description, category, metrics）
        current_user: 当前登录用户
        db: 数据库会话

    返回:
        新创建的模板信息（201 Created）
    """
    # 将 MetricItem 列表转换为 JSON 可存储的字典列表
    metrics_json = [
        {
            "key": m.metric_key,
            "label": m.metric_label,
            "type": m.expected_type,
            "prompt_instruction": m.prompt_instruction,
        }
        for m in data.metrics
    ]

    new_template = MetricTemplate(
        name=data.name,
        description=data.description,
        category=data.category,
        is_system=False,
        user_id=current_user.id,
        metrics=metrics_json,
    )

    db.add(new_template)
    db.commit()
    db.refresh(new_template)

    logger.info(f"用户 {current_user.email} 创建了模板: {data.name}")

    return _template_to_response(new_template)


@router.put("/templates/{template_id}", response_model=TemplateResponse)
async def update_template(
    template_id: int,
    data: TemplateUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    更新用户自定义指标模板。

    功能说明：
    - 校验模板存在性
    - 系统预置模板不可编辑
    - 仅模板所有者可编辑
    - 支持部分字段更新（exclude_unset）

    参数:
        template_id: 模板 ID
        data: 要更新的字段
        current_user: 当前登录用户
        db: 数据库会话

    返回:
        更新后的模板信息
    """
    template = db.query(MetricTemplate).filter(
        MetricTemplate.id == template_id
    ).first()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="模板不存在",
        )

    if template.is_system:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="系统预置模板不可编辑",
        )

    if template.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权编辑他人的模板",
        )

    # 使用 model_dump(exclude_unset=True) 实现部分更新
    update_data = data.model_dump(exclude_unset=True)

    # 如果更新了 metrics，需要将 MetricItem 列表转为 JSON 字典列表
    if "metrics" in update_data:
        if update_data["metrics"] is None:
            raise HTTPException(status_code=422, detail="metrics 不能为 null")
        update_data["metrics"] = [
            {
                "key": m.metric_key,
                "label": m.metric_label,
                "type": m.expected_type,
                "prompt_instruction": m.prompt_instruction,
            }
            for m in data.metrics
        ]

    for field, value in update_data.items():
        setattr(template, field, value)

    db.commit()
    db.refresh(template)

    logger.info(f"用户 {current_user.email} 更新了模板: {template.name}")

    return _template_to_response(template)


@router.delete("/templates/{template_id}")
async def delete_template(
    template_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    删除用户自定义指标模板。

    功能说明：
    - 校验模板存在性
    - 系统预置模板不可删除
    - 仅模板所有者可删除

    参数:
        template_id: 模板 ID
        current_user: 当前登录用户
        db: 数据库会话

    返回:
        删除成功消息
    """
    template = db.query(MetricTemplate).filter(
        MetricTemplate.id == template_id
    ).first()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="模板不存在",
        )

    if template.is_system:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="系统预置模板不可删除",
        )

    if template.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权删除他人的模板",
        )

    template_name = template.name
    db.delete(template)
    db.commit()

    logger.info(f"用户 {current_user.email} 删除了模板: {template_name}")

    return {
        "status": "success",
        "message": "模板已删除",
    }


@router.post("/templates/{template_id}/import", response_model=TemplateImportResponse)
async def import_template_metrics(
    template_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    将模板中的指标定义导入到当前用户的 metric_definitions 中。

    功能说明：
    - 校验模板存在性
    - 系统模板或自己的模板均可导入
    - 遍历模板 metrics JSON 数组，逐条创建 MetricDefinition
    - 如果该用户下已存在相同 metric_key，则跳过（不覆盖）

    参数:
        template_id: 模板 ID
        current_user: 当前登录用户
        db: 数据库会话

    返回:
        TemplateImportResponse（包含 message, created_count, skipped_count）
    """
    template = db.query(MetricTemplate).filter(
        MetricTemplate.id == template_id
    ).first()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="模板不存在",
        )

    # 权限校验：系统模板或当前用户的模板
    if not template.is_system and template.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权导入他人的模板",
        )

    if not template.metrics:
        return TemplateImportResponse(
            status="success",
            message="模板中没有指标定义，无需导入",
            created_count=0,
            skipped_count=0,
        )

    created_count = 0
    skipped_count = 0

    for metric_item in template.metrics:
        metric_key = metric_item.get("key", "")
        metric_label = metric_item.get("label", "")
        expected_type_str = metric_item.get("type", "NUMERIC")
        prompt_instruction = metric_item.get("prompt_instruction")

        if not metric_key:
            skipped_count += 1
            continue

        # 检查该用户下是否已存在同名 metric_key
        existing = db.query(MetricDefinition).filter(
            MetricDefinition.user_id == current_user.id,
            MetricDefinition.metric_key == metric_key,
        ).first()

        if existing:
            skipped_count += 1
            continue

        # 转换 expected_type 字符串为枚举值
        try:
            expected_type = ExpectedType(expected_type_str)
        except ValueError:
            expected_type = ExpectedType.NUMERIC

        new_metric = MetricDefinition(
            user_id=current_user.id,
            metric_key=metric_key,
            metric_label=metric_label,
            expected_type=expected_type,
            prompt_instruction=prompt_instruction,
            is_system=False,
        )

        db.add(new_metric)
        created_count += 1

    db.commit()

    logger.info(
        f"用户 {current_user.email} 从模板 '{template.name}' 导入了指标: "
        f"创建 {created_count} 条, 跳过 {skipped_count} 条"
    )

    return TemplateImportResponse(
        status="success",
        message=f"成功导入 {created_count} 条指标，跳过 {skipped_count} 条（已存在）",
        created_count=created_count,
        skipped_count=skipped_count,
    )
