"""
Extracted metric model for storing AI-extracted data.
采用 EAV（实体-属性-值）结构，支持动态指标扩展。
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, DECIMAL, Float, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class ExtractedMetric(Base):
    """
    提取结果表（多维标准化设计，完美支持前端横向对比矩阵）
    
    功能说明：
    - 采用 EAV（实体-属性-值）结构，支持动态指标扩展
    - metric_name: 系统内部标识，如: revenue, buyback_shares
    - metric_display_name: 前端显示名，如: 营业收入, 购回股份数量
    - metric_value_num: 强类型数值，方便前端排序、过滤和做异常检测
    - metric_value_raw: 原始文本值，允许为 NULL
    - fiscal_year: 对应的时期/财年
    - unit: 单位，如: 元, 股, %
    - confidence: AI 置信度
    """
    __tablename__ = "extracted_metrics"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    report_id = Column(Integer, ForeignKey("reports.id", ondelete="CASCADE"), nullable=False)
    
    # 指标名称
    metric_name = Column(String(100), nullable=False)       # 系统内部标识
    metric_display_name = Column(String(100), nullable=False) # 前端显示名
    
    # 指标值
    metric_value_num = Column(DECIMAL(18, 4), nullable=True)   # 强类型数值
    metric_value_raw = Column(String(500), nullable=True)      # 原始文本值
    
    # 附加信息
    fiscal_year = Column(String(20), nullable=True)   # 时期/财年
    unit = Column(String(50), nullable=True)         # 单位
    confidence = Column(Float, default=1.0)          # AI 置信度
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 索引：加速报告指标查询
    __table_args__ = (
        Index('idx_report_metric', 'report_id'),
    )

    # Relationships
    report = relationship("Report", back_populates="metrics")

    def __repr__(self):
        return f"<ExtractedMetric(id={self.id}, report_id={self.report_id}, metric='{self.metric_name}')>"
