"""
指标模板相关的 Pydantic Schema 定义。
提供模板创建、更新、列表、导入等请求/响应模型。
"""
from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime


class MetricItem(BaseModel):
    """模板中包含的单个指标项"""
    metric_key: str = Field(
        ...,
        min_length=1,
        max_length=100,
        pattern=r"^[a-z_][a-z0-9_]*$",
        description="指标唯一键（仅支持小写字母、数字和下划线，必须以字母或下划线开头）",
    )
    metric_label: str = Field(..., min_length=1, max_length=100, description="指标显示名称")
    expected_type: Literal["NUMERIC", "TEXT"] = Field(default="NUMERIC", description="期望类型")
    prompt_instruction: Optional[str] = Field(None, max_length=500, description="该指标的专属提示词")
    disabled: bool = Field(default=False, description="该指标是否被管理员禁用（在合集中不启用）")


class MetricItemAdmin(MetricItem):
    """管理员视角的指标项（明确包含 disabled 字段）"""
    pass


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
    is_active: bool = True
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


# ========== 管理员模版管理 Schema ==========

class TemplateAdminCreate(BaseModel):
    """管理员创建模版请求模型"""
    name: str = Field(..., min_length=1, max_length=100, description="模板名称")
    description: Optional[str] = Field(None, max_length=500, description="模板描述")
    category: Optional[str] = Field(None, max_length=50, description="模板分类")
    is_system: bool = Field(default=False, description="是否为系统预置模版")
    is_active: bool = Field(default=True, description="是否默认启用")
    metrics: List[MetricItemAdmin] = Field(..., min_length=1, max_length=100, description="指标列表")


class TemplateAdminUpdate(BaseModel):
    """管理员更新模版请求模型（全部字段可选）"""
    name: Optional[str] = Field(None, min_length=1, max_length=100, description="模板名称")
    description: Optional[str] = Field(None, max_length=500, description="模板描述")
    category: Optional[str] = Field(None, max_length=50, description="模板分类")
    is_active: Optional[bool] = Field(None, description="是否启用")
    metrics: Optional[List[MetricItemAdmin]] = Field(None, min_length=1, max_length=100, description="指标列表")


class TemplateBulkToggle(BaseModel):
    """批量切换模版启用状态请求模型"""
    is_active: bool = Field(..., description="目标启用状态")
