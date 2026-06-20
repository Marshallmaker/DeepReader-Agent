"""
Report schemas for PDF report management.
"""
from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime


class MetricData(BaseModel):
    """Extracted metric data schema."""
    company_name: Optional[str] = None
    stock_code: Optional[str] = None
    submission_date: Optional[str] = None
    repurchase_date: Optional[str] = None
    shares_repurchased: Optional[float] = None
    highest_price_paid: Optional[float] = None
    lowest_price_paid: Optional[float] = None
    total_consideration: Optional[float] = None


class ReportResponse(BaseModel):
    """Report response schema."""
    id: int
    batch_id: int
    original_filename: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class ReportDetailResponse(BaseModel):
    """Report detail response with metrics."""
    id: int
    batch_id: int
    original_filename: str
    status: str
    raw_markdown: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    metrics: Optional[MetricData] = None

    class Config:
        from_attributes = True


class ReportSummary(BaseModel):
    """Report summary for batch listing."""
    id: int
    batch_id: int
    original_filename: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class ReportCompareResponse(BaseModel):
    """Report comparison response for matrix display."""
    report_id: int
    filename: str
    stock_code: Optional[str] = None
    metrics: MetricData
    anomalies: Optional[dict] = None  # Anomaly detection results