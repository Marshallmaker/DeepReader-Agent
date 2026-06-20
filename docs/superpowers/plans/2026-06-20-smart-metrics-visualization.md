# 智能指标系统与自动可视化 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 AI 推荐 + 模板 + 一键批量创建指标系统，实现批次详情页自动可视化图表矩阵，新增 4 种图表类型，通用化异常检测引擎，智能降载大数据量。

**Architecture:** 后端新增 `metric_templates` 表 + `templates.py` API + `ai_metric_recommender.py` 服务；前端新增 `ChartRegistry` 工厂 + 6 种独立图表组件 + `AutoChartGrid` + `useDataReducer` hook；异常检测从硬编码 4 个指标改为通用 NUMERIC 指标自动适配。

**Tech Stack:** Python FastAPI + SQLAlchemy + Celery | React 18 + TypeScript + ECharts 6 + echarts-for-react

## Global Constraints

- Python 3.10+, FastAPI, SQLAlchemy ORM
- React 18 + TypeScript, ECharts 6.1.0, echarts-for-react 3.0.6
- MySQL 8.0.30, utf8mb4_unicode_ci
- 现有 API 路径和响应格式不变（向后兼容）
- 系统预置指标（is_system=True）不可编辑、不可删除
- AI 推荐依赖 SiliconFlow API（DeepSeek-V3），response_format: json_object
- 异常检测结果运行时计算，不持久化到 DB

---

## 文件结构总览

```
后端新增 (4 files):
├─ backend/app/models/metric_template.py
├─ backend/app/schemas/metric_template.py
├─ backend/app/api/v1/templates.py
├─ backend/app/services/ai_metric_recommender.py

后端修改 (6 files):
├─ backend/app/schemas/metric.py              — 新增 MetricUpdate
├─ backend/app/api/v1/metrics.py              — 新增 PUT /definitions/{id}
├─ backend/app/api/v1/visualization.py         — 新图表数据查询
├─ backend/app/utils/anomaly_detection.py      — 通用化重写
├─ backend/app/api/v1/files.py                — 上传时触发 AI 推荐
├─ backend/init_db.py                         — 新增模板表 + 预置数据

前端新增 (12 files):
├─ frontend/src/services/templateService.ts
├─ frontend/src/components/TemplateSelector.tsx
├─ frontend/src/components/AIMetricRecommender.tsx
├─ frontend/src/components/AutoChartGrid.tsx
├─ frontend/src/components/charts/ChartRegistry.ts
├─ frontend/src/components/charts/LineChart.tsx
├─ frontend/src/components/charts/BarChart.tsx
├─ frontend/src/components/charts/PieChart.tsx
├─ frontend/src/components/charts/GaugeCard.tsx
├─ frontend/src/components/charts/RadarChart.tsx
├─ frontend/src/components/charts/HeatmapChart.tsx
├─ frontend/src/hooks/useDataReducer.ts

前端修改 (5 files):
├─ frontend/src/services/metricService.ts      — 新增 updateMetric
├─ frontend/src/components/AddMetricModal.tsx   — 新增编辑模式
├─ frontend/src/components/MetricSettingsModal.tsx — 集成 TemplateSelector
├─ frontend/src/components/ChartModal.tsx       — 新增自动模式开关
├─ frontend/src/pages/Dashboard.tsx             — 集成 AutoChartGrid
```

---

## Phase P0（优先交付）：模板系统 + 指标编辑 + 异常检测通用化

### Task P0.1: 创建 metric_templates 数据模型

**Files:**
- Create: `backend/app/models/metric_template.py`
- Modify: `backend/app/database.py` (第 10 行附近 — import Base 之后注册新模型)
- Modify: `backend/init_db.py` (新增 `create_template_table()` + 预置模板数据)

**Interfaces:**
- Consumes: `app.database.Base` (SQLAlchemy declarative base)
- Produces: `MetricTemplate` ORM class, imported by `api/v1/templates.py`

- [ ] **Step 1: 创建 ORM 模型文件**

```python
# backend/app/models/metric_template.py
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from app.database import Base


class MetricTemplate(Base):
    __tablename__ = "metric_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, comment="模板名称")
    description = Column(String(500), nullable=True, comment="适用场景描述")
    category = Column(String(50), nullable=True, comment="报告类型分类")
    is_system = Column(Boolean, default=False, comment="是否系统预置模板")
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, comment="所有者")
    metrics = Column(JSON, nullable=False, comment="指标列表 [{key,label,type,prompt_instruction}]")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="metric_templates")
```

- [ ] **Step 2: 注册模型到 database.py**

在 `backend/app/database.py` 的 import 区域新增一行：
```python
from app.models.metric_template import MetricTemplate  # noqa: F401 — 注册 ORM 模型
```

- [ ] **Step 3: 在 User 模型中添加反向关系**

在 `backend/app/models/user.py` 的 User 类中新增：
```python
metric_templates = relationship("MetricTemplate", back_populates="user", cascade="all, delete-orphan")
```

- [ ] **Step 4: init_db.py 中新增建表函数和预置模板数据**

```python
# 在 init_db.py 的 create_all_tables() 调用之前，Base.metadata.create_all 会自动建表
# 新增函数 create_system_templates()

def create_system_templates():
    """写入系统预置指标模板"""
    from app.database import SessionLocal
    from app.models.metric_template import MetricTemplate

    db = SessionLocal()
    try:
        existing = db.query(MetricTemplate).filter(MetricTemplate.is_system == True).count()
        if existing > 0:
            return

        templates = [
            MetricTemplate(
                name="港股回购报告",
                description="香港联交所回购披露表格（第二章购回报告）",
                category="港股",
                is_system=True,
                user_id=None,
                metrics=[
                    {"metric_key": "company_name", "metric_label": "公司名称", "expected_type": "TEXT", "prompt_instruction": "提取报告顶部的公司名称"},
                    {"metric_key": "stock_code", "metric_label": "证券代号", "expected_type": "TEXT", "prompt_instruction": "提取标准的5位主板港股代号字符串（不足5位的前面强制补0）"},
                    {"metric_key": "submission_date", "metric_label": "呈交日期", "expected_type": "TEXT", "prompt_instruction": "提取呈交日期，统一规整为YYYY-MM-DD格式"},
                    {"metric_key": "repurchase_date", "metric_label": "交易日", "expected_type": "TEXT", "prompt_instruction": "从第二章節購回報告表格中提取交易日，统一规整为YYYY-MM-DD格式"},
                    {"metric_key": "shares_repurchased", "metric_label": "购回股份数目", "expected_type": "NUMERIC", "prompt_instruction": "从第二章節購回報告表格中提取购回股份数目，剔除所有非数字文本"},
                    {"metric_key": "highest_price_paid", "metric_label": "每股最高购回价", "expected_type": "NUMERIC", "prompt_instruction": "从第二章節購回報告表格中提取每股最高购回价，剔除货币符号和千分位符"},
                    {"metric_key": "lowest_price_paid", "metric_label": "每股最低购回价", "expected_type": "NUMERIC", "prompt_instruction": "从第二章節購回報告表格中提取每股最低购回价，剔除货币符号和千分位符"},
                    {"metric_key": "total_consideration", "metric_label": "付出价格总额", "expected_type": "NUMERIC", "prompt_instruction": "从第二章節購回報告表格中提取付出的价格总额，剔除货币符号和千分位符"},
                ]
            ),
            MetricTemplate(
                name="A股年报通用",
                description="A股上市公司年度报告关键财务指标",
                category="A股",
                is_system=True,
                user_id=None,
                metrics=[
                    {"metric_key": "company_name", "metric_label": "公司名称", "expected_type": "TEXT", "prompt_instruction": "提取报告中的公司全称"},
                    {"metric_key": "stock_code", "metric_label": "股票代码", "expected_type": "TEXT", "prompt_instruction": "提取6位A股股票代码"},
                    {"metric_key": "fiscal_year", "metric_label": "财年", "expected_type": "TEXT", "prompt_instruction": "提取报告覆盖的财年，格式YYYY"},
                    {"metric_key": "revenue", "metric_label": "营业收入", "expected_type": "NUMERIC", "prompt_instruction": "提取合并利润表中的营业收入（单位：元）"},
                    {"metric_key": "net_profit", "metric_label": "归母净利润", "expected_type": "NUMERIC", "prompt_instruction": "提取归属于母公司股东的净利润"},
                    {"metric_key": "total_assets", "metric_label": "总资产", "expected_type": "NUMERIC", "prompt_instruction": "提取合并资产负债表中的总资产"},
                    {"metric_key": "roe", "metric_label": "ROE(净资产收益率)", "expected_type": "NUMERIC", "prompt_instruction": "提取加权平均净资产收益率，以百分比表示"},
                    {"metric_key": "eps", "metric_label": "每股收益", "expected_type": "NUMERIC", "prompt_instruction": "提取基本每股收益（元/股）"},
                    {"metric_key": "gross_margin", "metric_label": "毛利率", "expected_type": "NUMERIC", "prompt_instruction": "提取毛利率，以百分比表示"},
                    {"metric_key": "net_margin", "metric_label": "净利率", "expected_type": "NUMERIC", "prompt_instruction": "提取净利率，以百分比表示"},
                    {"metric_key": "revenue_growth", "metric_label": "营收增长率", "expected_type": "NUMERIC", "prompt_instruction": "提取营业收入同比增长率，以百分比表示"},
                    {"metric_key": "net_profit_growth", "metric_label": "净利润增长率", "expected_type": "NUMERIC", "prompt_instruction": "提取归母净利润同比增长率，以百分比表示"},
                    {"metric_key": "debt_ratio", "metric_label": "资产负债率", "expected_type": "NUMERIC", "prompt_instruction": "提取资产负债率，以百分比表示"},
                    {"metric_key": "current_ratio", "metric_label": "流动比率", "expected_type": "NUMERIC", "prompt_instruction": "提取流动比率（流动资产/流动负债）"},
                    {"metric_key": "operating_cash_flow", "metric_label": "经营活动现金流", "expected_type": "NUMERIC", "prompt_instruction": "提取经营活动产生的现金流量净额"},
                ]
            ),
        ]
        db.add_all(templates)
        db.commit()
        print(f"  ✅ 已写入 {len(templates)} 个系统预置指标模板")
    except Exception as e:
        db.rollback()
        print(f"  ⚠️ 指标模板初始化跳过: {e}")
    finally:
        db.close()
```

在 `init_db()` 主函数中，`create_system_metric_definitions()` 之后调用 `create_system_templates()`。

- [ ] **Step 5: 验证数据库表创建**

```bash
cd backend && source venv/Scripts/activate && python init_db.py
```
Expected: 输出 `✅ 已写入 2 个系统预置指标模板`，数据库中 `metric_templates` 表存在且含 2 条 `is_system=1` 记录。

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/metric_template.py backend/app/database.py backend/app/models/user.py backend/init_db.py
git commit -m "feat: add MetricTemplate model with system presets (HK stock + A-share annual)"
```

---

### Task P0.2: 创建模板 Pydantic Schema

**Files:**
- Create: `backend/app/schemas/metric_template.py`

**Interfaces:**
- Consumes: Nothing
- Produces: `TemplateCreate`, `TemplateUpdate`, `TemplateResponse`, `TemplateListResponse`, `TemplateImportResponse` — used by `api/v1/templates.py`

- [ ] **Step 1: 创建 Schema 文件**

```python
# backend/app/schemas/metric_template.py
from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Literal
from datetime import datetime


class MetricItem(BaseModel):
    """模板中的单条指标定义"""
    metric_key: str = Field(..., min_length=1, max_length=100, description="指标键名")
    metric_label: str = Field(..., min_length=1, max_length=100, description="显示名称")
    expected_type: Literal["NUMERIC", "TEXT"] = Field(default="NUMERIC", description="数据类型")
    prompt_instruction: Optional[str] = Field(None, max_length=500, description="提取提示词")


