"""
Upload batch model for tracking file upload sessions.
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import enum


class BatchStatus(str, enum.Enum):
    """Batch processing status."""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL = "partial"


class UploadBatch(Base):
    """Upload batch model for tracking file upload sessions."""
    __tablename__ = "upload_batches"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    batch_name = Column(String(255), nullable=False)
    status = Column(Enum(BatchStatus), default=BatchStatus.PENDING, nullable=False)
    total_files = Column(Integer, default=0, nullable=False)
    processed_files = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 索引：加速用户批次查询
    __table_args__ = (
        Index('idx_user_batches', 'user_id'),
    )

    # Relationships
    user = relationship("User", back_populates="batches")
    reports = relationship("Report", back_populates="batch", cascade="all, delete-orphan")
    metric_relations = relationship("BatchMetricRelation", back_populates="batch", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<UploadBatch(id={self.id}, status='{self.status}', total_files={self.total_files})>"