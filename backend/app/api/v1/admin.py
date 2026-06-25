"""
Admin API endpoints for user management and auditing.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from app.database import get_db
from app.api.dependencies import get_current_admin_user
from app.models.user import User
from app.models.batch import UploadBatch
from app.models.report import Report
from app.models.metric import ExtractedMetric
from app.models.metric_definition import MetricDefinition
from app.models.metric_template import MetricTemplate
from app.schemas.metric import (
    MetricAdminCreate,
    MetricAdminUpdate,
    MetricDefinitionData,
)
from app.schemas.metric_template import (
    TemplateAdminCreate,
    TemplateAdminUpdate,
    TemplateBulkToggle,
    MetricItemAdmin,
)

router = APIRouter()


def _cascade_sync_template_metrics(db: Session, template: MetricTemplate) -> int:
    """
    将合集模版的 is_active 和 metrics[].disabled 状态级联同步到
    所有匹配的系统 MetricDefinition 记录。

    逻辑：
    - 模版禁用 (is_active=False) → 所有指标禁用
    - 模版启用 + 指标未单独禁用 → 启用
    - 模版启用 + 指标单独禁用 (disabled=True) → 禁用

    参数:
        db: 数据库会话
        template: 需要同步的 MetricTemplate 对象

    返回:
        实际更新的 MetricDefinition 行数
    """
    if not template.metrics:
        return 0

    # 按目标状态分组 metric_key（只收集需要变更的 key）
    enable_keys = []
    disable_keys = []

    for m in template.metrics:
        key = m.get("key", "")
        if not key:
            continue
        is_disabled = m.get("disabled", False)
        # 综合判定：模版启用 且 指标未单独禁用 → 启用，否则禁用
        if template.is_active and not is_disabled:
            enable_keys.append(key)
        else:
            disable_keys.append(key)

    synced = 0

    # 批量更新：启用组（仅更新当前为禁用的记录，避免无效写入）
    if enable_keys:
        synced += db.query(MetricDefinition).filter(
            MetricDefinition.is_system == True,
            MetricDefinition.metric_key.in_(enable_keys),
            MetricDefinition.is_active == False,
        ).update(
            {MetricDefinition.is_active: True},
            synchronize_session=False,
        )

    # 批量更新：禁用组（仅更新当前为启用的记录）
    if disable_keys:
        synced += db.query(MetricDefinition).filter(
            MetricDefinition.is_system == True,
            MetricDefinition.metric_key.in_(disable_keys),
            MetricDefinition.is_active == True,
        ).update(
            {MetricDefinition.is_active: False},
            synchronize_session=False,
        )

    return synced


@router.get("/users")
async def get_users(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(10, ge=1, le=100, description="Items per page"),
    search_keyword: Optional[str] = Query(None, description="Search by email or nickname"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    order: str = Query("desc", pattern="^(asc|desc)$", description="Sort order: asc=earliest first, desc=latest first"),
    current_admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    Get paginated list of all users (admin only).

    - Supports search by email or nickname
    - Can filter by active status
    """
    # 使用子查询一次性获取每用户的批次数，避免 N+1 查询
    batch_count_subq = (
        db.query(
            UploadBatch.user_id,
            func.count(UploadBatch.id).label("cnt")
        )
        .group_by(UploadBatch.user_id)
        .subquery()
    )

    # Build query
    query = db.query(
        User,
        func.coalesce(batch_count_subq.c.cnt, 0).label("batch_count")
    ).outerjoin(
        batch_count_subq, User.id == batch_count_subq.c.user_id
    )

    if search_keyword:
        query = query.filter(
            (User.email.ilike(f"%{search_keyword}%")) |
            (User.nickname.ilike(f"%{search_keyword}%"))
        )

    if is_active is not None:
        query = query.filter(User.is_active == is_active)

    # Get total count
    total = query.count()

    # Paginate
    offset = (page - 1) * page_size
    order_clause = User.created_at.asc() if order == "asc" else User.created_at.desc()
    results = query.order_by(order_clause).offset(offset).limit(page_size).all()

    # Build response
    items = [
        {
            "id": user.id,
            "email": user.email,
            "nickname": user.nickname,
            "is_active": user.is_active,
            "is_admin": user.is_admin,
            "created_at": user.created_at,
            "batch_count": batch_count
        }
        for user, batch_count in results
    ]

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": items
    }