class TemplateCreate(BaseModel):
    """创建模板请求"""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    category: Optional[str] = Field(None, max_length=50)
    metrics: List[MetricItem] = Field(..., min_length=1, max_length=100)


class TemplateUpdate(BaseModel):
    """更新模板请求（所有字段可选）"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    category: Optional[str] = Field(None, max_length=50)
    metrics: Optional[List[MetricItem]] = Field(None, min_length=1, max_length=100)


class TemplateResponse(BaseModel):
    """模板详情响应"""
    id: int
    name: str
    description: Optional[str]
    category: Optional[str]
    is_system: bool
    user_id: Optional[int]
    metrics: List[MetricItem]
    metric_count: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TemplateListResponse(BaseModel):
    """模板列表响应"""
    status: str = "success"
    data: List[TemplateResponse]


class TemplateImportResponse(BaseModel):
    """模板导入响应"""
    status: str = "success"
    message: str
    created_count: int
    skipped_count: int
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/schemas/metric_template.py
git commit -m "feat: add metric template Pydantic schemas"
```

---

### Task P0.3: 创建模板 CRUD API

**Files:**
- Create: `backend/app/api/v1/templates.py`
- Modify: `backend/app/api/v1/__init__.py` (注册路由)

**Interfaces:**
- Consumes: `MetricTemplate` model, `schemas/metric_template.py` schemas, `get_current_user` dependency, `get_db` dependency
- Produces: 6 个 REST 端点

- [ ] **Step 1: 创建模板 API 路由文件**

```python
# backend/app/api/v1/templates.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional
from app.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.metric_template import MetricTemplate
from app.models.metric_definition import MetricDefinition
from app.schemas.metric_template import (
    TemplateCreate, TemplateUpdate, TemplateResponse,
    TemplateListResponse, TemplateImportResponse, MetricItem
)

router = APIRouter(prefix="/metrics/templates", tags=["指标模板"])


def _template_to_response(tmpl: MetricTemplate) -> TemplateResponse:
    return TemplateResponse(
        id=tmpl.id,
        name=tmpl.name,
        description=tmpl.description,
        category=tmpl.category,
        is_system=tmpl.is_system,
        user_id=tmpl.user_id,
        metrics=[MetricItem(**m) for m in (tmpl.metrics or [])],
        metric_count=len(tmpl.metrics or []),
        created_at=tmpl.created_at,
        updated_at=tmpl.updated_at,
    )


@router.get("", response_model=TemplateListResponse)
def list_templates(
    category: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取可用模板列表：系统预置 + 当前用户自定义"""
    query = db.query(MetricTemplate).filter(
        (MetricTemplate.is_system == True) | (MetricTemplate.user_id == current_user.id)
    )
    if category:
        query = query.filter(MetricTemplate.category == category)
    templates = query.order_by(MetricTemplate.is_system.desc(), MetricTemplate.created_at.desc()).all()
    return TemplateListResponse(data=[_template_to_response(t) for t in templates])


