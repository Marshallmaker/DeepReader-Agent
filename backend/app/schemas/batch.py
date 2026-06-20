"""
Batch schemas for upload batch management.
"""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from app.schemas.metric import MetricTagInfo


class BatchCreate(BaseModel):
    """Batch creation request schema."""
    batch_name: Optional[str] = Field(None, max_length=255, description="Batch name")


class ReportSummary(BaseModel):
    """Report summary for batch response."""
    id: int
    original_filename: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class BatchResponse(BaseModel):
    """Batch response schema."""
    batch_id: int
    batch_name: Optional[str] = None
    status: str
    total_files: int
    processed_files: int
    created_at: datetime
    metric_tags: List[MetricTagInfo] = []  # 批次绑定的指标标签列表

    class Config:
        from_attributes = True


class BatchListResponse(BaseModel):
    """Paginated batch list response."""
    total: int
    page: int
    page_size: int
    items: List[BatchResponse]


class BatchDetailResponse(BaseModel):
    """Batch detail response with reports."""
    batch_id: int
    batch_name: Optional[str] = None
    status: str
    total_files: int
    processed_files: int
    created_at: datetime
    reports: List[ReportSummary]
    metric_tags: List[MetricTagInfo] = []

    class Config:
        from_attributes = True