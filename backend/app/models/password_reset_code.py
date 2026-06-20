"""
忘记密码验证码安全审计表模型。
完美支持新码熔断旧码、重试上限与风控留痕。
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Index
from sqlalchemy.sql import func
from app.database import Base


class PasswordResetCode(Base):
    """
    密码重置验证码生命周期与风控审计表
    
    功能说明：
    - 存储6位验证码的 SHA-256 哈希值，严禁明文存储
    - retry_count: 累计输错尝试次数，单码达 5 次自动报废
    - is_used: 状态机核心，重置成功时、或被新请求的验证码覆盖废弃时，统一置为 TRUE
    - expired_at: 刚性生命周期控制（通常为创建时间 + 10分钟）
    """
    __tablename__ = "password_reset_codes"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    
    # 用户邮箱
    email = Column(String(255), nullable=False)
    
    # 存储6位验证码的 SHA-256 哈希值，严禁明文存储
    code_hash = Column(String(64), nullable=False)
    
    # 累计输错尝试次数，单码达 5 次自动报废
    retry_count = Column(Integer, default=0, nullable=False)
    
    # 状态机核心：重置成功时、或被新请求的验证码覆盖废弃时，统一置为 TRUE
    is_used = Column(Boolean, default=False, nullable=False)
    
    # 刚性生命周期控制（通常为创建时间 + 10分钟）
    expired_at = Column(DateTime(timezone=True), nullable=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 高频检索与覆盖状态更新时的复合索引
    __table_args__ = (
        Index('idx_email_lookup', 'email', 'is_used', 'expired_at'),
    )

    def __repr__(self):
        return f"<PasswordResetCode(email='{self.email}', is_used={self.is_used}, retry_count={self.retry_count})>"