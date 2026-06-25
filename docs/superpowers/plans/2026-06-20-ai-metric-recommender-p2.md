# P2: AI 指标推荐 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 AI 驱动的指标推荐系统：调用 DeepSeek-V3 分析 PDF 报告样本，自动推荐指标体系并生成提取提示词，用户审核确认后一键批量创建。

**Architecture:** 后端新增 `ai_metric_recommender.py` 服务 + `POST /metrics/ai-recommend` 端点；前端新增 `AIMetricRecommender` 弹窗组件，集成到 `MetricSettingsModal` 的「添加指标」按钮旁。

**Tech Stack:** Python FastAPI + SQLAlchemy + OpenAI SDK (SiliconFlow) | React 18 + TypeScript + Ant Design

## Global Constraints

- Python 3.10+, FastAPI, SQLAlchemy ORM
- React 18 + TypeScript, Ant Design 5
- MySQL 8.0.30, utf8mb4_unicode_ci
- AI 推荐依赖 SiliconFlow API（DeepSeek-V3），`response_format: json_object`
- 现有 API 路径和响应格式不变（向后兼容）
- 系统预置指标（is_system=True）不可编辑、不可删除
- 所有面向用户的文本必须使用中文；代码注释使用中文

---

## 文件结构总览

```
后端新增 (1 file):
├─ backend/app/services/ai_metric_recommender.py   — AI 推荐服务

后端修改 (1 file):
├─ backend/app/api/v1/metrics.py                    — 新增 POST /ai-recommend

前端新增 (1 file):
├─ frontend/src/components/AIMetricRecommender.tsx  — AI 推荐弹窗

前端修改 (1 file):
├─ frontend/src/components/MetricSettingsModal.tsx   — 新增「AI 推荐」按钮入口
```

---

### Task P2.1: AI 指标推荐后端服务 + API 端点

**Files:**
- Create: `backend/app/services/ai_metric_recommender.py`
- Modify: `backend/app/api/v1/metrics.py`（文件末尾新增端点 + 新增 Schema 类）

**Interfaces:**
- Consumes: `Report.raw_markdown`、`SiliconFlow API (DeepSeek-V3)`、`get_settings()` 中的 `SILICONFLOW_API_KEY`
- Produces: `POST /api/v1/metrics/ai-recommend` → `{ status, report_type, recommended_metrics: [{metric_key, metric_label, expected_type, prompt_instruction}] }`

- [ ] **Step 1: 创建 AI 推荐服务文件**

```python
# backend/app/services/__init__.py  （空文件，标记为 Python 包）
```

```python
# backend/app/services/ai_metric_recommender.py
"""
AI 指标推荐服务 — 分析 PDF 样本，推荐指标体系 + 自动生成提示词。
"""
import json
import logging
from typing import Optional, Dict, Any
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
        base_url=settings.SILICONFLOW_API_BASE,
    )

    # 截断文本（最多 8000 字符，减少 token 消耗）
    truncated = report_markdown[:8000]

    user_prompt = f"请分析以下研究报告内容：\n\n{truncated}"
    if report_type_hint:
        user_prompt = f"这份报告的类型可能是：{report_type_hint}\n\n{user_prompt}"

    try:
        response = client.chat.completions.create(
            model=settings.SILICONFLOW_MODEL,
            messages=[
                {"role": "system", "content": RECOMMEND_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=2000,
            response_format={"type": "json_object"},
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
        base_url=settings.SILICONFLOW_API_BASE,
    )

    user_prompt = f"请为以下类型的报告推荐指标体系：{text}"
    if report_type_hint:
        user_prompt = f"报告类型：{report_type_hint}。{user_prompt}"

    try:
        response = client.chat.completions.create(
            model=settings.SILICONFLOW_MODEL,
            messages=[
                {"role": "system", "content": RECOMMEND_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=2000,
            response_format={"type": "json_object"},
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        logger.error(f"AI 指标推荐失败（文本模式）: {e}")
        raise
```

- [ ] **Step 2: 创建 services 包的 __init__.py**

