"""
指标数据相关的 Pydantic Schema 定义。
包含提取结果、指标定义、可视化数据等响应模型。
"""
from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict
from datetime import datetime
from enum import Enum


class ExpectedTypeEnum(str, Enum):
    """指标期望类型枚举"""
    NUMERIC = "NUMERIC"
    TEXT = "TEXT"


# ========== 指标定义相关 Schema ==========

class MetricDefinitionCreate(BaseModel):
    """创建指标定义请求模型"""
    metric_key: str = Field(..., min_length=1, max_length=100, description="传给大模型的标准 JSON Key")
    metric_label: str = Field(..., min_length=1, max_length=100, description="前端界面显示的中文名")
    expected_type: ExpectedTypeEnum = Field(default=ExpectedTypeEnum.NUMERIC, description="期望类型")
    prompt_instruction: Optional[str] = Field(None, max_length=500, description="AI 提取该指标时的专属微型提示词")


class MetricUpdate(BaseModel):
    """更新指标定义请求模型（仅允许修改 label、expected_type 和 prompt_instruction）"""
    metric_label: Optional[str] = Field(None, min_length=1, max_length=100, description="前端界面显示的中文名")
    expected_type: Optional[ExpectedTypeEnum] = Field(None, description="期望类型")
    prompt_instruction: Optional[str] = Field(None, max_length=500, description="AI 提取该指标时的专属微型提示词")


class MetricDefinitionData(BaseModel):
    """指标定义数据模型"""
    id: int
    metric_key: str
    metric_label: str
    expected_type: str
    prompt_instruction: Optional[str] = None
    is_system: bool = False


class MetricDefinitionResponse(BaseModel):
    """指标定义响应模型"""
    status: str = "success"
    message: str = "自定义指标配置创建成功。"
    data: MetricDefinitionData


class MetricDefinitionListResponse(BaseModel):
    """指标定义列表响应模型"""
    status: str = "success"
    data: List[MetricDefinitionData]


# ========== 提取结果相关 Schema ==========

class MetricResponse(BaseModel):
    """单个指标响应模型"""
    id: int
    report_id: int
    company_name: Optional[str] = None
    stock_code: Optional[str] = None
    submission_date: Optional[str] = None
    repurchase_date: Optional[str] = None
    shares_repurchased: Optional[float] = None
    highest_price_paid: Optional[float] = None
    lowest_price_paid: Optional[float] = None
    total_consideration: Optional[float] = None

    class Config:
        from_attributes = True


class MetricColumnDef(BaseModel):
    """对比矩阵列定义 — 描述一列对应哪个指标"""
    metric_key: str          # 内部标识，如 "shares_repurchased"
    metric_label: str        # 显示名称，如 "购回股份数目"
    expected_type: str       # "NUMERIC" 或 "TEXT"


class ReportCompareItem(BaseModel):
    """对比矩阵中单条报告的行数据 — 指标值以动态字典存储"""
    report_id: int
    filename: str
    metrics: Dict[str, Any]          # key=metric_key, value=数值或文本或None
    anomalies: Dict[str, str] = {}   # key=metric_key, value="high"|"low"


class MetricMatrixResponse(BaseModel):
    """指标矩阵响应模型"""
    batch_id: int
    batch_name: Optional[str] = None
    total_reports: int
    metric_definitions: List[MetricColumnDef]  # 列定义列表
    reports: List[ReportCompareItem]


# ========== 批次指标标签（用于批次列表和兼容性校验）==========

class MetricTagInfo(BaseModel):
    """轻量指标标签"""
    metric_key: str
    metric_label: str
    expected_type: str       # "NUMERIC" 或 "TEXT"


# ========== 可视化数据相关 Schema ==========

class MultiSeriesDataPoint(BaseModel):
    """多系列图表的数据点"""
    fiscal_year: str = ""              # 趋势图 X 轴
    entity_name: Optional[str] = None  # 来源公司
    report_name: Optional[str] = None  # 来源报告（柱状图 X 轴）
    report_id: Optional[int] = None    # 来源报告 ID（用于异常标注匹配）
    batch_id: Optional[int] = None     # 来源批次
    value: Optional[float] = None
    unit: Optional[str] = None
    is_anomaly: Optional[bool] = False      # 是否为异常数据点
    anomaly_deviation: Optional[float] = None  # 异常偏离度


class SeriesData(BaseModel):
    """一个指标对应的完整系列"""
    metric_key: str
    metric_label: str
    data: List[MultiSeriesDataPoint]


class MultiSeriesTrendResponse(BaseModel):
    """多指标趋势图响应"""
    status: str = "success"
    chart_type: str = "LINE"
    batch_ids: List[int] = []
    series: List[SeriesData]


class MultiSeriesComparisonResponse(BaseModel):
    """多指标柱状图响应"""
    status: str = "success"
    chart_type: str = "BAR"
    batch_ids: List[int] = []
    series: List[SeriesData]