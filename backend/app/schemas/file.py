"""
文件管理相关 Schema — 跨批次文件列表。
"""
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class FileListItem(BaseModel):
    """跨批次文件列表项"""
    report_id: int
    original_filename: str
    batch_id: int
    batch_name: Optional[str] = None
    entity_name: Optional[str] = None
    status: str
    file_size: int
    created_at: datetime

    class Config:
        from_attributes = True


class FileListResponse(BaseModel):
    """跨批次文件列表响应"""
    total: int
    page: int
    page_size: int
    items: List[FileListItem]