```bash
# 确保 services 目录是 Python 包
# 如果 backend/app/services/__init__.py 不存在则创建空文件
```

- [ ] **Step 3: 在 metrics.py 中新增 Schema 类和端点**

在 `backend/app/api/v1/metrics.py` 的 import 区域新增：

```python
from pydantic import BaseModel, Field
from typing import Optional, List
from app.services.ai_metric_recommender import recommend_metrics_from_report, recommend_metrics_from_text
```

在文件末尾（`update_metric_definition` 函数之后，`# -*- coding: utf-8 -*-` 之前）新增：

```python
# ── AI 指标推荐 ──────────────────────────────────────────────

class AIRecommendRequest(BaseModel):
    """AI 指标推荐请求"""
    batch_id: Optional[int] = Field(None, description="已有批次的 ID，AI 将分析该批次中的第一份 PDF")
    report_type_hint: Optional[str] = Field(None, max_length=200, description="用户提供的报告类型提示")


class RecommendedMetricItem(BaseModel):
    """推荐的单条指标"""
    metric_key: str
    metric_label: str
    expected_type: str
    prompt_instruction: Optional[str] = ""


class AIRecommendResponse(BaseModel):
    """AI 指标推荐响应"""
    status: str = "success"
    report_type: str
    recommended_metrics: List[RecommendedMetricItem]


@router.post("/ai-recommend", response_model=AIRecommendResponse)
def ai_recommend_metrics(
    body: AIRecommendRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """AI 智能推荐指标 + 自动生成提示词"""
    if body.batch_id:
        # 从批次中获取第一份已完成 PDF 的 Markdown 内容
        report = db.query(Report).join(
            UploadBatch, Report.batch_id == UploadBatch.id
        ).filter(
            Report.batch_id == body.batch_id,
            UploadBatch.user_id == current_user.id,
            Report.raw_markdown.isnot(None),
            Report.raw_markdown != "",
        ).first()

        if not report:
            raise HTTPException(
                status_code=404,
                detail="未找到可用的 PDF 解析内容，请确保批次中有已完成处理的报告"
            )

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
        raise HTTPException(
            status_code=400,
            detail="请提供 batch_id 或 report_type_hint"
        )

    return AIRecommendResponse(
        report_type=result.get("report_type", "未知"),
        recommended_metrics=result.get("recommended_metrics", []),
    )
```

同时需要在文件顶部 import 区域新增 `UploadBatch` 的导入：

```python
from app.models.batch import UploadBatch
```

- [ ] **Step 4: 验证后端**

```bash
cd E:\CC_T\backend
source venv/Scripts/activate

# 1. Python 导入验证
python -c "from app.services.ai_metric_recommender import recommend_metrics_from_report, recommend_metrics_from_text; print('✅ 服务导入成功')"

# 2. 启动 API 服务
uvicorn app.main:app --host 0.0.0.0 --port 8005
```

另开终端测试端点：

```bash
# 测试文本模式（无需 PDF）
curl -X POST "http://localhost:8005/api/v1/metrics/ai-recommend" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"report_type_hint": "A股上市公司年度报告"}'
# Expected: 200 OK，返回 report_type + recommended_metrics 列表（≥5 个）
```

- [ ] **Step 5: 提交**

```bash
git add backend/app/services/__init__.py backend/app/services/ai_metric_recommender.py backend/app/api/v1/metrics.py
git commit -m "feat(P2.1): add AI metric recommender service + POST /metrics/ai-recommend endpoint"
```

---

### Task P2.2: 前端 AI 推荐弹窗组件 + Dashboard 集成

**Files:**
- Create: `frontend/src/components/AIMetricRecommender.tsx`
- Modify: `frontend/src/components/MetricSettingsModal.tsx`（新增「AI 推荐」按钮 + AIMetricRecommender 调用）

**Interfaces:**
- Consumes: `POST /api/v1/metrics/ai-recommend`、`metricService.createMetric()`、`templateService.createTemplate()`、`api` (axios 实例)
- Produces: `AIMetricRecommender` 组件 — 由 `MetricSettingsModal` 打开