@router.post("", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
def create_template(
    body: TemplateCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """创建用户自定义模板"""
    tmpl = MetricTemplate(
        name=body.name,
        description=body.description,
        category=body.category,
        is_system=False,
        user_id=current_user.id,
        metrics=[m.model_dump() for m in body.metrics],
    )
    db.add(tmpl)
    db.commit()
    db.refresh(tmpl)
    return _template_to_response(tmpl)


@router.put("/{template_id}", response_model=TemplateResponse)
def update_template(
    template_id: int,
    body: TemplateUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """编辑用户自定义模板"""
    tmpl = db.query(MetricTemplate).filter(MetricTemplate.id == template_id).first()
    if not tmpl:
        raise HTTPException(status_code=404, detail="模板不存在")
    if tmpl.is_system:
        raise HTTPException(status_code=403, detail="系统预置模板不可编辑")
    if tmpl.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能编辑自己的模板")

    update_data = body.model_dump(exclude_unset=True)
    if "metrics" in update_data:
        update_data["metrics"] = [m.model_dump() if isinstance(m, MetricItem) else m for m in update_data["metrics"]]
    for key, val in update_data.items():
        setattr(tmpl, key, val)
    db.commit()
    db.refresh(tmpl)
    return _template_to_response(tmpl)


@router.delete("/{template_id}")
def delete_template(
    template_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除用户自定义模板"""
    tmpl = db.query(MetricTemplate).filter(MetricTemplate.id == template_id).first()
    if not tmpl:
        raise HTTPException(status_code=404, detail="模板不存在")
    if tmpl.is_system:
        raise HTTPException(status_code=403, detail="系统预置模板不可删除")
    if tmpl.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能删除自己的模板")
    db.delete(tmpl)
    db.commit()
    return {"status": "success", "message": "模板已删除"}


@router.post("/{template_id}/import", response_model=TemplateImportResponse)
def import_template(
    template_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """一键导入模板中的全部指标定义"""
    tmpl = db.query(MetricTemplate).filter(MetricTemplate.id == template_id).first()
    if not tmpl:
        raise HTTPException(status_code=404, detail="模板不存在")
    # 权限：系统模板 + 自己的模板可导入
    if not tmpl.is_system and tmpl.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权导入此模板")

    metrics = tmpl.metrics or []
    created, skipped = 0, 0
    for m in metrics:
        key = m.get("metric_key", "")
        if not key:
            skipped += 1
            continue
        existing = db.query(MetricDefinition).filter(
            MetricDefinition.user_id == current_user.id,
            MetricDefinition.metric_key == key,
        ).first()
        if existing:
            skipped += 1
            continue
        md = MetricDefinition(
            user_id=current_user.id,
            metric_key=key,
            metric_label=m.get("metric_label", key),
            expected_type=m.get("expected_type", "NUMERIC"),
            prompt_instruction=m.get("prompt_instruction"),
            is_system=False,
        )
        db.add(md)
        created += 1
    db.commit()
    return TemplateImportResponse(
        message=f"成功创建 {created} 个指标，跳过 {skipped} 个（已存在）",
        created_count=created,
        skipped_count=skipped,
    )
```

- [ ] **Step 2: 注册路由到 APIRouter**

在 `backend/app/api/v1/__init__.py` 的 router 注册区域新增：
```python
from app.api.v1.templates import router as templates_router
api_router.include_router(templates_router, tags=["指标模板"])
```

- [ ] **Step 3: 测试 API**

```bash
# 启动后端
cd backend && source venv/Scripts/activate && uvicorn app.main:app --host 0.0.0.0 --port 8005

# 另开终端测试
# 1. 获取模板列表（需要先登录获取 token）
curl -X GET "http://localhost:8005/api/v1/metrics/templates" \
  -H "Authorization: Bearer <TOKEN>"
# Expected: 返回 2 个系统预置模板

# 2. 从模板导入指标
curl -X POST "http://localhost:8005/api/v1/metrics/templates/1/import" \
  -H "Authorization: Bearer <TOKEN>"
# Expected: {"status":"success","message":"成功创建 N 个指标","created_count":N,"skipped_count":0}

# 3. 测试创建自定义模板
curl -X POST "http://localhost:8005/api/v1/metrics/templates" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"测试模板","description":"test","metrics":[{"metric_key":"test_kpi","metric_label":"测试指标","expected_type":"NUMERIC"}]}'
# Expected: 201 Created
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/v1/templates.py backend/app/api/v1/__init__.py
git commit -m "feat: add metric template CRUD + import API endpoints"
```

---

### Task P0.4: 前端模板服务 + TemplateSelector 组件

**Files:**
- Create: `frontend/src/services/templateService.ts`
- Create: `frontend/src/components/TemplateSelector.tsx`

**Interfaces:**
- Consumes: `api.ts` (axios instance)
- Produces: `templateService` (5 methods), `TemplateSelector` component — used by `MetricSettingsModal`

- [ ] **Step 1: 创建模板 API 服务**

```typescript
// frontend/src/services/templateService.ts
import api from './api'

interface MetricItem {
  metric_key: string
  metric_label: string
  expected_type: 'NUMERIC' | 'TEXT'
  prompt_instruction?: string
}

interface TemplateResponse {
  id: number
  name: string
  description?: string
  category?: string
  is_system: boolean
  user_id?: number
  metrics: MetricItem[]
  metric_count: number
  created_at: string
  updated_at: string
}

interface TemplateListResponse {
  status: string
  data: TemplateResponse[]
}

interface TemplateImportResponse {
  status: string
  message: string
  created_count: number
  skipped_count: number
}

const templateService = {
  async getTemplates(category?: string): Promise<TemplateResponse[]> {
    const params = category ? { category } : {}
    const res = await api.get<TemplateListResponse>('/metrics/templates', { params })
    return res.data.data
  },

  async createTemplate(data: { name: string; description?: string; category?: string; metrics: MetricItem[] }): Promise<TemplateResponse> {
    const res = await api.post<TemplateResponse>('/metrics/templates', data)
    return res.data
  },

  async updateTemplate(id: number, data: Partial<{ name: string; description: string; category: string; metrics: MetricItem[] }>): Promise<TemplateResponse> {
    const res = await api.put<TemplateResponse>(`/metrics/templates/${id}`, data)
    return res.data
  },

  async deleteTemplate(id: number): Promise<{ status: string; message: string }> {
    const res = await api.delete<{ status: string; message: string }>(`/metrics/templates/${id}`)
    return res.data
  },

  async importTemplate(id: number): Promise<TemplateImportResponse> {
    const res = await api.post<TemplateImportResponse>(`/metrics/templates/${id}/import`)
    return res.data
  },
}

export default templateService
export type { MetricItem, TemplateResponse, TemplateImportResponse }
```

- [ ] **Step 2: 创建 TemplateSelector 组件**

```tsx
// frontend/src/components/TemplateSelector.tsx
import React, { useState, useEffect } from 'react'
import { Button, Dropdown, Modal, List, Tag, message, Space, Typography } from 'antd'
import { FileTextOutlined, PlusOutlined, UserOutlined } from '@ant-design/icons'
import templateService, { TemplateResponse } from '../services/templateService'

const { Text } = Typography

interface Props {
  onImportComplete: () => void   // 导入成功后回调，刷新指标列表
  onSaveAsTemplate?: () => void  // "保存当前指标为模板"回调
}

const TemplateSelector: React.FC<Props> = ({ onImportComplete, onSaveAsTemplate }) => {
  const [templates, setTemplates] = useState<TemplateResponse[]>([])
  const [loading, setLoading] = useState(false)
  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewTemplate, setPreviewTemplate] = useState<TemplateResponse | null>(null)
  const [importing, setImporting] = useState(false)

  const loadTemplates = async () => {
    setLoading(true)
    try {
      const data = await templateService.getTemplates()
      setTemplates(data)
    } catch {
      message.error('加载模板列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async (tmpl: TemplateResponse) => {
    setImporting(true)
    try {
      const result = await templateService.importTemplate(tmpl.id)
      message.success(result.message)
      onImportComplete()
      setPreviewVisible(false)
    } catch {
      message.error('导入失败')
    } finally {
      setImporting(false)
    }
  }

  const showPreview = (tmpl: TemplateResponse) => {
    setPreviewTemplate(tmpl)
    setPreviewVisible(true)
  }

  // 构建下拉菜单项
  const menuItems = {
    items: [
      ...templates.filter(t => t.is_system).map(t => ({
        key: `sys-${t.id}`,
        label: t.name,
        icon: <FileTextOutlined />,
        extra: `系统预置 · ${t.metric_count}个指标`,
        onClick: () => showPreview(t),
      })),
      ...(templates.filter(t => !t.is_system).length > 0 ? [{ type: 'divider' as const }] : []),
      ...templates.filter(t => !t.is_system).map(t => ({
        key: `usr-${t.id}`,
        label: t.name,
        icon: <UserOutlined />,
        extra: `我的 · ${t.metric_count}个指标`,
        onClick: () => showPreview(t),
      })),
      { type: 'divider' as const },
      ...(onSaveAsTemplate ? [{
        key: 'save-current',
        label: '💾 保存当前指标为模板',
        onClick: onSaveAsTemplate,
      }] : []),
    ].map(item => ({
      key: item.key,
      label: (
        <Space>
          {item.icon}
          <span>{item.label}</span>
          {item.extra && <Text type="secondary" style={{ fontSize: 12 }}>{item.extra}</Text>}
        </Space>
      ),
      onClick: item.onClick,
    })),
  }

  return (
    <>
      <Dropdown menu={menuItems} trigger={['click']} onOpenChange={(open) => open && loadTemplates()}>
        <Button icon={<PlusOutlined />} type="dashed" size="small">
          从模板导入
        </Button>
      </Dropdown>

      <Modal
        title={`模板预览: ${previewTemplate?.name || ''}`}
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={[
          <Button key="cancel" onClick={() => setPreviewVisible(false)}>取消</Button>,
          <Button key="import" type="primary" loading={importing}
            onClick={() => previewTemplate && handleImport(previewTemplate)}>
            一键导入 ({previewTemplate?.metric_count || 0} 个指标)
          </Button>,
        ]}
        width={600}
      >
        {previewTemplate && (
          <>
            <Text type="secondary">{previewTemplate.description}</Text>
            <List
              style={{ marginTop: 16 }}
              dataSource={previewTemplate.metrics}
              renderItem={(item) => (
                <List.Item>
                  <Space>
                    <Tag color="blue">{item.expected_type}</Tag>
                    <Text strong>{item.metric_label}</Text>
                    <Text type="secondary" code>{item.metric_key}</Text>
                  </Space>
                </List.Item>
              )}
            />
          </>
        )}
      </Modal>
    </>
  )
}

export default TemplateSelector
```

- [ ] **Step 3: 集成到 MetricSettingsModal**

在 `frontend/src/components/MetricSettingsModal.tsx` 顶部新增 import，在"添加指标"按钮旁边插入 TemplateSelector。大致位置在现有的"添加指标"按钮（第 54 行附近）之前：

```tsx
import TemplateSelector from './TemplateSelector'

// 在 Modal footer 或顶部操作区插入
<TemplateSelector
  onImportComplete={() => {
    onRefresh()          // 重新加载指标列表
    message.success('指标模板导入成功')
  }}
  onSaveAsTemplate={() => {
    // TODO: 后续版本实现 "保存当前指标为模板"
    message.info('敬请期待')
  }}
/>
```

在 `MetricSettingsModal` 的 props 中新增 `onRefresh: () => void`（由 `Dashboard.loadMetrics` 提供）。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/templateService.ts frontend/src/components/TemplateSelector.tsx frontend/src/components/MetricSettingsModal.tsx
git commit -m "feat: add template selector with preview and one-click import"
```

---

### Task P0.5: 指标编辑能力 — 后端 PUT 端点

**Files:**
- Modify: `backend/app/schemas/metric.py` (新增 MetricUpdate)
- Modify: `backend/app/api/v1/metrics.py` (新增 PUT /definitions/{id})

**Interfaces:**
- Consumes: `MetricDefinition` model, `get_current_user`, `get_db`
- Produces: `PUT /metrics/definitions/{id}` endpoint

- [ ] **Step 1: 新增 MetricUpdate Schema**

在 `backend/app/schemas/metric.py` 中，`MetricDefinitionCreate` 之后新增：

```python
class MetricUpdate(BaseModel):
    """更新指标定义（不可修改 metric_key 和 is_system）"""
    metric_label: Optional[str] = Field(None, min_length=1, max_length=100)
    expected_type: Optional[ExpectedTypeEnum] = None
    prompt_instruction: Optional[str] = Field(None, max_length=500)
```

- [ ] **Step 2: 新增 PUT 端点**

在 `backend/app/api/v1/metrics.py` 中，`delete_metric` 函数之后新增：

```python
@router.put("/definitions/{metric_id}", response_model=MetricDefinitionResponse)
def update_metric(
    metric_id: int,
    body: schemas.MetricUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """编辑自定义指标定义（不可修改 metric_key，不可编辑系统指标）"""
    metric = db.query(MetricDefinition).filter(MetricDefinition.id == metric_id).first()
    if not metric:
        raise HTTPException(status_code=404, detail="指标定义不存在")
    if metric.is_system:
        raise HTTPException(status_code=403, detail="系统预置指标不可编辑")
    if metric.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="只能编辑自己的指标")

    update_data = body.model_dump(exclude_unset=True)
    for key, val in update_data.items():
        setattr(metric, key, val)

    db.commit()
    db.refresh(metric)
    return MetricDefinitionResponse(
        id=metric.id,
        metric_key=metric.metric_key,
        metric_label=metric.metric_label,
        expected_type=metric.expected_type.value,
        prompt_instruction=metric.prompt_instruction,
        is_system=metric.is_system,
    )
```

- [ ] **Step 3: 测试 PUT 端点**

```bash
# 编辑自定义指标（假设 id=9）
curl -X PUT "http://localhost:8005/api/v1/metrics/definitions/9" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"metric_label":"营业收入(亿)","prompt_instruction":"提取营业收入，以亿元为单位"}'
# Expected: 200 OK，返回更新后的指标

# 尝试编辑系统指标（假设 id=1）
curl -X PUT "http://localhost:8005/api/v1/metrics/definitions/1" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"metric_label":"测试"}'
# Expected: 403 {"detail":"系统预置指标不可编辑"}
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas/metric.py backend/app/api/v1/metrics.py
git commit -m "feat: add PUT /metrics/definitions/{id} for editing custom metrics"
```

---

### Task P0.6: 前端指标编辑 — AddMetricModal 编辑模式 + metricService.updateMetric

**Files:**
- Modify: `frontend/src/services/metricService.ts`
- Modify: `frontend/src/components/AddMetricModal.tsx`
- Modify: `frontend/src/components/MetricSettingsModal.tsx` (新增编辑按钮)

**Interfaces:**
- Consumes: PUT /metrics/definitions/{id}
- Produces: `updateMetric()` method, AddMetricModal edit mode

- [ ] **Step 1: 新增 updateMetric 方法**

在 `frontend/src/services/metricService.ts` 中新增：

```typescript
interface UpdateMetricRequest {
  metric_label?: string
  expected_type?: 'NUMERIC' | 'TEXT'
  prompt_instruction?: string
}

// 在 metricService 对象内新增:
async updateMetric(id: number, data: UpdateMetricRequest): Promise<MetricDefinitionResponse> {
  const res = await api.put<MetricDefinitionResponse>(`/metrics/definitions/${id}`, data)
  return res.data
},
```

- [ ] **Step 2: AddMetricModal 新增编辑模式**

修改 `frontend/src/components/AddMetricModal.tsx`：

```tsx
// 新增 props
interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
  mode?: 'create' | 'edit'          // 新增
  editTarget?: MetricDefinition | null  // 新增：编辑时传入的指标
}

// 在组件内部
const AddMetricModal: React.FC<Props> = ({ open, onClose, onCreated, mode = 'create', editTarget = null }) => {
  const isEdit = mode === 'edit'

  // 初始化表单：编辑模式下回填数据
  useEffect(() => {
    if (editTarget && isEdit) {
      setForm({
        metric_key: editTarget.metric_key,
        metric_label: editTarget.metric_label,
        expected_type: editTarget.expected_type || 'NUMERIC',
        prompt_instruction: editTarget.prompt_instruction,
      })
    } else {
      setForm({ metric_key: '', metric_label: '', expected_type: 'NUMERIC' })
    }
  }, [editTarget, isEdit, open])

  const handleSubmit = async () => {
    // ... 校验 ...
    try {
      if (isEdit && editTarget) {
        await metricService.updateMetric(editTarget.id, {
          metric_label: form.metric_label,
          expected_type: form.expected_type,
          prompt_instruction: form.prompt_instruction,
        })
        message.success('指标已更新')
      } else {
        await metricService.createMetric(form)
        message.success('指标创建成功')
      }
      onCreated()
      onClose()
    } catch (err: any) {
      message.error(err.response?.data?.detail || '操作失败')
    }
  }

  return (
    <Modal title={isEdit ? '编辑指标' : '添加自定义指标'} open={open} onCancel={onClose} onOk={handleSubmit}>
      {/* metric_key 字段：编辑模式下只读 */}
      <div>
        <label>指标键名 *</label>
        <Input value={form.metric_key} onChange={...} disabled={isEdit} placeholder="net_profit" />
        {isEdit && <Text type="secondary">键名创建后不可修改</Text>}
      </div>
      {/* metric_label, expected_type, prompt_instruction 字段不变 */}
      {/* ... */}
    </Modal>
  )
}
```

- [ ] **Step 3: MetricSettingsModal 新增编辑按钮**

在 `frontend/src/components/MetricSettingsModal.tsx` 中，每条非系统指标右侧增加 ✏️ 按钮：

```tsx
{!metric.is_system && (
  <Button
    type="text"
    size="small"
    icon={<EditOutlined />}
    onClick={(e) => {
      e.stopPropagation()
      setEditingMetric(metric)      // 新增 state
      setShowAddMetric(true)        // 打开 AddMetricModal
    }}
  />
)}
```

并将 `AddMetricModal` 的调用改为：

```tsx
<AddMetricModal
  open={showAddMetric}
  onClose={() => { setShowAddMetric(false); setEditingMetric(null) }}
  onCreated={loadMetrics}
  mode={editingMetric ? 'edit' : 'create'}
  editTarget={editingMetric}
/>
```

- [ ] **Step 4: 验证前端编辑流程**

```bash
cd frontend && npm run dev
```
1. 打开 Dashboard → 点击"指标设置"
2. 点击自定义指标右侧 ✏️ → 弹出编辑 Modal → 修改显示名称 → 提交
3. 验证指标名称已更新，重新打开编辑 Modal 验证数据回填

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/metricService.ts frontend/src/components/AddMetricModal.tsx frontend/src/components/MetricSettingsModal.tsx
git commit -m "feat: add metric editing mode in AddMetricModal + updateMetric API"
```

---

### Task P0.7: 异常检测通用化

**Files:**
- Modify: `backend/app/utils/anomaly_detection.py` (重写核心逻辑)

**Interfaces:**
- Consumes: `ExtractedMetric` model, `Report` model, `MetricDefinition` model
- Produces: `detect_anomalies(batch_id, config)` → `{report_id: {metric_name: AnomalyResult}}`
- Called by: `api/v1/batches.py` (GET /batches/{id}/anomalies) 和 `api/v1/visualization.py` (图表数据标注)

- [ ] **Step 1: 重写 anomaly_detection.py**

```python
# backend/app/utils/anomaly_detection.py
"""
通用异常检测引擎 — 支持三种统计方法，自动适配所有 NUMERIC 指标。
"""
from typing import Optional, Literal, Dict, List
from statistics import median, mean, stdev
import math


class AnomalyResult:
    """单个数据点的异常检测结果"""
    def __init__(self, value: float, is_anomaly: bool, method: str,
                 threshold: float, deviation: float, direction: str):
        self.value = value
        self.is_anomaly = is_anomaly
        self.method = method
        self.threshold = threshold
        self.deviation = deviation    # 偏离度（百分比或 Z 值）
        self.direction = direction    # "high" | "low" | "normal"


def detect_anomalies(
    values: List[float],
    method: Literal["auto", "median_deviation", "iqr", "zscore"] = "auto",
    sensitivity: Literal["low", "medium", "high"] = "medium",
    direction: Literal["both", "high", "low"] = "both",
) -> List[AnomalyResult]:
    """
    对一组数值执行异常检测，返回每个值的检测结果。

    Args:
        values: 待检测的数值列表
        method: 检测方法
        sensitivity: 敏感度 → low(宽松), medium(标准), high(严格)
        direction: 检测方向
    """
    n = len(values)
    if n < 3:
        # 样本量太小，全部标记为正常
        return [AnomalyResult(v, False, "insufficient_data", 0, 0, "normal") for v in values]

    # 确定检测方法和阈值
    chosen_method, threshold = _choose_method_and_threshold(values, method, sensitivity)
    results = []

    if chosen_method == "median_deviation":
        results = _median_deviation_detect(values, threshold, direction)
    elif chosen_method == "iqr":
        results = _iqr_detect(values, threshold, direction)
    elif chosen_method == "zscore":
        results = _zscore_detect(values, threshold, direction)

    return results


def _choose_method_and_threshold(values, method, sensitivity):
    """自动选择检测方法和阈值"""
    n = len(values)
    thresholds = {
        "median_deviation": {"low": 0.10, "medium": 0.05, "high": 0.03},
        "iqr": {"low": 3.0, "medium": 1.5, "high": 1.0},
        "zscore": {"low": 3.0, "medium": 2.0, "high": 1.5},
    }

    if method != "auto":
        return method, thresholds[method][sensitivity]

    # 自动选择逻辑
    if n < 10:
        return "median_deviation", thresholds["median_deviation"][sensitivity]

    # 计算偏度
    m = mean(values)
    s = stdev(values) if len(values) > 1 else 1
    skewness = sum(((x - m) / s) ** 3 for x in values) / n
    if abs(skewness) > 1:
        return "iqr", thresholds["iqr"][sensitivity]

    return "zscore", thresholds["zscore"][sensitivity]


def _median_deviation_detect(values, threshold, direction):
    """中位数偏离法"""
    med = median(values)
    results = []
    for v in values:
        deviation = abs(v - med) / abs(med) if med != 0 else 0
        is_anomaly = deviation > threshold
        dir_flag = _get_direction(v, med)
        if direction == "high" and dir_flag != "high":
            is_anomaly = False
        elif direction == "low" and dir_flag != "low":
            is_anomaly = False
        results.append(AnomalyResult(v, is_anomaly, "median_deviation", threshold, deviation, dir_flag))
    return results


def _iqr_detect(values, threshold, direction):
    """IQR 四分位距法"""
    sorted_vals = sorted(values)
    n = len(sorted_vals)
    q1_idx, q3_idx = n // 4, 3 * n // 4
    q1 = sorted_vals[q1_idx]
    q3 = sorted_vals[q3_idx]
    iqr = q3 - q1
    lower = q1 - threshold * iqr
    upper = q3 + threshold * iqr

    results = []
    for v in values:
        is_anomaly = v < lower or v > upper
        dir_flag = "high" if v > upper else ("low" if v < lower else "normal")
        if direction == "high" and dir_flag != "high":
            is_anomaly = False
        elif direction == "low" and dir_flag != "low":
            is_anomaly = False
        deviation = (v - q3) / iqr if v > q3 else ((q1 - v) / iqr if v < q1 else 0)
        results.append(AnomalyResult(v, is_anomaly, "iqr", threshold, deviation, dir_flag))
    return results


def _zscore_detect(values, threshold, direction):
    """Z-Score 标准差法"""
    m = mean(values)
    s = stdev(values) if len(values) > 1 else 1
    results = []
    for v in values:
        z = abs(v - m) / s if s != 0 else 0
        is_anomaly = z > threshold
        dir_flag = "high" if v > m else ("low" if v < m else "normal")
        if direction == "high" and dir_flag != "high":
            is_anomaly = False
        elif direction == "low" and dir_flag != "low":
            is_anomaly = False
        results.append(AnomalyResult(v, is_anomaly, "zscore", threshold, z, dir_flag))
    return results


def _get_direction(value, reference):
    if value > reference:
        return "high"
    elif value < reference:
        return "low"
    return "normal"


def detect_batch_anomalies(
    db,
    batch_id: int,
    group_by: Optional[str] = None,
    method: str = "auto",
    sensitivity: str = "medium",
    direction: str = "both",
) -> Dict[int, Dict[str, AnomalyResult]]:
    """
    检测批次中所有 NUMERIC 指标的异常值。

    Returns:
        {report_id: {metric_name: AnomalyResult}}
    """
    from app.models.report import Report
    from app.models.metric import ExtractedMetric
    from app.models.metric_definition import MetricDefinition, BatchMetricRelation

    reports = db.query(Report).filter(Report.batch_id == batch_id).all()
    report_ids = [r.id for r in reports]

    # 获取 NUMERIC 指标定义
    relations = db.query(BatchMetricRelation).filter(BatchMetricRelation.batch_id == batch_id).all()
    if relations:
        metric_def_ids = [r.metric_def_id for r in relations]
    else:
        metric_def_ids = [md.id for md in db.query(MetricDefinition).filter(
            MetricDefinition.is_system == True, MetricDefinition.expected_type == "NUMERIC"
        ).all()]

    metric_defs = db.query(MetricDefinition).filter(
        MetricDefinition.id.in_(metric_def_ids),
        MetricDefinition.expected_type == "NUMERIC",
    ).all()

    metric_names = [md.metric_key for md in metric_defs]
    all_metrics = db.query(ExtractedMetric).filter(
        ExtractedMetric.report_id.in_(report_ids),
        ExtractedMetric.metric_name.in_(metric_names),
        ExtractedMetric.metric_value_num.isnot(None),
    ).all()

    # 按 metric_name 分组所有值
    by_metric: Dict[str, List[tuple]] = {}
    for m in all_metrics:
        by_metric.setdefault(m.metric_name, []).append((m.report_id, float(m.metric_value_num)))

    result: Dict[int, Dict[str, AnomalyResult]] = {}

    if group_by:
        # 组内检测模式
        # 获取分组键映射: report_id → group_key
        report_groups = _build_report_groups(db, reports, group_by)
        for group_key, g_report_ids in report_groups.items():
            for metric_name in metric_names:
                group_values = [(rid, val) for (rid, val) in by_metric.get(metric_name, []) if rid in g_report_ids]
                if len(group_values) < 3:
                    continue
                vals = [v for _, v in group_values]
                detections = detect_anomalies(vals, method, sensitivity, direction)
                for (rid, _), det in zip(group_values, detections):
                    result.setdefault(rid, {})[metric_name] = det
    else:
        # 全局检测模式
        for metric_name, data in by_metric.items():
            if len(data) < 3:
                continue
            vals = [v for _, v in data]
            detections = detect_anomalies(vals, method, sensitivity, direction)
            for (rid, _), det in zip(data, detections):
                result.setdefault(rid, {})[metric_name] = det

    return result


def _build_report_groups(db, reports, group_by):
    """构建报告分组映射"""
    from app.models.metric import ExtractedMetric
    groups: Dict[str, List[int]] = {}
    for r in reports:
        key_val = None
        if group_by == "entity_name":
            key_val = r.entity_name
        elif group_by == "stock_code":
            em = db.query(ExtractedMetric).filter(
                ExtractedMetric.report_id == r.id,
                ExtractedMetric.metric_name == "stock_code",
            ).first()
            key_val = em.metric_value_raw if em else None
        key_val = key_val or f"default_{r.id}"
        groups.setdefault(key_val, []).append(r.id)
    return groups
```

- [ ] **Step 2: 更新批次异常检测 API**

在 `backend/app/api/v1/batches.py` 中（或独立路由），新增/修改异常检测端点，支持新参数：

```python
@router.get("/{batch_id}/anomalies")
def get_batch_anomalies(
    batch_id: int,
    method: str = "auto",
    sensitivity: str = "medium",
    group_by: Optional[str] = None,
    direction: str = "both",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取批次异常检测结果"""
    # 校验批次归属权...
    results = detect_batch_anomalies(db, batch_id, group_by, method, sensitivity, direction)
    # 序列化返回...
```

- [ ] **Step 3: 在可视化 API 中集成异常标注**

在 `backend/app/api/v1/visualization.py` 的 `get_trend_data` 和 `get_comparison_data` 中，构建 `MultiSeriesDataPoint` 时附加 `is_anomaly` 字段：

```python
# 在构建 data points 时:
anomalies = detect_batch_anomalies(db, batch_id, method="auto")
anomaly_result = anomalies.get(report_id, {}).get(metric_key)
data_point = MultiSeriesDataPoint(
    # ... 现有字段 ...
    is_anomaly=anomaly_result.is_anomaly if anomaly_result else False,
    anomaly_deviation=anomaly_result.deviation if anomaly_result else None,
)
```

在 `backend/app/schemas/metric.py` 的 `MultiSeriesDataPoint` 中新增两个可选字段：
```python
class MultiSeriesDataPoint(BaseModel):
    # ... 现有字段 ...
    is_anomaly: Optional[bool] = False
    anomaly_deviation: Optional[float] = None
```

- [ ] **Step 4: 测试异常检测**

```bash
cd backend && source venv/Scripts/activate

# 单元测试三种方法
python -c "
from app.utils.anomaly_detection import detect_anomalies
# 测试中位数偏离法
vals = [10, 11, 10, 12, 50, 11, 10]  # 50 明显异常
results = detect_anomalies(vals, method='median_deviation', sensitivity='medium')
for i, r in enumerate(results):
    print(f'值={vals[i]}, 异常={r.is_anomaly}, 偏离度={r.deviation:.2%}')
# Expected: 值=50 → 异常=True, 偏离度≈355%
"
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/utils/anomaly_detection.py backend/app/api/v1/batches.py backend/app/api/v1/visualization.py backend/app/schemas/metric.py
git commit -m "feat: generalize anomaly detection with 3 methods, auto-select, group-by support"
```

---

### ✅ P0 里程碑：模板系统 + 指标编辑 + 异常检测通用化 — 可独立验证

```bash
# 端到端验证
cd backend && source venv/Scripts/activate && python init_db.py
# 验证: 2 个系统模板已写入，指标编辑 PUT 可用，异常检测三种方法全部可用
```

---

## Phase P1（核心体验）：自动可视化 + 新图表 + 智能降载

### Task P1.1: ChartRegistry 图表注册工厂

**Files:**
- Create: `frontend/src/components/charts/ChartRegistry.ts`

**Interfaces:**
- Consumes: ECharts option 构建函数
- Produces: `ChartRegistry.register()`, `ChartRegistry.autoAssign()`, `ChartRegistry.buildOption()`

- [ ] **Step 1: 创建 ChartRegistry**

```typescript
// frontend/src/components/charts/ChartRegistry.ts
import type { EChartsOption } from 'echarts'

export interface ChartTypeConfig {
  type: 'line' | 'bar' | 'pie' | 'gauge' | 'radar' | 'heatmap'
  name: string
  /** 判断此图表类型是否适用于当前数据 */
  isApplicable(metrics: MetricDef[], reports: Report[]): boolean
  /** 构建 ECharts option */
  buildOption(data: SeriesData[], reduction?: ReductionConfig): EChartsOption
  /** 默认降载配置 */
  defaultReduction: ReductionStrategy
}

export interface MetricDef {
  metric_key: string
  metric_label: string
  expected_type: 'NUMERIC' | 'TEXT'
}

export interface Report {
  id: number
  report_name: string
  entity_name?: string
  batch_id: number
}

export interface SeriesData {
  metric_key: string
  metric_label: string
  data: DataPoint[]
}

export interface DataPoint {
  fiscal_year?: string
  report_name?: string
  entity_name?: string
  batch_id?: number
  value: number | null
  unit?: string
  is_anomaly?: boolean
  anomaly_deviation?: number
}

export interface ReductionConfig {
  topN?: number
  granularity?: 'day' | 'month' | 'quarter'
  anomalyFirst?: boolean
  page?: number
  pageSize?: number
}

export interface ReductionStrategy {
  defaultTopN: number
  pageSize: number
  aggregateGranularity?: 'day' | 'month' | 'quarter'
}

const registry = new Map<string, ChartTypeConfig>()

export const ChartRegistry = {
  register(config: ChartTypeConfig): void {
    if (registry.has(config.type)) {
      console.warn(`ChartRegistry: type "${config.type}" already registered, overwriting.`)
    }
    registry.set(config.type, config)
  },

  get(type: string): ChartTypeConfig | undefined {
    return registry.get(type)
  },

  list(): ChartTypeConfig[] {
    return Array.from(registry.values())
  },

  /**
   * 自动根据数据特征分配图表类型
   */
  autoAssign(metrics: MetricDef[], reports: Report[]): ChartTypeConfig[] {
    const numericMetrics = metrics.filter(m => m.expected_type === 'NUMERIC')
    const n_metrics = numericMetrics.length
    const n_reports = reports.length

    const assigned: ChartTypeConfig[] = []

    for (const config of registry.values()) {
      if (config.isApplicable(metrics, reports)) {
        assigned.push(config)
      }
    }

    // 确保至少有折线图和柱状图（如果数据适合）
    if (assigned.length === 0) {
      const line = registry.get('line')
      const bar = registry.get('bar')
      if (n_reports >= 2 && line) assigned.push(line)
      if (bar) assigned.push(bar)
    }

    return assigned
  },

  buildOption(type: string, data: SeriesData[], reduction?: ReductionConfig): EChartsOption | null {
    const config = registry.get(type)
    if (!config) return null
    return config.buildOption(data, reduction)
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/charts/ChartRegistry.ts
git commit -m "feat: add ChartRegistry factory for pluggable chart types"
```

---

### Task P1.2: 拆出现有图表 + 新增 4 种图表类型

**Files:**
- Create: `frontend/src/components/charts/LineChart.tsx`
- Create: `frontend/src/components/charts/BarChart.tsx`
- Create: `frontend/src/components/charts/PieChart.tsx`
- Create: `frontend/src/components/charts/GaugeCard.tsx`
- Create: `frontend/src/components/charts/RadarChart.tsx`
- Create: `frontend/src/components/charts/HeatmapChart.tsx`
- Create: `frontend/src/components/charts/index.ts` (导出全部)
- Modify: `frontend/src/components/ChartRenderer.tsx` (重构为调用 ChartRegistry)

**Interfaces:**
- 每个图表文件调用 `ChartRegistry.register()` 自注册
- `ChartRenderer` 从具体实现变为 `ChartRegistry` 的薄调用层

- [ ] **Step 1: 创建折线图 (LineChart.tsx)**

```typescript
// frontend/src/components/charts/LineChart.tsx
import { ChartRegistry, type ChartTypeConfig } from './ChartRegistry'
import type { EChartsOption } from 'echarts'
import { COLORS } from '../ChartRenderer'  // 复用现有调色板

const config: ChartTypeConfig = {
  type: 'line',
  name: '趋势折线图',
  isApplicable(metrics, reports) {
    return metrics.filter(m => m.expected_type === 'NUMERIC').length >= 1 && reports.length >= 2
  },
  buildOption(data, reduction) {
    const topN = reduction?.topN ?? 20
    const fiscalYears = [...new Set(data.flatMap(s => s.data.map(d => d.fiscal_year).filter(Boolean)))]
      .sort()
      .slice(0, topN)

    return {
      color: COLORS,
      tooltip: { trigger: 'axis' },
      legend: { top: 0, data: data.map(s => s.metric_label) },
      grid: { left: 60, right: 60, top: 40, bottom: 50 },
      xAxis: {
        type: 'category',
        data: fiscalYears,
        axisLabel: { rotate: 30 },
      },
      yAxis: { type: 'value', name: data[0]?.data[0]?.unit || '' },
      series: data.map(s => ({
        name: s.metric_label,
        type: 'line',
        smooth: true,
        symbolSize: 6,
        lineStyle: { width: 2 },
        data: fiscalYears.map(fy => {
          const pt = s.data.find(d => d.fiscal_year === fy)
          return pt ? {
            value: pt.value,
            itemStyle: pt.is_anomaly ? { color: '#ef4444' } : undefined,
            symbol: pt.is_anomaly ? 'circle' : undefined,
            symbolSize: pt.is_anomaly ? 10 : 6,
          } : null
        }),
      })),
    } as EChartsOption
  },
  defaultReduction: { defaultTopN: 20, pageSize: 0, aggregateGranularity: 'month' },
}

ChartRegistry.register(config)
export default config
```

- [ ] **Step 2: 创建柱状图 (BarChart.tsx)**

```typescript
// frontend/src/components/charts/BarChart.tsx
import { ChartRegistry, type ChartTypeConfig } from './ChartRegistry'

const config: ChartTypeConfig = {
  type: 'bar',
  name: '数据对比柱状图',
  isApplicable(metrics, reports) {
    return metrics.filter(m => m.expected_type === 'NUMERIC').length >= 1 && reports.length >= 1
  },
  buildOption(data, reduction) {
    const topN = reduction?.topN ?? 15
    const reportNames = [...new Set(data.flatMap(s => s.data.map(d => d.report_name).filter(Boolean)))]
      .slice(0, topN)
    const page = reduction?.page ?? 1
    const pageSize = reduction?.pageSize ?? 8
    const paged = reportNames.slice((page - 1) * pageSize, page * pageSize)

    return {
      color: ['#5470C6', '#91CC75', '#FAC858', '#EE6666', '#73C0DE', '#3BA272', '#FC8452', '#9A60B4'],
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 60, right: 60, top: 40, bottom: 80 },
      xAxis: {
        type: 'category',
        data: paged.map(n => n.length > 18 ? n.slice(0, 18) + '...' : n),
        axisLabel: { rotate: 45 },
      },
      yAxis: { type: 'value' },
      series: data.map(s => ({
        name: s.metric_label,
        type: 'bar',
        barMaxWidth: 40,
        itemStyle: { borderRadius: [4, 4, 0, 0] },
        data: paged.map(name => {
          const pt = s.data.find(d => d.report_name === name)
          return pt ? {
            value: pt.value,
            itemStyle: pt.is_anomaly ? { color: '#ef4444', borderRadius: [4, 4, 0, 0] } : undefined,
          } : null
        }),
      })),
    } as EChartsOption
  },
  defaultReduction: { defaultTopN: 15, pageSize: 8 },
}

ChartRegistry.register(config)
export default config
```

- [ ] **Step 3: 创建饼图 (PieChart.tsx)**

```typescript
// frontend/src/components/charts/PieChart.tsx
import { ChartRegistry, type ChartTypeConfig } from './ChartRegistry'

const config: ChartTypeConfig = {
  type: 'pie',
  name: '占比环形图',
  isApplicable(metrics, reports) {
    // 适用于单指标多报告，展示占比
    const numMetrics = metrics.filter(m => m.expected_type === 'NUMERIC').length
    return numMetrics === 1 && reports.length >= 2
  },
  buildOption(data, reduction) {
    const topN = reduction?.topN ?? 8
    const series = data[0]
    if (!series) return {}
    const sorted = [...series.data].filter(d => d.value != null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    const top = sorted.slice(0, topN)
    const others = sorted.slice(topN)
    const otherSum = others.reduce((s, d) => s + (d.value ?? 0), 0)

    const pieData = top.map(d => ({
      name: d.report_name || d.entity_name || '未知',
      value: d.value,
      itemStyle: d.is_anomaly ? { borderColor: '#ef4444', borderWidth: 2 } : undefined,
    }))
    if (otherSum > 0) pieData.push({ name: '其他', value: otherSum })

    const total = sorted.reduce((s, d) => s + (d.value ?? 0), 0)

    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { top: 0, type: 'scroll' },
      series: [{
        type: 'pie',
        radius: ['40%', '70%'],
        center: ['50%', '55%'],
        data: pieData,
        label: { show: true, formatter: '{b}\n{d}%' },
        emphasis: {
          label: { fontSize: 16, fontWeight: 'bold' },
          itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' },
        },
      }],
      graphic: {
        type: 'text',
        left: 'center',
        top: '48%',
        style: { text: `总计\n${total?.toLocaleString() || '-'}`, textAlign: 'center', fontSize: 14, fontWeight: 'bold' },
      },
    } as EChartsOption
  },
  defaultReduction: { defaultTopN: 8, pageSize: 0 },
}

ChartRegistry.register(config)
export default config
```

- [ ] **Step 4: 创建仪表盘指标卡 (GaugeCard.tsx)**

```typescript
// frontend/src/components/charts/GaugeCard.tsx
import { ChartRegistry, type ChartTypeConfig } from './ChartRegistry'

const config: ChartTypeConfig = {
  type: 'gauge',
  name: 'KPI 仪表盘指标卡',
  isApplicable(metrics, reports) {
    return metrics.filter(m => m.expected_type === 'NUMERIC').length >= 1 && reports.length >= 1
  },
  buildOption(data, reduction) {
    const topN = reduction?.topN ?? 6
    // 取第一个 metric 的数据构建仪表盘
    const series = data.slice(0, topN)
    const allValues = series.flatMap(s => s.data.filter(d => d.value != null).map(d => d.value as number))
    const maxVal = Math.max(...allValues, 1)

    return {
      series: series.map((s, i) => {
        const latest = s.data.filter(d => d.value != null).pop()
        const val = latest?.value ?? 0
        const isAnomaly = latest?.is_anomaly ?? false
        return {
          type: 'gauge',
          center: [`${((i % 3) * 33 + 16.5)}%`, `${Math.floor(i / 3) * 55 + 28}%`],
          radius: '25%',
          min: 0,
          max: maxVal * 1.2,
          startAngle: 200,
          endAngle: -20,
          axisLine: {
            lineStyle: {
              width: 12,
              color: [
                [0.5, '#91CC75'],
                [0.8, '#FAC858'],
                [1, '#EE6666'],
              ],
            },
          },
          pointer: { length: '60%', width: 4, itemStyle: { color: isAnomaly ? '#ef4444' : 'auto' } },
          detail: {
            formatter: `{value}\n${latest?.unit || ''}`,
            fontSize: 14,
            offsetCenter: [0, '60%'],
            color: isAnomaly ? '#ef4444' : 'inherit',
          },
          title: { offsetCenter: [0, '85%'], fontSize: 12 },
          data: [{ value: val, name: s.metric_label }],
        }
      }),
    } as EChartsOption
  },
  defaultReduction: { defaultTopN: 6, pageSize: 0 },
}

ChartRegistry.register(config)
export default config
```

- [ ] **Step 5: 创建雷达图 (RadarChart.tsx)**

```typescript
// frontend/src/components/charts/RadarChart.tsx
import { ChartRegistry, type ChartTypeConfig } from './ChartRegistry'

const config: ChartTypeConfig = {
  type: 'radar',
  name: '多维度雷达图',
  isApplicable(metrics, reports) {
    const n = metrics.filter(m => m.expected_type === 'NUMERIC').length
    return n >= 3 && n <= 10 && reports.length >= 1 && reports.length <= 5
  },
  buildOption(data, reduction) {
    const topDims = reduction?.topN ?? 10
    const seriesData = data.slice(0, topDims)

    // 归一化
    const allValues = seriesData.flatMap(s => s.data.filter(d => d.value != null).map(d => d.value as number))
    const maxVal = Math.max(...allValues, 1)

    // 按报告分组
    const reportNames = [...new Set(seriesData.flatMap(s => s.data.map(d => d.report_name || d.entity_name || '未知')))]
    const byReport = reportNames.slice(0, 5).map(name => ({
      name,
      value: seriesData.map(s => {
        const pt = s.data.find(d => (d.report_name || d.entity_name) === name)
        return pt?.value != null ? (pt.value / maxVal) * 100 : 0
      }),
    }))

    return {
      tooltip: {},
      legend: { top: 0, data: byReport.map(r => r.name) },
      radar: {
        indicator: seriesData.map(s => ({ name: s.metric_label, max: 100 })),
        shape: 'polygon',
        splitNumber: 5,
      },
      series: [{
        type: 'radar',
        data: byReport.map(r => ({
          name: r.name,
          value: r.value,
          areaStyle: { opacity: 0.1 },
        })),
      }],
    } as EChartsOption
  },
  defaultReduction: { defaultTopN: 10, pageSize: 0 },
}

ChartRegistry.register(config)
export default config
```

- [ ] **Step 6: 创建热力图 (HeatmapChart.tsx)**

```typescript
// frontend/src/components/charts/HeatmapChart.tsx
import { ChartRegistry, type ChartTypeConfig } from './ChartRegistry'

const config: ChartTypeConfig = {
  type: 'heatmap',
  name: '数据热力矩阵',
  isApplicable(metrics, reports) {
    return metrics.filter(m => m.expected_type === 'NUMERIC').length >= 4 || reports.length >= 10
  },
  buildOption(data, reduction) {
    const maxRow = reduction?.topN ?? 20
    const maxCol = reduction?.pageSize ?? 10

    const reportNames = [...new Set(data.flatMap(s => s.data.map(d => d.report_name || d.entity_name || '未知')))].slice(0, maxRow)
    const metricDefs = data.slice(0, maxCol)

    const allValues = data.flatMap(s => s.data.map(d => d.value).filter((v): v is number => v != null))
    const minVal = Math.min(...allValues)
    const maxVal = Math.max(...allValues)

    const heatData: [number, number, number][] = []
    metricDefs.forEach((s, colIdx) => {
      s.data.forEach(d => {
        const rowIdx = reportNames.indexOf(d.report_name || d.entity_name || '未知')
        if (rowIdx >= 0 && d.value != null) {
          heatData.push([colIdx, rowIdx, d.value])
        }
      })
    })

    return {
      tooltip: { position: 'top' },
      grid: { left: 120, right: 40, top: 40, bottom: 60 },
      xAxis: {
        type: 'category',
        data: metricDefs.map(s => s.metric_label),
        axisLabel: { rotate: 45 },
        position: 'top',
      },
      yAxis: {
        type: 'category',
        data: reportNames.map(n => n.length > 15 ? n.slice(0, 15) + '...' : n),
        axisLabel: { fontSize: 11 },
      },
      visualMap: {
        min: minVal,
        max: maxVal,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        inRange: { color: ['#e8f5e9', '#c8e6c9', '#a5d6a7', '#66bb6a', '#2e7d32', '#1b5e20'] },
      },
      series: [{
        type: 'heatmap',
        data: heatData,
        label: { show: true, fontSize: 10 },
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } },
      }],
    } as EChartsOption
  },
  defaultReduction: { defaultTopN: 20, pageSize: 10 },
}

ChartRegistry.register(config)
export default config
```

- [ ] **Step 7: 创建 charts 桶文件**

```typescript
// frontend/src/components/charts/index.ts
export { ChartRegistry } from './ChartRegistry'
export type { ChartTypeConfig, SeriesData, DataPoint, MetricDef, Report, ReductionConfig } from './ChartRegistry'

// 导入即自注册
import './LineChart'
import './BarChart'
import './PieChart'
import './GaugeCard'
import './RadarChart'
import './HeatmapChart'
```

- [ ] **Step 8: 重构 ChartRenderer 为 ChartRegistry 调用层**

```typescript
// frontend/src/components/ChartRenderer.tsx (简化版)
import React from 'react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { LineChart, BarChart, PieChart, GaugeChart, RadarChart, HeatmapChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, TitleComponent, GraphicComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { ChartRegistry, type SeriesData, type ReductionConfig } from './charts/ChartRegistry'
import './charts'  // 触达所有图表自注册

echarts.use([LineChart, BarChart, PieChart, GaugeChart, RadarChart, HeatmapChart,
  GridComponent, TooltipComponent, LegendComponent, TitleComponent, GraphicComponent, VisualMapComponent, CanvasRenderer])

interface Props {
  chartType: string
  data: SeriesData[]
  reduction?: ReductionConfig
  height?: number
}

const ChartRenderer: React.FC<Props> = ({ chartType, data, reduction, height = 400 }) => {
  const config = ChartRegistry.get(chartType)
  if (!config) return <div>不支持的图表类型: {chartType}</div>

  const option = config.buildOption(data, reduction)
  if (!option) return <div>无法构建图表配置</div>

  return <ReactEChartsCore echarts={echarts} option={option} style={{ height, width: '100%' }} notMerge />
}

export const COLORS = ['#5470C6', '#91CC75', '#FAC858', '#EE6666', '#73C0DE', '#3BA272', '#FC8452', '#9A60B4', '#EA7CCC', '#B39DDB']

export default ChartRenderer
```

- [ ] **Step 9: 验证 6 种图表全部可渲染**

```bash
cd frontend && npm run dev
```
- 用测试数据分别调用 ChartRegistry.buildOption('line'/'bar'/'pie'/'gauge'/'radar'/'heatmap', mockData)
- 验证每种图表返回有效的 EChartsOption 对象

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/charts/ frontend/src/components/ChartRenderer.tsx
git commit -m "feat: refactor ChartRenderer to ChartRegistry + add 6 chart types (line/bar/pie/gauge/radar/heatmap)"
```

---

### Task P1.3: useDataReducer 智能降载 Hook

**Files:**
- Create: `frontend/src/hooks/useDataReducer.ts`

**Interfaces:**
- Consumes: `SeriesData[]`, `ReductionConfig`, `ReductionStrategy`
- Produces: `{ reducedData, controls, stats }` — 由 `AutoChartGrid` 注入每个图表

- [ ] **Step 1: 创建 useDataReducer hook**

```typescript
// frontend/src/hooks/useDataReducer.ts
import { useState, useMemo, useCallback } from 'react'
import type { SeriesData, ReductionConfig, ReductionStrategy } from '../components/charts/ChartRegistry'

interface ReductionControls {
  topN: number
  setTopN: (n: number) => void
  granularity: 'day' | 'month' | 'quarter' | null
  setGranularity: (g: 'day' | 'month' | 'quarter' | null) => void
  anomalyFirst: boolean
  setAnomalyFirst: (b: boolean) => void
  page: number
  setPage: (p: number) => void
  totalPages: number
}

interface ReductionStats {
  total: number
  shown: number
  hidden: number
  hasReduction: boolean
}

function applyTopN(data: SeriesData[], n: number): SeriesData[] {
  return data.map(s => ({
    ...s,
    data: s.data.slice(0, n),
  }))
}

function aggregateByGranularity(data: SeriesData[], granularity: 'day' | 'month' | 'quarter'): SeriesData[] {
  return data.map(s => {
    const groups = new Map<string, { sum: number; count: number }>()
    s.data.forEach(d => {
      const key = truncateDate(d.fiscal_year || '', granularity)
      if (!groups.has(key)) groups.set(key, { sum: 0, count: 0 })
      const g = groups.get(key)!
      g.sum += d.value ?? 0
      g.count += 1
    })
    return {
      ...s,
      data: Array.from(groups.entries()).map(([key, g]) => ({
        fiscal_year: key,
        value: g.sum / g.count,
      })),
    }
  })
}

function truncateDate(date: string, granularity: 'day' | 'month' | 'quarter'): string {
  if (!date) return ''
  if (granularity === 'day') return date.slice(0, 10)
  if (granularity === 'month') return date.slice(0, 7)
  // quarter
  const month = parseInt(date.slice(5, 7), 10)
  const q = Math.ceil(month / 3)
  return `${date.slice(0, 4)}-Q${q}`
}

function anomalyFirst(data: SeriesData[]): SeriesData[] {
  return data.map(s => ({
    ...s,
    data: [...s.data].sort((a, b) => (b.is_anomaly ? 1 : 0) - (a.is_anomaly ? 1 : 0)),
  }))
}

export function useDataReducer(
  rawData: SeriesData[],
  strategy: ReductionStrategy,
) {
  const [topN, setTopN] = useState(strategy.defaultTopN)
  const [granularity, setGranularity] = useState<'day' | 'month' | 'quarter' | null>(
    strategy.aggregateGranularity || null
  )
  const [anomalyFirstEnabled, setAnomalyFirstEnabled] = useState(true)
  const [page, setPage] = useState(1)
  const pageSize = strategy.pageSize || 0

  const reducedData = useMemo(() => {
    let result = [...rawData]
    if (anomalyFirstEnabled) result = anomalyFirst(result)
    if (granularity) result = aggregateByGranularity(result, granularity)
    if (topN > 0) result = applyTopN(result, topN)
    if (pageSize > 0 && topN > pageSize) {
      const start = (page - 1) * pageSize
      result = result.map(s => ({
        ...s,
        data: s.data.slice(start, start + pageSize),
      }))
    }
    return result
  }, [rawData, topN, granularity, anomalyFirstEnabled, page, pageSize])

  const totalItems = rawData.reduce((s, x) => s + x.data.length, 0)
  const shownItems = reducedData.reduce((s, x) => s + x.data.length, 0)
  const totalPages = pageSize > 0 ? Math.ceil((topN > 0 ? Math.min(totalItems, topN) : totalItems) / pageSize) : 1

  const stats: ReductionStats = {
    total: totalItems,
    shown: shownItems,
    hidden: totalItems - shownItems,
    hasReduction: totalItems > shownItems,
  }

  const controls: ReductionControls = {
    topN, setTopN,
    granularity, setGranularity,
    anomalyFirst: anomalyFirstEnabled, setAnomalyFirst: setAnomalyFirstEnabled,
    page, setPage,
    totalPages,
  }

  return { reducedData, controls, stats }
}
```

- [ ] **Step 2: 在 ChartRenderer 中集成 useDataReducer**

```tsx
// 在 ChartRenderer 中添加降载逻辑
import { useDataReducer } from '../../hooks/useDataReducer'

const ChartRenderer: React.FC<Props> = ({ chartType, data, reduction: reductionOverride, height }) => {
  const config = ChartRegistry.get(chartType)
  if (!config) return <div>不支持的图表类型: {chartType}</div>

  // 使用降载 hook
  const { reducedData, controls, stats } = useDataReducer(
    data,
    config.defaultReduction,
  )

  // 合并外部 reduction 覆盖
  const finalReduction = { ...config.defaultReduction, topN: controls.topN, granularity: controls.granularity || undefined, anomalyFirst: controls.anomalyFirst, page: controls.page, pageSize: config.defaultReduction.pageSize }

  const option = config.buildOption(reducedData, finalReduction)
  if (!option) return <div>无法构建图表配置</div>

  return (
    <div style={{ position: 'relative' }}>
      {/* 降载控件 */}
      {stats.hasReduction && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={controls.topN} onChange={e => controls.setTopN(Number(e.target.value))}>
            <option value={10}>Top 10</option>
            <option value={20}>Top 20</option>
            <option value={0}>全部</option>
          </select>
          {strategy.aggregateGranularity && (
            <select value={controls.granularity || ''} onChange={e => controls.setGranularity((e.target.value || null) as any)}>
              <option value="">不聚合</option>
              <option value="day">按日</option>
              <option value="month">按月</option>
              <option value="quarter">按季度</option>
            </select>
          )}
          <label>
            <input type="checkbox" checked={controls.anomalyFirst} onChange={e => controls.setAnomalyFirst(e.target.checked)} />
            {' '}异常优先
          </label>
          {controls.totalPages > 1 && (
            <span>
              <button disabled={controls.page <= 1} onClick={() => controls.setPage(controls.page - 1)}>◀</button>
              <span style={{ margin: '0 8px' }}>第 {controls.page}/{controls.totalPages} 页</span>
              <button disabled={controls.page >= controls.totalPages} onClick={() => controls.setPage(controls.page + 1)}>▶</button>
            </span>
          )}
          <span style={{ color: '#888', fontSize: 12 }}>
            ⚠️ 已智能降载: 展示 {stats.shown}/{stats.total} 条，隐藏 {stats.hidden} 条普通数据
          </span>
        </div>
      )}
      <ReactEChartsCore echarts={echarts} option={option} style={{ height, width: '100%' }} notMerge />
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useDataReducer.ts frontend/src/components/ChartRenderer.tsx
git commit -m "feat: add useDataReducer hook with Top-N, aggregation, anomaly-first, pagination"
```

---

### Task P1.4: AutoChartGrid 自动图表网格组件

**Files:**
- Create: `frontend/src/components/AutoChartGrid.tsx`

**Interfaces:**
- Consumes: `batchId` (prop), `visualizationService`, `ChartRegistry`, `ChartRenderer`
- Produces: 自动渲染的图表矩阵 — 嵌入 `Dashboard` 批次详情区域

- [ ] **Step 1: 创建 AutoChartGrid**

```tsx
// frontend/src/components/AutoChartGrid.tsx
import React, { useEffect, useState, useMemo } from 'react'
import { Spin, Empty, Switch, Space, Typography } from 'antd'
import ChartRenderer from './ChartRenderer'
import { ChartRegistry } from './charts/ChartRegistry'
import './charts'  // 触发自注册
import visualizationService from '../services/visualizationService'
import batchService from '../services/batchService'
import type { MetricDefinition } from '../services/metricService'

const { Text, Title } = Typography

interface Props {
  batchId: number
}

interface ChartAssignment {
  chartType: string
  chartName: string
  metricKeys: string[]
  data: any // SeriesData[]
}

const AutoChartGrid: React.FC<Props> = ({ batchId }) => {
  const [loading, setLoading] = useState(true)
  const [chartAssignments, setChartAssignments] = useState<ChartAssignment[]>([])
  const [showAnomalyOnly, setShowAnomalyOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    generateCharts()
  }, [batchId])

  const generateCharts = async () => {
    setLoading(true)
    setError(null)
    try {
      // 1. 获取批次绑定的指标
      const batchDetail = await batchService.getBatchDetail(batchId)
      const allMetrics: MetricDefinition[] = batchDetail.metric_tags || []
      const numericMetrics = allMetrics.filter((m: any) => m.expected_type === 'NUMERIC')
      const allMetricKeys = numericMetrics.map((m: any) => m.metric_key)

      if (allMetricKeys.length === 0) {
        setChartAssignments([])
        setLoading(false)
        return
      }

      // 2. 获取对比数据
      const result = await visualizationService.getComparisonData([batchId], allMetricKeys)

      // 3. 自动分配图表
      const reports = Array.from(new Set(result.series.flatMap((s: any) => s.data.map((d: any) => d.report_name).filter(Boolean))))
        .map((name: any) => ({ report_name: name }))
      const assignments = ChartRegistry.autoAssign(numericMetrics as any, reports as any)

      // 4. 构建图表任务
      const tasks: ChartAssignment[] = assignments.map(config => {
        // 选择适合此图表类型的指标子集
        let selectedKeys: string[] = []
        if (config.type === 'pie') {
          // 饼图只用第一个指标
          selectedKeys = allMetricKeys.slice(0, 1)
        } else if (config.type === 'radar') {
          selectedKeys = allMetricKeys.slice(0, 10)
        } else {
          selectedKeys = allMetricKeys
        }

        const filteredSeries = result.series.filter((s: any) => selectedKeys.includes(s.metric_key))
        return {
          chartType: config.type,
          chartName: config.name,
          metricKeys: selectedKeys,
          data: filteredSeries,
        }
      })

      setChartAssignments(tasks)
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载图表数据失败')
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <Spin tip="正在生成智能分析图表..." style={{ display: 'block', padding: 40 }} />
  if (error) return <Text type="danger">{error}</Text>
  if (chartAssignments.length === 0) return <Empty description="该批次没有可用的数值型指标" />

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>📊 自动分析看板</Title>
        <Space>
          <Text type="secondary">仅显示异常</Text>
          <Switch size="small" checked={showAnomalyOnly} onChange={setShowAnomalyOnly} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            共 {chartAssignments.length} 张图表
          </Text>
        </Space>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(500px, 1fr))', gap: 16 }}>
        {chartAssignments.map((assignment, idx) => (
          <div key={idx} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, background: '#fff' }}>
            <Text strong style={{ marginBottom: 8, display: 'block' }}>{assignment.chartName}</Text>
            <ChartRenderer
              chartType={assignment.chartType}
              data={assignment.data}
              height={300}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default AutoChartGrid
```

- [ ] **Step 2: 集成到 Dashboard 批次详情区域**

在 `frontend/src/pages/Dashboard.tsx` 中导入并插入：

```tsx
import AutoChartGrid from '../components/AutoChartGrid'

// 在批次详情展开行或详情 Modal 中（ComparisonModal 附近），新增:
<AutoChartGrid batchId={selectedBatchId} />
```

- [ ] **Step 3: 验证自动图表生成**

```bash
cd frontend && npm run dev
```
- 选择一个已完成处理的批次，验证图表矩阵自动渲染
- 切换「仅显示异常」开关，验证异常标注工作的正确性

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AutoChartGrid.tsx frontend/src/pages/Dashboard.tsx
git commit -m "feat: add AutoChartGrid for automatic multi-chart rendering in batch detail"
```

---

### Task P1.5: ChartModal 增加自动模式开关

**Files:**
- Modify: `frontend/src/components/ChartModal.tsx`

- [ ] **Step 1: 增加自动模式切换**

在 `ChartModal.tsx` 中新增：

```tsx
const [autoMode, setAutoMode] = useState(true)  // 默认开启

// 在图表类型选择器上方新增:
<Space style={{ marginBottom: 16 }}>
  <Text>自动模式</Text>
  <Switch
    checked={autoMode}
    onChange={(checked) => {
      setAutoMode(checked)
      if (checked) {
        // 切换到自动模式，重置手动选择
        setChartData(null)
      }
    }}
  />
  <Text type="secondary">{autoMode ? '系统自动选择图表类型和指标' : '手动配置图表参数'}</Text>
</Space>

// 自动模式下隐藏类型/批次/指标选择器，提交时调用 ChartRegistry.autoAssign
```

- [ ] **Step 2: 验证切换效果**

- 确认默认进入自动模式
- 关闭自动模式时，恢复手动选择界面
- 两种模式生成的图表应一致

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ChartModal.tsx
git commit -m "feat: add auto-mode toggle to ChartModal, default on"
```

---

### ✅ P1 里程碑：自动可视化 + 6 种图表 + 智能降载 — 可独立验证

```bash
# 端到端验证
cd frontend && npm run dev
# 1. 打开批次详情 → AutoChartGrid 自动渲染 4-6 张图表
# 2. 在降载控件中切换 Top-N / 分页 / 聚合 → 图表实时更新
# 3. 切换到手动模式 → 仍可选择特定图表类型
```

---

## Phase P2（智能化）：AI 指标推荐

### Task P2.1: AI 指标推荐后端服务

**Files:**
- Create: `backend/app/services/ai_metric_recommender.py`
- Modify: `backend/app/api/v1/metrics.py` (新增 POST /ai-recommend 端点)
- Modify: `backend/app/api/v1/files.py` (上传时可选触发)

**Interfaces:**
- Consumes: SiliconFlow API (DeepSeek-V3), `Report` model (PDF parsed markdown)
- Produces: `POST /metrics/ai-recommend` → 推荐指标列表 + 自动生成的提示词

- [ ] **Step 1: 创建 AI 推荐服务**

```python
# backend/app/services/ai_metric_recommender.py
"""
AI 指标推荐服务 — 分析 PDF 样本，推荐指标体系 + 自动生成提示词。
"""
import json
import logging
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session
from openai import OpenAI
from app.config import get_settings

logger = logging.getLogger(__name__)

RECOMMEND_SYSTEM_PROMPT = """你是一个金融分析专家。请分析以下研究报告，完成两个任务：

1. 判断这份报告的类型（如：港股回购报告、A股年报、美股10-K、宏观研报等）
2. 列出该报告中**所有可以提取的关键指标**，并为每个指标：
   - 生成一个英文 metric_key（snake_case）
   - 给出中文 metric_label
   - 判断 expected_type（NUMERIC 数值型 或 TEXT 文本型）
   - 编写一句简洁的 prompt_instruction，指导 AI 如何从报告中精准提取该指标

返回严格 JSON 格式：
{
  "report_type": "报告类型",
  "recommended_metrics": [
    {
      "metric_key": "net_profit",
      "metric_label": "归母净利润",
      "expected_type": "NUMERIC",
      "prompt_instruction": "从合并利润表中提取归属于母公司股东的净利润，剔除一次性项目，单位为亿元"
    }
  ]
}

要求：
- 指标数量不少于 5 个，不多于 20 个
- 优先提取核心财务指标（营收、利润、资产、现金流等）
- 其次提取行业特有指标
- prompt_instruction 要具体，包含数据来源（如"合并资产负债表"）和清洗规则
- metric_key 全小写，用下划线分隔，如 total_assets、eps_diluted
"""

RESPONSE_SCHEMA = {
    "type": "json_object",
}


def recommend_metrics_from_report(
    report_markdown: str,
    report_type_hint: Optional[str] = None,
) -> Dict[str, Any]:
    """
    分析 PDF 报告内容，推荐可提取的指标体系。

    Args:
        report_markdown: PDF 转换后的 Markdown 文本（前 20 页）
        report_type_hint: 用户提供的报告类型提示（可选）

    Returns:
        {"report_type": str, "recommended_metrics": [{...}]}
    """
    settings = get_settings()
    client = OpenAI(
        api_key=settings.SILICONFLOW_API_KEY,
        base_url="https://api.siliconflow.cn/v1",
    )

    # 截断文本（最多 8000 字符，减少 token 消耗）
    truncated = report_markdown[:8000]

    user_prompt = f"请分析以下研究报告内容：\n\n{truncated}"
    if report_type_hint:
        user_prompt = f"这份报告的类型可能是：{report_type_hint}\n\n{user_prompt}"

    try:
        response = client.chat.completions.create(
            model="deepseek-ai/DeepSeek-V3",
            messages=[
                {"role": "system", "content": RECOMMEND_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=2000,
            response_format=RESPONSE_SCHEMA,
        )
        content = response.choices[0].message.content
        result = json.loads(content)
        # 验证返回格式
        if "recommended_metrics" not in result:
            result["recommended_metrics"] = []
        for m in result["recommended_metrics"]:
            m.setdefault("expected_type", "NUMERIC")
            m.setdefault("prompt_instruction", "")
        return result
    except Exception as e:
        logger.error(f"AI 指标推荐失败: {e}")
        raise


def recommend_metrics_from_text(
    text: str,
    report_type_hint: Optional[str] = None,
) -> Dict[str, Any]:
    """无 PDF 时，根据文字描述推荐指标"""
    settings = get_settings()
    client = OpenAI(
        api_key=settings.SILICONFLOW_API_KEY,
        base_url="https://api.siliconflow.cn/v1",
    )

    user_prompt = f"请为以下类型的报告推荐指标体系：{text}"
    if report_type_hint:
        user_prompt = f"报告类型：{report_type_hint}。{user_prompt}"

    try:
        response = client.chat.completions.create(
            model="deepseek-ai/DeepSeek-V3",
            messages=[
                {"role": "system", "content": RECOMMEND_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,  # 无实际文本时稍高，增加多样性
            max_tokens=2000,
            response_format=RESPONSE_SCHEMA,
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        logger.error(f"AI 指标推荐失败（文本模式）: {e}")
        raise
```

- [ ] **Step 2: 新增 POST /metrics/ai-recommend 端点**

在 `backend/app/api/v1/metrics.py` 中新增：

```python
from pydantic import BaseModel, Field
from app.services.ai_metric_recommender import recommend_metrics_from_report, recommend_metrics_from_text

class AIRecommendRequest(BaseModel):
    batch_id: Optional[int] = Field(None, description="已有批次的报告 ID，AI 将分析该批次中的第一份 PDF")
    report_type_hint: Optional[str] = Field(None, description="用户提供的报告类型提示")

class AIRecommendResponse(BaseModel):
    status: str = "success"
    report_type: str
    recommended_metrics: list


@router.post("/ai-recommend", response_model=AIRecommendResponse)
def ai_recommend_metrics(
    body: AIRecommendRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """AI 智能推荐指标 + 自动生成提示词"""
    if body.batch_id:
        # 从批次中获取第一份 PDF 的 Markdown 内容
        from app.models.report import Report
        report = db.query(Report).filter(
            Report.batch_id == body.batch_id,
            Report.user_id == current_user.id,
        ).first()
        if not report or not report.raw_markdown:
            raise HTTPException(status_code=404, detail="未找到可用的 PDF 解析内容，请先上传文件")

        result = recommend_metrics_from_report(
            report.raw_markdown,
            report_type_hint=body.report_type_hint,
        )
    elif body.report_type_hint:
        # 纯文本模式：用户描述报告类型
        result = recommend_metrics_from_text(
            body.report_type_hint,
            report_type_hint=body.report_type_hint,
        )
    else:
        raise HTTPException(status_code=400, detail="请提供 batch_id 或 report_type_hint")

    return AIRecommendResponse(
        report_type=result.get("report_type", "未知"),
        recommended_metrics=result.get("recommended_metrics", []),
    )
```

- [ ] **Step 3: 验证 AI 推荐**

```bash
# 1. 上传一份 PDF 到新批次
# 2. 调用推荐 API
curl -X POST "http://localhost:8005/api/v1/metrics/ai-recommend" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"batch_id": 1}'
# Expected: 返回 report_type + recommended_metrics 列表

# 3. 纯文本模式
curl -X POST "http://localhost:8005/api/v1/metrics/ai-recommend" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"report_type_hint": "A股上市公司年度报告"}'
# Expected: 返回推荐的 A 股年服指标体系
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/ai_metric_recommender.py backend/app/api/v1/metrics.py
git commit -m "feat: add AI metric recommender service + POST /metrics/ai-recommend endpoint"
```

---

### Task P2.2: 前端 AI 推荐弹窗组件

**Files:**
- Create: `frontend/src/components/AIMetricRecommender.tsx`

- [ ] **Step 1: 创建 AIMetricRecommender**

```tsx
// frontend/src/components/AIMetricRecommender.tsx
import React, { useState } from 'react'
import { Modal, Button, Checkbox, List, Tag, Space, Spin, message, Input, Typography, Tooltip } from 'antd'
import { RobotOutlined, EditOutlined } from '@ant-design/icons'
import api from '../services/api'
import metricService from '../services/metricService'
import templateService from '../services/templateService'

const { Text, Paragraph } = Typography

interface RecommendedMetric {
  metric_key: string
  metric_label: string
  expected_type: 'NUMERIC' | 'TEXT'
  prompt_instruction?: string
}

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
  batchId?: number   // 可选，有 batchId 则分析 PDF，无则用文本描述
}

const AIMetricRecommender: React.FC<Props> = ({ open, onClose, onCreated, batchId }) => {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ report_type: string; recommended_metrics: RecommendedMetric[] } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editingMetric, setEditingMetric] = useState<string | null>(null)
  const [editingPrompt, setEditingPrompt] = useState('')
  const [reportTypeHint, setReportTypeHint] = useState('')
  const [creating, setCreating] = useState(false)
  const [saveAsTemplate, setSaveAsTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')

  const handleRecommend = async () => {
    setLoading(true)
    try {
      const body: any = {}
      if (batchId) {
        body.batch_id = batchId
      } else {
        body.report_type_hint = reportTypeHint || undefined
      }
      const res = await api.post('/metrics/ai-recommend', body)
      setResult(res.data)
      // 默认全选所有数值型指标
      const numericKeys = res.data.recommended_metrics
        .filter((m: RecommendedMetric) => m.expected_type === 'NUMERIC')
        .map((m: RecommendedMetric) => m.metric_key)
      setSelected(new Set(numericKeys))
    } catch (err: any) {
      message.error(err.response?.data?.detail || 'AI 推荐失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    const toCreate = result!.recommended_metrics.filter(m => selected.has(m.metric_key))
    if (toCreate.length === 0) {
      message.warning('请至少选择一个指标')
      return
    }

    setCreating(true)
    let created = 0, failed = 0
    for (const m of toCreate) {
      try {
        // 如果用户在编辑中修改了提示词，使用修改后的
        const prompt = editingMetric === m.metric_key ? editingPrompt : m.prompt_instruction
        await metricService.createMetric({
          metric_key: m.metric_key,
          metric_label: m.metric_label,
          expected_type: m.expected_type,
          prompt_instruction: prompt,
        })
        created++
      } catch (err: any) {
        if (err.response?.status === 409) {
          // 已存在，跳过
        } else {
          failed++
        }
      }
    }

    // 如果勾选了保存为模板
    if (saveAsTemplate && templateName) {
      try {
        await templateService.createTemplate({
          name: templateName,
          description: `AI 推荐: ${result!.report_type}`,
          category: result!.report_type,
          metrics: toCreate,
        })
        message.success(`模板"${templateName}"已保存`)
      } catch {}
    }

    message.success(`创建成功 ${created} 个指标${failed > 0 ? `，${failed} 个失败` : ''}`)
    onCreated()
    onClose()
    // 重置状态
    setResult(null)
    setSelected(new Set())
    setCreating(false)
  }

  return (
    <Modal
      title={<Space>🤖 AI 智能推荐指标</Space>}
      open={open}
      onCancel={onClose}
      width={700}
      footer={
        result ? [
          <Button key="cancel" onClick={onClose}>取消</Button>,
          <Button key="create" type="primary" loading={creating} onClick={handleCreate}>
            一键创建 ({selected.size} 个已选)
          </Button>,
        ] : [
          <Button key="cancel" onClick={onClose}>取消</Button>,
          <Button key="recommend" type="primary" loading={loading} onClick={handleRecommend}>
            开始推荐
          </Button>,
        ]
      }
    >
      {!result && !batchId && (
        <div style={{ marginBottom: 16 }}>
          <Text>描述你想分析的报告类型（可选）：</Text>
          <Input
            placeholder="例如：A股年报、美股10-K、港股回购报告..."
            value={reportTypeHint}
            onChange={e => setReportTypeHint(e.target.value)}
            style={{ marginTop: 8 }}
          />
          <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            留空将进行通用分析；提供类型可获得更精准的推荐
          </Text>
        </div>
      )}

      {loading && <Spin tip="AI 正在分析报告内容..." style={{ display: 'block', padding: 40 }} />}

      {result && (
        <>
          <div style={{ marginBottom: 16, padding: 12, background: '#f6ffed', borderRadius: 6 }}>
            <Text strong>📋 识别报告类型：</Text>
            <Tag color="green">{result.report_type}</Tag>
            <Text type="secondary">共推荐 {result.recommended_metrics.length} 个指标</Text>
          </div>

          <Space style={{ marginBottom: 8 }}>
            <Button size="small" onClick={() => setSelected(new Set(result.recommended_metrics.map(m => m.metric_key)))}>
              全选
            </Button>
            <Button size="small" onClick={() => setSelected(new Set(result.recommended_metrics.filter(m => m.expected_type === 'NUMERIC').map(m => m.metric_key)))}>
              仅选数值型
            </Button>
            <Button size="small" onClick={() => setSelected(new Set())}>
              取消全选
            </Button>
          </Space>

          <List
            dataSource={result.recommended_metrics}
            style={{ maxHeight: 400, overflow: 'auto' }}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Tooltip title="编辑提示词" key="edit">
                    <Button
                      type="text" size="small"
                      icon={<EditOutlined />}
                      onClick={() => {
                        setEditingMetric(item.metric_key)
                        setEditingPrompt(item.prompt_instruction || '')
                      }}
                    />
                  </Tooltip>,
                ]}
              >
                <Checkbox
                  checked={selected.has(item.metric_key)}
                  onChange={e => {
                    const next = new Set(selected)
                    e.target.checked ? next.add(item.metric_key) : next.delete(item.metric_key)
                    setSelected(next)
                  }}
                >
                  <Space>
                    <Tag color={item.expected_type === 'NUMERIC' ? 'blue' : 'orange'}>
                      {item.expected_type}
                    </Tag>
                    <Text strong>{item.metric_label}</Text>
                    <Text code>{item.metric_key}</Text>
                  </Space>
                </Checkbox>
                {/* 编辑提示词内联 */}
                {editingMetric === item.metric_key && (
                  <div style={{ marginLeft: 24, marginTop: 4 }}>
                    <Input.TextArea
                      value={editingPrompt}
                      onChange={e => setEditingPrompt(e.target.value)}
                      rows={2}
                      size="small"
                      placeholder="指导 AI 如何提取该指标..."
                    />
                    <Button size="small" type="link" onClick={() => setEditingMetric(null)}>完成</Button>
                  </div>
                )}
                {editingMetric !== item.metric_key && item.prompt_instruction && (
                  <div style={{ marginLeft: 24, marginTop: 2 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>📝 {item.prompt_instruction}</Text>
                  </div>
                )}
              </List.Item>
            )}
          />

          <div style={{ marginTop: 16, padding: 12, border: '1px dashed #d9d9d9', borderRadius: 6 }}>
            <Checkbox checked={saveAsTemplate} onChange={e => setSaveAsTemplate(e.target.checked)}>
              同时保存为我的模板
            </Checkbox>
            {saveAsTemplate && (
              <Input
                placeholder="模板名称（如：我的港股回购模板）"
                value={templateName}
                onChange={e => setTemplateName(e.target.value)}
                style={{ marginTop: 8 }}
              />
            )}
          </div>
        </>
      )}
    </Modal>
  )
}

export default AIMetricRecommender
```

- [ ] **Step 2: 集成到 Dashboard**

在 `Dashboard.tsx` 中 `MetricSettingsModal` 的"添加指标"按钮附近新增"🤖 AI 推荐"按钮，点击打开 `AIMetricRecommender`。

- [ ] **Step 3: 端到端验证**

```bash
cd frontend && npm run dev
cd backend && source venv/Scripts/activate && uvicorn app.main:app --host 0.0.0.0 --port 8005
```
1. 上传一份 PDF → 完成处理
2. 点击 "AI 推荐" → 验证推荐列表展示
3. 勾选/取消勾选指标 → 编辑提示词 → 点击"一键创建"
4. 验证指标创建成功 → 验证模板保存成功

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AIMetricRecommender.tsx frontend/src/pages/Dashboard.tsx
git commit -m "feat: add AIMetricRecommender with review-confirm-create flow"
```

---

### ✅ P2 里程碑：AI 智能推荐 — 全流程验证

```bash
# 完整端到端验证
# 1. 用户上传 PDF
# 2. 处理完成后点击 "AI 推荐"
# 3. AI 返回推荐指标列表（含自动生成的提示词）
# 4. 用户筛选、编辑、确认
# 5. 一键创建 8+ 个指标 + 保存为模板
# 6. 后续上传勾选这些指标 → 自动提取 → AutoChartGrid 渲染
```

---

## 最终集成验证

### 全链路端到端测试

```bash
# 1. 启动全部服务
cd backend && source venv/Scripts/activate
redis-server &
celery -A app.tasks.celery_app worker --loglevel=info --pool=threads &
uvicorn app.main:app --host 0.0.0.0 --port 8005 &
cd ../frontend && npm run dev

# 2. 完整用户流程
#    a. 登录 → Dashboard
#    b. 点击 "指标设置" → "从模板导入" → 选择"A股年报通用" → 一键导入 15 个指标
#    c. 点击 ✏️ 编辑某个指标的提示词 → 保存
#    d. 上传 5 份 A 股年报 PDF → 选择刚导入的指标 → 开始上传
#    e. 等待 Celery 处理完成
#    f. 点击批次 → 自动渲染 5 张图表（折线/柱状/饼图/雷达/热力图）
#    g. 在图表控件中切换 Top-10 / 按月聚合 → 验证降载
#    h. 验证异常值标红
#    i. 点击 "AI 推荐" → 上传新 PDF → 获得推荐 → 一键创建
```

### 回归测试检查清单

- [ ] 现有登录/注册/忘记密码流程正常
- [ ] 现有上传 → 处理 → 查看矩阵流程正常
- [ ] 现有手动 ChartModal 仍然可用
- [ ] 系统预置 8 个港股指标未受影响
- [ ] Celery 异步处理不受影响
- [ ] 现有 JWT 认证 + Token 刷新正常
- [ ] Excel 导出功能正常
