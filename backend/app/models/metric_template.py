"""
指标模板模型。
支持用户级指标模板管理，提供预置模板和自定义模板能力。
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class MetricTemplate(Base):
    """
    指标模板表模型

    功能说明：
    - 支持用户级指标模板管理
    - 系统预置模板（is_system=True）对所有用户可见，但不可编辑、不可删除
    - 用户自定义模板（is_system=False, user_id 指向具体用户）可自由编辑和删除
    - metrics 字段以 JSON 数组存储模板包含的指标定义：
      [{key, label, type, prompt_instruction}, ...]
    """
    __tablename__ = "metric_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, comment="模板名称")
    description = Column(String(500), nullable=True)
    category = Column(String(50), nullable=True)
    is_system = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True, nullable=False, comment="模板是否启用（管理员可禁用）")
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    metrics = Column(JSON, nullable=False, comment="[{key,label,type,prompt_instruction}]")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系映射
    user = relationship("User", back_populates="metric_templates")

    def __repr__(self):
        return f"<MetricTemplate(id={self.id}, name='{self.name}', is_system={self.is_system})>"