- [ ] **Step 1: 创建 AIMetricRecommender 组件**

```tsx
// frontend/src/components/AIMetricRecommender.tsx
import React, { useState } from 'react'
import {
  Modal, Button, Checkbox, List, Tag, Space, Spin, message,
  Input, Typography, Tooltip,
} from 'antd'
import { RobotOutlined, EditOutlined } from '@ant-design/icons'
import api from '../services/api'
import { metricService } from '../services/metricService'
import { templateService } from '../services/templateService'

const { Text } = Typography

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
  batchId?: number
}

const AIMetricRecommender: React.FC<Props> = ({ open, onClose, onCreated, batchId }) => {
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState<{
    report_type: string
    recommended_metrics: RecommendedMetric[]
  } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editingPrompt, setEditingPrompt] = useState('')
  const [reportTypeHint, setReportTypeHint] = useState('')
  const [saveAsTemplate, setSaveAsTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')

  const handleRecommend = async () => {
    setLoading(true)
    try {
      const body: Record<string, unknown> = {}
      if (batchId) {
        body.batch_id = batchId
      } else {
        body.report_type_hint = reportTypeHint || undefined
      }
      const res = await api.post('/metrics/ai-recommend', body)
      setResult(res.data)
      // 默认全选所有数值型指标
      const numericKeys = (res.data.recommended_metrics as RecommendedMetric[])
        .filter((m) => m.expected_type === 'NUMERIC')
        .map((m) => m.metric_key)
      setSelected(new Set(numericKeys))
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'AI 推荐失败，请稍后重试'
      message.error(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!result) return
    const toCreate = result.recommended_metrics.filter((m) => selected.has(m.metric_key))
    if (toCreate.length === 0) {
      message.warning('请至少选择一个指标')
      return
    }

    setCreating(true)
    let created = 0
    let failed = 0
    for (const m of toCreate) {
      try {
        const prompt =
          editingKey === m.metric_key ? editingPrompt : m.prompt_instruction
        await metricService.createMetric({
          metric_key: m.metric_key,
          metric_label: m.metric_label,
          expected_type: m.expected_type,
          prompt_instruction: prompt,
        })
        created++
      } catch (err: unknown) {
        if ((err as { response?: { status?: number } })?.response?.status === 409) {
          // 已存在，不算失败
        } else {
          failed++
        }
      }
    }

    // 如果勾选了保存为模板
    if (saveAsTemplate && templateName.trim()) {
      try {
        await templateService.createTemplate({
          name: templateName.trim(),
          description: `AI 推荐: ${result.report_type}`,
          category: result.report_type,
          metrics: toCreate.map((m) => ({
            metric_key: m.metric_key,
            metric_label: m.metric_label,
            expected_type: m.expected_type,
            prompt_instruction:
              editingKey === m.metric_key ? editingPrompt : m.prompt_instruction,
          })),
        })
        message.success(`模板「${templateName.trim()}」已保存`)
      } catch {
        // 模板保存失败不阻断指标创建
      }
    }

    message.success(`成功创建 ${created} 个指标${failed > 0 ? `，${failed} 个失败` : ''}`)
    onCreated()
    handleClose()
  }

  const handleClose = () => {
    setResult(null)
    setSelected(new Set())
    setEditingKey(null)
    setCreating(false)
    setSaveAsTemplate(false)
    setTemplateName('')
    onClose()
  }

  const toggleSelect = (key: string, checked: boolean) => {
    const next = new Set(selected)
    checked ? next.add(key) : next.delete(key)
    setSelected(next)
  }

  return (
    <Modal
      title={
        <Space>
          <RobotOutlined />
          <span>AI 智能推荐指标</span>
        </Space>
      }
      open={open}
      onCancel={handleClose}
      width={700}
      destroyOnClose
      footer={
        result
          ? [
              <Button key="cancel" onClick={handleClose}>
                取消
              </Button>,
              <Button
                key="create"
                type="primary"
                loading={creating}
                onClick={handleCreate}
              >
                一键创建（{selected.size} 个已选）
              </Button>,
            ]
          : [
              <Button key="cancel" onClick={handleClose}>
                取消
              </Button>,
              <Button
                key="recommend"
                type="primary"
                loading={loading}
                onClick={handleRecommend}
              >
                开始推荐
              </Button>,
            ]
      }
    >
      {/* 第一步：输入描述（无 batchId 时显示） */}
      {!result && !batchId && (
        <div style={{ marginBottom: 16 }}>
          <Text>描述你想分析的报告类型（可选）：</Text>
          <Input
            placeholder="例如：A股年报、美股10-K、港股回购报告..."
            value={reportTypeHint}
            onChange={(e) => setReportTypeHint(e.target.value)}
            style={{ marginTop: 8 }}
          />
          <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            留空将进行通用分析；提供类型可获得更精准的推荐
          </Text>
        </div>
      )}

      {/* 加载中 */}
      {loading && (
        <Spin
          tip="AI 正在分析报告内容..."
          style={{ display: 'block', padding: 40 }}
        >
          <div style={{ height: 80 }} />
        </Spin>
      )}

      {/* 推荐结果 */}
      {result && (
        <>
          {/* 报告类型标识 */}
          <div
            style={{
              marginBottom: 16,
              padding: 12,
              background: '#f6ffed',
              borderRadius: 6,
            }}
          >
            <Text strong>识别报告类型：</Text>
            <Tag color="green" style={{ marginLeft: 8 }}>
              {result.report_type}
            </Tag>
            <Text type="secondary" style={{ marginLeft: 8 }}>
              共推荐 {result.recommended_metrics.length} 个指标
            </Text>
          </div>

          {/* 快捷操作 */}
          <Space style={{ marginBottom: 12 }}>
            <Button
              size="small"
              onClick={() =>
                setSelected(
                  new Set(result.recommended_metrics.map((m) => m.metric_key))
                )
              }
            >
              全选
            </Button>
            <Button
              size="small"
              onClick={() =>
                setSelected(
                  new Set(
                    result.recommended_metrics
                      .filter((m) => m.expected_type === 'NUMERIC')
                      .map((m) => m.metric_key)
                  )
                )
              }
            >
              仅选数值型
            </Button>
            <Button size="small" onClick={() => setSelected(new Set())}>
              取消全选
            </Button>
          </Space>

          {/* 指标列表 */}
          <List
            dataSource={result.recommended_metrics}
            style={{ maxHeight: 400, overflow: 'auto' }}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Tooltip title="编辑提示词" key="edit">
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => {
                        setEditingKey(
                          editingKey === item.metric_key ? null : item.metric_key
                        )
                        setEditingPrompt(item.prompt_instruction || '')
                      }}
                    />
                  </Tooltip>,
                ]}
              >
                <Checkbox
                  checked={selected.has(item.metric_key)}
                  onChange={(e) => toggleSelect(item.metric_key, e.target.checked)}
                >
                  <Space>
                    <Tag
                      color={item.expected_type === 'NUMERIC' ? 'blue' : 'orange'}
                    >
                      {item.expected_type}
                    </Tag>
                    <Text strong>{item.metric_label}</Text>
                    <Text code>{item.metric_key}</Text>
                  </Space>
                </Checkbox>
              </List.Item>
            )}
          />

          {/* 提示词编辑区（展开在列表下方） */}
          {editingKey && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                background: '#fafafa',
                borderRadius: 6,
              }}
            >
              <Text strong>
                编辑提示词 —
                <Text code style={{ marginLeft: 4 }}>
                  {editingKey}
                </Text>
              </Text>
              <Input.TextArea
                value={editingPrompt}
                onChange={(e) => setEditingPrompt(e.target.value)}
                rows={3}
                style={{ marginTop: 8 }}
                placeholder="指导 AI 如何从报告中提取该指标..."
              />
            </div>
          )}

          {/* 保存为模板 */}
          <div
            style={{
              marginTop: 16,
              padding: 12,
              border: '1px dashed #d9d9d9',
              borderRadius: 6,
            }}
          >
            <Checkbox
              checked={saveAsTemplate}
              onChange={(e) => setSaveAsTemplate(e.target.checked)}
            >
              同时保存为我的模板
            </Checkbox>
            {saveAsTemplate && (
              <Input
                placeholder="模板名称（如：我的港股回购模板）"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
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

- [ ] **Step 2: 集成到 MetricSettingsModal**

在 `frontend/src/components/MetricSettingsModal.tsx` 中：

**新增 import：**
```tsx
import { BulbOutlined } from '@ant-design/icons'
import AIMetricRecommender from './AIMetricRecommender'
```

**新增 state：**
```tsx
// 在现有 useState 声明区域（约第 20 行）新增：
const [showAIRecommender, setShowAIRecommender] = useState(false)
```

**在「添加指标」按钮旁边新增「AI 推荐」按钮（约第 61 行，`<Space>` 内）：**
```tsx
<Space>
  <TemplateSelector onImportComplete={onRefresh} />
  <Button icon={<PlusOutlined />} onClick={onAddMetric} className="add-metric-btn">
    添加指标
  </Button>
  <Button
    icon={<BulbOutlined />}
    onClick={() => setShowAIRecommender(true)}
    className="ai-recommend-btn"
  >
    AI 推荐指标
  </Button>
