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