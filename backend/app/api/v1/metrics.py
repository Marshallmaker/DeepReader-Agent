"""
自定义指标管理 API 接口。
支持用户自定义新增、获取、删除提取指标。
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from typing import List
from app.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.metric_definition import MetricDefinition, ExpectedType
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
    # 校验 metric_key 是否在该用户下唯一
    existing = db.query(MetricDefinition).filter(
        MetricDefinition.user_id == current_user.id,
        MetricDefinition.metric_key == data.metric_key
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
    # 获取所有指标（系统预置指标和用户自定义指标）
    all_metrics = db.query(MetricDefinition).filter(
        or_(
            MetricDefinition.is_system == True,
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
                "is_system": m.is_system
            }
            for m in unique_metrics
        ]
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