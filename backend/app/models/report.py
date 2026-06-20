"""
Report model for storing PDF report information.
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum, Text, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import enum


class ReportStatus(str, enum.Enum):
    """Report processing status."""
    PENDING = "pending"
    PARSING = "parsing"
    EXTRACTING = "extracting"
    SUCCESS = "success"
    FAILED = "failed"


class Report(Base):
    """Report model for storing PDF report information."""
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    batch_id = Column(Integer, ForeignKey("upload_batches.id", ondelete="CASCADE"), nullable=False)
    original_filename = Column(String(255), nullable=False)
    stored_path = Column(String(500), nullable=False)
    pdf_md5 = Column(String(32), index=True, nullable=False)
    file_size = Column(Integer, nullable=False)
    status = Column(Enum(ReportStatus), default=ReportStatus.PENDING, nullable=False)
    raw_markdown = Column(Text, nullable=True)
    entity_name = Column(String(255), nullable=True)  # AI提取的实体名称，加速跨批次趋势查询
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 索引：加速 MD5 去重查询
    __table_args__ = (
        Index('idx_pdf_md5', 'pdf_md5'),
    )

    # Relationships
    batch = relationship("UploadBatch", back_populates="reports")
    metrics = relationship("ExtractedMetric", back_populates="report", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Report(id={self.id}, filename='{self.original_filename}', status='{self.status}')>"