@router.patch("/users/{user_id}/status")
async def toggle_user_status(
    user_id: int,
    current_admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    Toggle user active status (admin only).
    """
    user = db.query(User).filter(User.id == user_id).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )
    
    # Prevent disabling admin users
    if user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="无法修改管理员用户状态"
        )
    
    user.is_active = not user.is_active
    db.commit()
    
    return {
        "id": user.id,
        "email": user.email,
        "is_active": user.is_active,
        "message": f"用户已{'启用' if user.is_active else '禁用'}"
    }


@router.get("/users/{user_id}/batches")
async def get_user_batches(
    user_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    current_admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    Get all batches for a specific user (admin audit).
    """
    user = db.query(User).filter(User.id == user_id).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )
    
    # Query batches
    total = db.query(UploadBatch).filter(UploadBatch.user_id == user_id).count()
    offset = (page - 1) * page_size
    batches = db.query(UploadBatch).filter(
        UploadBatch.user_id == user_id
    ).order_by(UploadBatch.created_at.desc()).offset(offset).limit(page_size).all()
    
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "user_id": user_id,
        "user_email": user.email,
        "items": [
            {
                "batch_id": batch.id,
                "batch_name": batch.batch_name,
                "status": batch.status.value,
                "total_files": batch.total_files,
                "created_at": batch.created_at
            }
            for batch in batches
        ]
    }


@router.get("/reports/{report_id}")
async def get_report_detail(
    report_id: int,
    current_admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    Get detailed report information including raw markdown and extracted JSON (admin audit).
    """
    report = db.query(Report).filter(Report.id == report_id).first()
    
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="报告不存在"
        )
    
    # Get metrics (适配EAV结构)
    metrics = db.query(ExtractedMetric).filter(ExtractedMetric.report_id == report_id).all()
    
    # 将EAV结构转换为字典格式
    metrics_dict = {}
    for metric in metrics:
        metrics_dict[metric.metric_name] = {
            "display_name": metric.metric_display_name,
            "value_num": metric.metric_value_num,
            "value_raw": metric.metric_value_raw
        }
    
    return {
        "report_id": report.id,
        "batch_id": report.batch_id,
        "filename": report.original_filename,
        "status": report.status.value,
        "raw_markdown": report.raw_markdown,
        "error_message": report.error_message,
        "created_at": report.created_at,
        "metrics": metrics_dict
    }


# ========== 系统指标模版管理（管理员专用）==========

@router.get("/metrics")
async def get_system_metrics(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    current_admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    获取所有系统指标定义（管理员专用，含已禁用的指标）。

    返回分页的系统指标列表，包含 is_active 状态。
    """
    query = db.query(MetricDefinition).filter(MetricDefinition.is_system == True)

    total = query.count()
    offset = (page - 1) * page_size
    metrics = query.order_by(MetricDefinition.id.asc()).offset(offset).limit(page_size).all()

    items = [
        {
            "id": m.id,
            "metric_key": m.metric_key,
            "metric_label": m.metric_label,
            "expected_type": m.expected_type.value if hasattr(m.expected_type, 'value') else str(m.expected_type),
            "prompt_instruction": m.prompt_instruction,
            "is_system": m.is_system,
            "is_active": m.is_active,
            "created_at": m.created_at,
            "updated_at": m.updated_at,
        }
        for m in metrics
    ]

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": items
    }


