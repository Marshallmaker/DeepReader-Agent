"""
User schemas for authentication.
"""
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime


class UserCreate(BaseModel):
    """User registration request schema."""
    email: EmailStr = Field(..., description="User email address")
    password: str = Field(..., min_length=6, max_length=100, description="User password")
    nickname: Optional[str] = Field(None, max_length=100, description="User nickname")
    verification_code: str = Field(..., min_length=6, max_length=6, description="6-digit verification code")


class UserLogin(BaseModel):
    """User login request schema."""
    email: EmailStr = Field(..., description="User email address")
    password: str = Field(..., description="User password")


class UserUpdate(BaseModel):
    """User profile update request schema — 仅支持直接修改昵称，邮箱修改需走验证码流程."""
    nickname: Optional[str] = Field(None, max_length=100, description="New nickname")


class ChangeEmailSendCodeRequest(BaseModel):
    """Request to send verification code for email change."""
    new_email: EmailStr = Field(..., description="New email address to verify")


class ChangeEmailVerifyRequest(BaseModel):
    """Request to verify code and complete email change."""
    new_email: EmailStr = Field(..., description="New email address")
    verification_code: str = Field(..., min_length=6, max_length=6, description="6-digit verification code")


class RegisterSendCodeRequest(BaseModel):
    """Request to send verification code for registration."""
    email: EmailStr = Field(..., description="Email address to register with")


class CheckEmailRequest(BaseModel):
    """Request to check if an email is already registered."""
    email: EmailStr = Field(..., description="Email address to check")


class UserResponse(BaseModel):
    """User response schema."""
    id: int
    email: str
    nickname: Optional[str] = None
    is_admin: bool = False
    is_active: bool = True
    avatar_url: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class Token(BaseModel):
    """Token response schema."""
    access_token: str
    refresh_token: str
    is_admin: bool = False
    token_type: str = "bearer"


class TokenRefresh(BaseModel):
    """Token refresh response schema."""
    access_token: str
    token_type: str = "bearer"


class ForgotPasswordApply(BaseModel):
    """Forgot password application request schema."""
    email: EmailStr = Field(..., description="User email address")


class ForgotPasswordReset(BaseModel):
    """Forgot password reset request schema."""
    email: EmailStr = Field(..., description="User email address")
    verification_code: str = Field(..., min_length=6, max_length=6, description="6-digit verification code")
    new_password: str = Field(..., min_length=6, max_length=100, description="New password")


class ForgotPasswordResponse(BaseModel):
    """Forgot password response schema."""
    status: str
    message: str