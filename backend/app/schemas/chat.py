"""
Chat schemas for AI conversation functionality.
"""
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class ChatRequest(BaseModel):
    """Chat request schema."""
    report_id: Optional[int] = Field(None, description="Report ID for context injection")
    session_id: str = Field(..., description="Session ID for conversation tracking")
    prompt: str = Field(..., min_length=1, description="User prompt message")


class ChatMessageResponse(BaseModel):
    """Chat message response schema."""
    id: int
    session_id: str
    role: str
    content: str
    created_at: datetime

    class Config:
        from_attributes = True


class ChatHistoryResponse(BaseModel):
    """Chat history response schema."""
    session_id: str
    report_id: Optional[int] = None
    messages: list[ChatMessageResponse]


class SessionSummaryResponse(BaseModel):
    """会话摘要（用于侧边栏列表）"""
    session_id: str
    title: Optional[str] = None
    report_id: Optional[int] = None
    first_message: Optional[str] = None
    message_count: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SessionListResponse(BaseModel):
    """会话列表响应"""
    sessions: list[SessionSummaryResponse]
    total: int


class SessionCreateRequest(BaseModel):
    """创建会话请求"""
    report_id: Optional[int] = Field(None, description="可选：创建时绑定报告")


class SessionRenameRequest(BaseModel):
    """重命名会话请求"""
    title: str = Field(..., min_length=1, max_length=200, description="新标题")