@router.post("/metrics", status_code=201)
async def create_system_metric(
    body: MetricAdminCreate,
    current_admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    创建新的系统指标定义（管理员专用）。

    创建的指标 is_system=True，自动归属于当前管理员用户。
    会校验 metric_key 在全局范围内的唯一性。
    """
    # 检查 metric_key 唯一性（所有用户 + 所有系统指标）
    existing = db.query(MetricDefinition).filter(
        MetricDefinition.metric_key == body.metric_key
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"指标键 '{body.metric_key}' 已存在（{'系统预置' if existing.is_system else '用户自定义'}指标）"
        )

    metric = MetricDefinition(
        user_id=current_admin.id,
        metric_key=body.metric_key,
        metric_label=body.metric_label,
        expected_type=body.expected_type.value if hasattr(body.expected_type, 'value') else body.expected_type,
        prompt_instruction=body.prompt_instruction,
        is_system=True,
        is_active=body.is_active,
    )
    db.add(metric)
    db.commit()
    db.refresh(metric)

    return {
        "status": "success",
        "message": "系统指标模版创建成功",
        "data": MetricDefinitionData(
            id=metric.id,
            metric_key=metric.metric_key,
            metric_label=metric.metric_label,
            expected_type=metric.expected_type.value if hasattr(metric.expected_type, 'value') else str(metric.expected_type),
            prompt_instruction=metric.prompt_instruction,
            is_system=metric.is_system,
            is_active=metric.is_active,
        )
    }


@router.put("/metrics/{metric_id}")
async def update_system_metric(
    metric_id: int,
    body: MetricAdminUpdate,
    current_admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    更新系统指标定义（管理员专用）。

    可更新字段：metric_label, expected_type, prompt_instruction, is_active。
    仅允许修改 is_system=True 的指标。
    """
    metric = db.query(MetricDefinition).filter(MetricDefinition.id == metric_id).first()

    if not metric:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="指标定义不存在"
        )

    if not metric.is_system:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该接口仅支持管理系统预置指标，用户自定义指标请使用 /metrics/definitions 接口"
        )

    # 部分更新：仅更新请求体中提供的字段
    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key == "expected_type" and hasattr(value, 'value'):
            value = value.value
        setattr(metric, key, value)

    db.commit()
    db.refresh(metric)

    return {
        "status": "success",
        "message": "系统指标模版更新成功",
        "data": MetricDefinitionData(
            id=metric.id,
            metric_key=metric.metric_key,
            metric_label=metric.metric_label,
            expected_type=metric.expected_type.value if hasattr(metric.expected_type, 'value') else str(metric.expected_type),
            prompt_instruction=metric.prompt_instruction,
            is_system=metric.is_system,
            is_active=metric.is_active,
        )
    }


@router.delete("/metrics/{metric_id}")
async def delete_system_metric(
    metric_id: int,
    current_admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    删除系统指标定义（管理员专用）。

    仅允许删除 is_system=True 的指标。
    关联的 batch_metric_relations 会通过 CASCADE 自动删除。
    """
    metric = db.query(MetricDefinition).filter(MetricDefinition.id == metric_id).first()

    if not metric:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="指标定义不存在"
        )

    if not metric.is_system:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该接口仅支持删除系统预置指标，用户自定义指标请使用 /metrics/definitions 接口"
        )

    metric_label = metric.metric_label
    db.delete(metric)
    db.commit()

    return {
        "status": "success",
        "message": f"系统指标模版「{metric_label}」已删除"
    }


@router.patch("/metrics/{metric_id}/active")
async def toggle_system_metric_active(
    metric_id: int,
    current_admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    快速切换系统指标的启用/禁用状态（管理员专用）。

    返回切换后的新状态。
    """
    metric = db.query(MetricDefinition).filter(MetricDefinition.id == metric_id).first()

    if not metric:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="指标定义不存在"
        )

    if not metric.is_system:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该接口仅支持操作系统预置指标"
        )

    metric.is_active = not metric.is_active
    db.commit()
    db.refresh(metric)

    return {
        "status": "success",
        "message": f"指标模版「{metric.metric_label}」已{'启用' if metric.is_active else '禁用'}",
        "is_active": metric.is_active
    }


# ========== 指标合集模版管理（管理员专用）==========

