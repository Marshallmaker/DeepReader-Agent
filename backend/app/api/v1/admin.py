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

router = APIRouter()


@router.get("/users")
async def get_users(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(10, ge=1, le=100, description="Items per page"),
    search_keyword: Optional[str] = Query(None, description="Search by email or nickname"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
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
    results = query.order_by(User.created_at.desc()).offset(offset).limit(page_size).all()

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