</Space>
```

**在 Modal 关闭标签前（约第 125 行，`</Modal>` 之前）新增 AIMetricRecommender 调用：**
```tsx
<AIMetricRecommender
  open={showAIRecommender}
  onClose={() => setShowAIRecommender(false)}
  onCreated={onRefresh}
/>
```

- [ ] **Step 3: 验证前端编译**

```bash
cd E:\CC_T\frontend
npx tsc --noEmit
# Expected: 零错误输出
```

- [ ] **Step 4: 端到端验证**

```bash
# 终端 1: 启动后端
cd E:\CC_T\backend && source venv/Scripts/activate && uvicorn app.main:app --host 0.0.0.0 --port 8005

# 终端 2: 启动前端
cd E:\CC_T\frontend && npm run dev
```

验证流程：
1. 登录 → Dashboard → 点击「指标设置」
2. 点击「AI 推荐指标」按钮 → 弹窗打开
3. 输入「A股年报」→ 点击「开始推荐」
4. 验证返回 ≥5 个推荐指标、识别报告类型
5. 勾选/取消勾选 → 点击编辑提示词 → 修改后保存
6. 勾选「保存为模板」→ 输入模板名
7. 点击「一键创建」
8. 验证指标列表刷新，新建指标出现
9. 验证模板列表中新增模板

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/AIMetricRecommender.tsx frontend/src/components/MetricSettingsModal.tsx
git commit -m "feat(P2.2): add AIMetricRecommender modal with review-confirm-create flow"
```

---

### ✅ P2 里程碑：AI 智能推荐 — 全流程验证

```bash
# 完整端到端验证
# 1. 用户上传 PDF → 等待处理完成
# 2. 打开指标设置 → 点击「AI 推荐指标」
# 3. 选择刚上传的批次 → AI 分析 PDF 内容
# 4. AI 返回推荐指标列表（含自动生成的提示词）
# 5. 用户筛选、编辑提示词、确认
# 6. 一键创建 N 个指标 + 可选保存为模板
# 7. 后续上传选择这些指标 → 自动提取 → AutoChartGrid 渲染
```

### 回归检查

- [ ] 现有 MetricSettingsModal 的「添加指标」「从模板导入」功能不受影响
- [ ] 现有指标 CRUD（创建/编辑/删除）不受影响
- [ ] 无 batchId 时（纯文本模式）仍可正常推荐
- [ ] AI 推荐失败时前端显示友好错误提示（不崩溃）
- [ ] 指标已存在时（409）不阻断其他指标创建