@router.get("/templates")
async def get_all_templates(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    category: Optional[str] = Query(None, description="Filter by category"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    is_system: Optional[bool] = Query(None, description="Filter by system/user template"),
    current_admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    获取所有指标合集模版（管理员专用，含已禁用的模版和用户创建的模版）。

    支持按 category、is_active、is_system 筛选，分页返回。
    """
    query = db.query(MetricTemplate)

    if category:
        query = query.filter(MetricTemplate.category == category)
    if is_active is not None:
        query = query.filter(MetricTemplate.is_active == is_active)
    if is_system is not None:
        query = query.filter(MetricTemplate.is_system == is_system)

    total = query.count()
    offset = (page - 1) * page_size
    templates = query.order_by(
        MetricTemplate.is_system.desc(),
        MetricTemplate.created_at.desc()
    ).offset(offset).limit(page_size).all()

    items = []
    for t in templates:
        metrics_list = []
        if t.metrics:
            for m in t.metrics:
                metrics_list.append({
                    "metric_key": m.get("key", ""),
                    "metric_label": m.get("label", ""),
                    "expected_type": m.get("type", "NUMERIC"),
                    "prompt_instruction": m.get("prompt_instruction"),
                    "disabled": m.get("disabled", False),
                })

        items.append({
            "id": t.id,
            "name": t.name,
            "description": t.description,
            "category": t.category,
            "is_system": t.is_system,
            "is_active": t.is_active if hasattr(t, 'is_active') else True,
            "user_id": t.user_id,
            "metrics": metrics_list,
            "metric_count": len(metrics_list),
            "created_at": t.created_at,
            "updated_at": t.updated_at,
        })

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": items
    }


@router.post("/templates", status_code=201)
async def admin_create_template(
    body: TemplateAdminCreate,
    current_admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    创建指标合集模版（管理员专用）。

    可指定 is_system（是否系统模版）、is_active（是否启用）和 metrics 列表。
    """
    # 后端校验：同一合集中不允许重复的指标键
    seen_keys = set()
    for m in body.metrics:
        if m.metric_key in seen_keys:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"指标键「{m.metric_key}」在同一合集中重复出现，不允许创建相同的指标键"
            )
        seen_keys.add(m.metric_key)

    metrics_json = [
        {
            "key": m.metric_key,
            "label": m.metric_label,
            "type": m.expected_type,
            "prompt_instruction": m.prompt_instruction,
            "disabled": m.disabled,
        }
        for m in body.metrics
    ]

    template = MetricTemplate(
        name=body.name,
        description=body.description,
        category=body.category,
        is_system=body.is_system,
        is_active=body.is_active,
        user_id=current_admin.id if not body.is_system else None,
        metrics=metrics_json,
    )
    db.add(template)
    db.commit()
    db.refresh(template)

    return {
        "status": "success",
        "message": f"指标合集模版「{template.name}」创建成功",
        "data": {
            "id": template.id,
            "name": template.name,
            "is_system": template.is_system,
            "is_active": template.is_active,
            "metric_count": len(metrics_json),
        }
    }


@router.put("/templates/{template_id}")
async def admin_update_template(
    template_id: int,
    body: TemplateAdminUpdate,
    current_admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    更新指标合集模版（管理员专用）。

    可修改任意模版（含系统模版），支持部分更新。
    含 metrics 完整数组替换和 is_active 切换。
    """
    template = db.query(MetricTemplate).filter(MetricTemplate.id == template_id).first()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="合集模版不存在"
        )

    update_data = body.model_dump(exclude_unset=True)

    # 如果更新了 metrics，转换为 JSON 字典列表
    if "metrics" in update_data:
        if update_data["metrics"] is None:
            raise HTTPException(status_code=422, detail="metrics 不能为 null")
        # 后端校验：同一合集中不允许重复的指标键
        seen_keys = set()
        for m in body.metrics:
            if m.metric_key in seen_keys:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"指标键「{m.metric_key}」在同一合集中重复出现，不允许相同的指标键"
                )
            seen_keys.add(m.metric_key)
        update_data["metrics"] = [
            {
                "key": m.metric_key,
                "label": m.metric_label,
                "type": m.expected_type,
                "prompt_instruction": m.prompt_instruction,
                "disabled": m.disabled,
            }
            for m in body.metrics
        ]

    for field, value in update_data.items():
        setattr(template, field, value)

    # 当更新了 metrics 或 is_active 时，级联同步到系统指标定义
    needs_sync = "metrics" in update_data or "is_active" in update_data
    synced = _cascade_sync_template_metrics(db, template) if needs_sync else 0

    db.commit()
    db.refresh(template)

    metrics_count = len(template.metrics) if template.metrics else 0

    msg = f"合集模版「{template.name}」更新成功"
    if synced > 0:
        msg += f"，同步影响 {synced} 个系统指标定义"

    return {
        "status": "success",
        "message": msg,
        "data": {
            "id": template.id,
            "name": template.name,
            "is_system": template.is_system,
            "is_active": template.is_active,
            "metric_count": metrics_count,
        }
    }


@router.delete("/templates/{template_id}")
async def admin_delete_template(
    template_id: int,
    current_admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    删除指标合集模版（管理员专用）。

    可删除任意模版（含系统模版）。
    """
    template = db.query(MetricTemplate).filter(MetricTemplate.id == template_id).first()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="合集模版不存在"
        )

    template_name = template.name
    db.delete(template)
    db.commit()

    return {
        "status": "success",
        "message": f"合集模版「{template_name}」已删除"
    }


@router.patch("/templates/{template_id}/active")
async def admin_toggle_template_active(
    template_id: int,
    current_admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    快速切换合集模版的启用/禁用状态（管理员专用）。
    """
    template = db.query(MetricTemplate).filter(MetricTemplate.id == template_id).first()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="合集模版不存在"
        )

    template.is_active = not template.is_active
    synced = _cascade_sync_template_metrics(db, template)
    db.commit()
    db.refresh(template)

    action = "启用" if template.is_active else "禁用"
    msg = f"合集模版「{template.name}」已{action}"
    if synced > 0:
        msg += f"，同步{action}了 {synced} 个系统指标定义"

    return {
        "status": "success",
        "message": msg,
        "is_active": template.is_active,
        "synced_metrics": synced,
    }


@router.patch("/templates/toggle-all")
async def admin_bulk_toggle_system_templates(
    body: TemplateBulkToggle,
    current_admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    一键启用/禁用所有系统合集模版（管理员专用）。

    会级联同步所有系统预置指标的 MetricDefinition.is_active 状态。
    """
    # 先查询所有系统模版（更新前获取 metrics 数据）
    system_templates = db.query(MetricTemplate).filter(
        MetricTemplate.is_system == True
    ).all()

    # 批量更新模版的 is_active 状态
    affected = db.query(MetricTemplate).filter(
        MetricTemplate.is_system == True
    ).update(
        {MetricTemplate.is_active: body.is_active}
    )

    # 收集所有系统模版中的唯一 metric_key
    all_keys: set = set()
    for tpl in system_templates:
        if tpl.metrics:
            for m in tpl.metrics:
                key = m.get("key", "")
                if key:
                    all_keys.add(key)

    # 批量级联同步到系统指标定义
    synced = 0
    if all_keys:
        synced = db.query(MetricDefinition).filter(
            MetricDefinition.is_system == True,
            MetricDefinition.metric_key.in_(list(all_keys)),
            MetricDefinition.is_active != body.is_active,
        ).update(
            {MetricDefinition.is_active: body.is_active},
            synchronize_session=False,
        )

    db.commit()

    action = "启用" if body.is_active else "禁用"
    msg = f"已{action} {affected} 个系统合集模版"
    if synced > 0:
        msg += f"，同步{action}了 {synced} 个系统指标定义"

    return {
        "status": "success",
        "message": msg,
        "affected": affected,
        "synced_metrics": synced,
    }