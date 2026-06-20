"""
用户自定义指标配置模型。
支持租户级动态指标解耦与 AI 提示词引导。
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum, Boolean, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import enum


class ExpectedType(str, enum.Enum):
    """指标期望类型枚举"""
    NUMERIC = "NUMERIC"  # 数值型指标
    TEXT = "TEXT"        # 文本型指标


class MetricDefinition(Base):
    """
    用户自定义指标配置表模型
    
    功能说明：
    - 支持租户级指标隔离，每个用户可自定义自己的指标集
    - metric_key: 传给大模型的标准 JSON Key
    - metric_label: 前端界面显示的中文名
    - expected_type: 期望类型，便于后端分流写入 num 或 raw 字段
    - prompt_instruction: 指导 AI 提取该指标时的专属微型提示词引导
    """
    __tablename__ = "metric_definitions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    
    # 归属于具体用户，实现租户级指标隔离
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    # 传给大模型的标准 JSON Key，如: net_profit, sample_size
    metric_key = Column(String(100), nullable=False)
    
    # 前端界面显示的中文名，如: 净利润, 样本量
    metric_label = Column(String(100), nullable=False)
    
    # 期望类型，便于后端分流写入 num 或 raw 字段
    expected_type = Column(Enum(ExpectedType), default=ExpectedType.NUMERIC, nullable=False)
    
    # 指导 AI 提取该指标时的专属微型提示词引导
    prompt_instruction = Column(String(500), nullable=True)
    
    # 是否为系统预置指标（管理员 user_id=1 的指标为系统默认指标）
    is_system = Column(Boolean, default=False, nullable=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 唯一约束：同一用户的 metric_key 必须唯一
    __table_args__ = (
        Index('uidx_user_key', 'user_id', 'metric_key', unique=True),
    )

    # 关系映射
    user = relationship("User", back_populates="metric_definitions")
    batch_relations = relationship("BatchMetricRelation", back_populates="metric_definition", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<MetricDefinition(id={self.id}, key='{self.metric_key}', label='{self.metric_label}')>"


class BatchMetricRelation(Base):
    """
    上传批次与自定义指标集多对多关联映射表
    
    功能说明：
    - 解决批次与指标集的绑定断层问题
    - Celery 异步任务启动时，必须根据 batch_id 联查此表获取当前批次绑定的指标子集
    - 确保大模型 Prompt 指令的高聚焦度与 Token 经济性
    """
    __tablename__ = "batch_metric_relations"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    
    # 关联的上传批次 ID
    batch_id = Column(Integer, ForeignKey("upload_batches.id", ondelete="CASCADE"), nullable=False)
    
    # 关联的用户自定义指标定义 ID
    metric_def_id = Column(Integer, ForeignKey("metric_definitions.id", ondelete="CASCADE"), nullable=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # 唯一约束：同一批次不能重复绑定同一指标
    __table_args__ = (
        Index('uidx_batch_metric', 'batch_id', 'metric_def_id', unique=True),
    )

    # 关系映射
    batch = relationship("UploadBatch", back_populates="metric_relations")
    metric_definition = relationship("MetricDefinition", back_populates="batch_relations")

    def __repr__(self):
        return f"<BatchMetricRelation(batch_id={self.batch_id}, metric_def_id={self.metric_def_id})>"