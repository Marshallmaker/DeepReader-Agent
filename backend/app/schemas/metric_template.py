"""
指标模板相关的 Pydantic Schema 定义。
提供模板创建、更新、列表、导入等请求/响应模型。
"""
from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime


class MetricItem(BaseModel):
    """模板中包含的单个指标项"""
    metric_key: str = Field(..., min_length=1, max_length=100, description="指标唯一键")
    metric_label: str = Field(..., min_length=1, max_length=100, description="指标显示名称")
    expected_type: Literal["NUMERIC", "TEXT"] = Field(default="NUMERIC", description="期望类型")
    prompt_instruction: Optional[str] = Field(None, max_length=500, description="该指标的专属提示词")


class TemplateCreate(BaseModel):
    """创建指标模板请求模型"""
    name: str = Field(..., min_length=1, max_length=100, description="模板名称")
    description: Optional[str] = Field(None, max_length=500, description="模板描述")
    category: Optional[str] = Field(None, max_length=50, description="模板分类")
    metrics: List[MetricItem] = Field(..., min_length=1, max_length=100, description="指标列表")


class TemplateUpdate(BaseModel):
    """更新指标模板请求模型（全部字段可选）"""
    name: Optional[str] = Field(None, min_length=1, max_length=100, description="模板名称")
    description: Optional[str] = Field(None, max_length=500, description="模板描述")
    category: Optional[str] = Field(None, max_length=50, description="模板分类")
    metrics: Optional[List[MetricItem]] = Field(None, min_length=1, max_length=100, description="指标列表")


class TemplateResponse(BaseModel):
    """指标模板响应模型"""
    id: int
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    is_system: bool = False
    user_id: Optional[int] = None
    metrics: List[MetricItem] = []
    metric_count: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TemplateListResponse(BaseModel):
    """指标模板列表响应模型"""
    status: str = "success"
    data: List[TemplateResponse]


class TemplateImportResponse(BaseModel):
    """指标模板导入响应模型"""
    status: str = "success"
    message: str
    created_count: int = 0
    skipped_count: int = 0
