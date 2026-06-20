# 智能指标系统与自动可视化 — 设计规格说明

**日期**: 2026-06-20  
**状态**: 待审核  
**关联**: DeepReader Agent 项目  
**范围**: 本规格含 7 个模块，按优先级分三批交付（P0 → P1 → P2），详见「实施优先级」章节

---

## 背景

DeepReader Agent 当前存在四个关键体验缺陷，阻碍了"智能化数据析系统"的定位：

1. **指标创建繁琐** — 用户必须逐条手动填写 4 个字段（key/label/type/prompt），无批量/智能创建方式
2. **可视化需手动操作** — 用户需手动选图表类型→选批次→选指标→点生成，零自动化
3. **图表类型太少** — 仅折线图和柱状图两种，ECharts 6.x 能力远未发挥
4. **数据过载无处理** — 指标/报告数量多时图表拥挤不可读，无降载手段

此外，现有异常检测仅硬编码支持 4 个港股指标，自定义指标完全不受覆盖。

## 设计目标

- **一键创建指标**：AI 推荐 + 模板导入 + 批量创建，用户仅需审核确认
- **自动可视化**：进入批次详情即看图表矩阵，无需手动配置
- **6 种图表类型**：折线图、柱状图、饼图/环形图、雷达图、热力图、仪表盘指标卡
- **智能降载**：T​op-N + 聚合 + 异常优先三层策略，用户可调节
- **通用异常检测**：三种统计方法自动适配所有 NUMERIC 指标，参数可配置

## 总体架构

### 设计原则

1. **增量插入**：所有新功能作为独立模块，现有 API/组件不受影响
2. **图表工厂化**：`ChartRegistry` 统一注册/调度 6 种图表类型
3. **推荐-审核-确认**：AI 推荐 → 用户筛选编辑 → 一键创建
4. **模板兜底**：AI 推荐 + 系统模板 + 用户模板，三层保障

### 新增/修改文件清单

```
后端新增：
├─ app/models/metric_template.py          ← 模板 ORM 模型
├─ app/schemas/metric_template.py         ← 模板 Pydantic Schema
├─ app/api/v1/templates.py                ← 模板 CRUD API
├─ app/services/ai_metric_recommender.py  ← AI 指标推荐服务

后端修改：
├─ app/models/metric_definition.py        ← 增加编辑标记
├─ app/schemas/metric.py                  ← 增加 MetricUpdate Schema
├─ app/api/v1/metrics.py                  ← 增加 PUT /definitions/{id}
├─ app/api/v1/visualization.py            ← 新图表类型数据查询
├─ app/api/v1/files.py                    ← 上传触发 AI 推荐
├─ app/utils/anomaly_detection.py         ← 通用化异常检测引擎
├─ init_db.py                             ← 新增模板表 + 预置数据

前端新增：
├─ src/components/AIMetricRecommender.tsx  ← AI 推荐弹窗
├─ src/components/TemplateSelector.tsx     ← 模板选择器
├─ src/components/AutoChartGrid.tsx        ← 自动图表网格
├─ src/components/charts/ChartRegistry.ts  ← 图表注册工厂
├─ src/components/charts/PieChart.tsx      ← 饼图/环形图
├─ src/components/charts/GaugeCard.tsx     ← 仪表盘指标卡
├─ src/components/charts/RadarChart.tsx    ← 雷达图
├─ src/components/charts/HeatmapChart.tsx  ← 热力图
├─ src/components/charts/LineChart.tsx     ← 折线图（从 ChartRenderer 拆出）
├─ src/components/charts/BarChart.tsx      ← 柱状图（从 ChartRenderer 拆出）
├─ src/hooks/useDataReducer.ts             ← 智能降载 Hook
├─ src/services/templateService.ts         ← 模板 API 服务

前端修改：
├─ src/components/ChartRenderer.tsx        ← 重构为调用 ChartRegistry
├─ src/components/ChartModal.tsx           ← 增加"自动模式"开关
├─ src/components/AddMetricModal.tsx       ← 增加编辑模式
├─ src/components/MetricSettingsModal.tsx  ← 集成模板选择器
├─ src/pages/Dashboard.tsx                 ← 集成 AutoChartGrid
├─ src/services/metricService.ts           ← 增加 updateMetric
```

---

## 模块一：AI 指标推荐系统

### 数据流

```
用户上传 PDF（可选：0 份时 AI 根据用户描述的研报类型推荐；1 份时 AI 分析实际报告内容推荐）
       ↓
POST /api/v1/metrics/ai-recommend
  → app/services/ai_metric_recommender.py
       ↓
  1. 解析 PDF 前 20 页提取文本
  2. 组装 Prompt：「分析这份金融报告类型，列出所有可提取的关键指标」
  3. 调用 SiliconFlow API（DeepSeek-V3），response_format: json_object
  4. 返回结构化指标列表 + 自动生成的提示词
       ↓
  前端 AIMetricRecommender 弹窗展示推荐结果
```

### AI 返回 JSON 格式

```json
{
  "report_type": "港股回购报告",
  "recommended_metrics": [
    {
      "metric_key": "net_profit",
      "metric_label": "净利润",
      "expected_type": "NUMERIC",
      "prompt_instruction": "从合并利润表中提取归属于母公司股东的净利润，剔除一次性项目"
    }
  ]
}
```

### 前端交互（AIMetricRecommender 弹窗）

- 展示所有 AI 推荐的指标（checkbox 列表），每项显示 key/label/type/prompt
- 用户可勾选/取消每条指标
- 点击 📝 图标可 inline 编辑提示词
- 提供「全选」「仅选数值型」「保存为模板」快捷操作
- 「一键创建」按钮批量调用 POST /metrics/definitions，返回创建计数

### 后端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/metrics/ai-recommend` | 接收 report_id(batch_id)，返回推荐指标列表 |

---

## 模块二：指标模板系统

### 数据模型

```sql
CREATE TABLE metric_templates (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    category VARCHAR(50),              -- 报告类型分类
    is_system BOOLEAN DEFAULT FALSE,
    user_id INT,
    metrics JSON NOT NULL,             -- [{key, label, type, prompt_instruction}]
    created_at DATETIME,
    updated_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### 系统预置模板

| 模板名称 | 分类 | 指标数 |
|----------|------|--------|
| 港股回购报告 | 港股 | 8 |
| A 股年报通用 | A 股 | 15+ |
| 美股 10-K/10-Q | 美股 | 12+ |

### 模板 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/metrics/templates` | 系统模板 + 当前用户模板 |
| `POST` | `/metrics/templates` | 创建用户模板 |
| `PUT` | `/metrics/templates/{id}` | 编辑用户模板（仅自己的） |
| `DELETE` | `/metrics/templates/{id}` | 删除用户模板（仅自己的） |
| `POST` | `/metrics/templates/{id}/import` | 一键导入模板中全部指标 |

### 用户模板来源

1. 从零创建（在 TemplateSelector 中新建）
2. 从 AI 推荐结果保存
3. 从当前已选指标组合保存（"保存当前指标为模板"）
4. 从系统模板复制后修改

### 前端 TemplateSelector

- 嵌入 MetricSettingsModal 顶部，提供下拉菜单
- 列出所有可用模板（系统 + 用户），显示名称/分类/指标数
- 点击模板 → 预览指标列表 → 确认导入
- 提供「管理我的模板」入口

---

## 模块三：指标编辑能力

### 后端 PUT /metrics/definitions/{id}

- 可编辑字段：`metric_label`、`expected_type`、`prompt_instruction`
- 不可编辑：`metric_key`（数据库关联键，修改会导致历史数据断联）
- 不可编辑：`is_system`（系统指标受保护，返回 403）
- 只能编辑自己的指标（越权返回 403）
- 编辑不影响已关联批次的历史提取数据

### 前端改造

- `AddMetricModal` 新增 `mode: 'create' | 'edit'` prop
- 编辑模式下 `metric_key` 显示为只读灰色字段
- `MetricSettingsModal` 中每条自定义指标右侧增加 ✏️ 按钮
- `metricService.ts` 新增 `updateMetric(id, data)` 方法

---

## 模块四：自动可视化系统

### 核心理念

```
之前：用户 → 选图表类型 → 选批次 → 选指标 → 点生成 → 看一张图
之后：用户 → 进入批次详情 → 自动看到全部图表矩阵
```

### 图表自动决策引擎

```
批次绑定的 NUMERIC 指标列表
         ↓
   指标数量判断
    ╱    │    ╲
  ≤2个  3-6个  ≥7个
   ↓     ↓      ↓
柱状图  多图表  热力图
+折线图 网格    (矩阵预览)
+指标卡
         ↓
   报告数量判断
    ╱    │    ╲
  ≤10份 11-30份 ≥31份
   ↓      ↓       ↓
全量    Top-15   Top-10
渲染    渲染     +翻页
         ↓
   具体数据特征 → 分配图表类型:
   ┌──────────────┬─────────────────────┐
   │ 单指标×多报告  │ 柱状图               │
   │ 时间序列×指标  │ 折线图               │
   │ 多指标×单报告  │ 雷达图               │
   │ 占比型数据     │ 饼图/环形图           │
   │ 汇总型数据     │ 仪表盘指标卡          │
   │ 多报告×多指标  │ 热力图               │
   └──────────────┴─────────────────────┘
```

### AutoChartGrid 组件

- 接收 `batchId`，自动拉取指标定义 + 提取数据
- 调用 `ChartRegistry.autoAssign()` 决定生成哪些图表
- 以 2-3 列响应式 Grid 渲染全部图表
- 顶部控制栏提供「显示全部/仅异常/刷新」按钮
- 数据量超阈值时自动触发 `useDataReducer`

### ChartRegistry 图表注册工厂

```typescript
interface ChartType {
  type: 'line' | 'bar' | 'pie' | 'gauge' | 'radar' | 'heatmap'
  name: string
  isApplicable(metrics: MetricDef[], reports: Report[]): boolean
  buildOption(data: SeriesData[], reduction?: ReductionConfig): EChartsOption
  defaultReduction: ReductionStrategy
}
```

每种图表实现为独立文件，通过 `ChartRegistry.register()` 自注册。

### 与现有 ChartModal 的关系

- 保留 ChartModal 作为手动模式
- BatchTable 操作中新增「自动看板」按钮 → 跳转批次详情 AutoChartGrid
- ChartModal 内增加「自动模式」开关（默认开启）

---

## 模块五：智能降载系统

### 三层降载策略

**第一层：Top-N 筛选**
- 数据量 > 阈值时，按指定指标值降序排列，取前 N 条
- 默认阈值从每种图表类型配置中读取

**第二层：数据聚合**
- 时间轴数据可选按日/月/季度聚合
- 同组内取均值或求和

**第三层：异常优先展示**
- 异常值（经通用异常检测标记）优先排在最前
- 保证用户第一眼看到需关注的数据

### 用户可调节控件

每个图表顶部 Hover 时浮现控制栏：

| 控件 | 功能 | 默认值 |
|------|------|--------|
| Top-N 下拉 | 10/20/全部 | 根据报告量自动 |
| 粒度切换 | 按日/月/季度 | 按时间跨度自动 |
| 异常优先开关 | 开启/关闭 | 默认开启 |
| 分页翻页 | 每页 6 个指标 | 指标 > 6 时启用 |
| 搜索筛选 | 输入公司/指标名 | - |

### 各图表默认降载配置

| 图表类型 | Top-N | 聚合粒度 | 分页阈值 | 特殊策略 |
|----------|-------|---------|---------|---------|
| 折线图 | 20 | 按月 | 不分页 | 超过 24 个月自动聚合 |
| 柱状图 | 15 | - | 每页 8 条 | 按值降序取 Top |
| 饼图 | 8 | - | 不分页 | 超出合并为"其他" |
| 雷达图 | 10 维度 | - | 不分页 | 维度数=指标数 |
| 热力图 | 20×10 | - | 不分页 | 行列自动截断 |
| 指标卡 | 6 个 | - | 不分页 | 选最重要的 KPI |

---

## 模块六：新图表类型

### 饼图/环形图 (PieChart)

- `series.type: 'pie'`，`radius: ['40%', '70%']`
- 中心显示总计数值
- 超出 8 项的合并为"其他"扇区
- 适用场景：各公司回购金额占比、指标构成分布

### 仪表盘指标卡 (GaugeCard)

- `series.type: 'gauge'`，半圆仪表盘样式
- 每指标独立卡片，大字体数值 + 单位
- 颜色分档：绿（正常）/ 黄（关注）/ 红（异常，基于通用异常检测）
- 适用场景：关键 KPI 汇总（总回购金额、平均价格等）

### 雷达图 (RadarChart)

- `series.type: 'radar'`，`shape: 'polygon'`
- 每份报告一条多边形，最多 5 条
- 维度数 ≤ 10（超出按值排序取前 10）
- 适用场景：多公司综合能力对比

### 热力图 (HeatmapChart)

- `series.type: 'heatmap'`
- X 轴 = 报告名/公司名，Y 轴 = 指标名
- 颜色渐变：浅绿 → 深蓝
- 单元格内显示数值，过小时省略
- 适用场景：多报告×多指标矩阵概览

---

## 模块七：通用异常检测引擎

### 现状问题

现有 `app/utils/anomaly_detection.py` 仅硬编码支持 4 个港股指标（`highest_price_paid`、`lowest_price_paid`、`shares_repurchased`、`total_consideration`），前提是 ≥3 份报告共享同一 `stock_code`。自定义指标完全不受覆盖。

### 新设计：三种统计方法

**方法一：中位数偏离法（默认推荐）**
```
异常条件: |value - median| / |median| > threshold (默认 5%)
适用场景: 小样本（< 10 条）、分布未知
```

**方法二：IQR 四分位距法**
```
异常条件: value < Q1 - 1.5×IQR  或  value > Q3 + 1.5×IQR
适用场景: 偏态分布数据（偏度 > 1）
```

**方法三：Z-Score 标准差法**
```
异常条件: |value - μ| / σ > 2
适用场景: 近似正态分布数据
```

### 自动方法选择

| 数据特征 | 自动选择 | 原因 |
|----------|---------|------|
| 数据量 < 10 | 中位数偏离法 | 小样本下中位数更稳健 |
| 偏度 > 1 | IQR 四分位距法 | 不受极端值影响 |
| 近似正态 | Z-Score 法 | 正态分布下最精确 |
| ≥3 条共享分组键 | 组内对比模式 | 按 stock_code 等分组后组内检测 |

### 用户可配置参数（每个指标独立）

| 参数 | 默认值 | 可选值 |
|------|--------|--------|
| 检测方法 | 自动选择 | 中位数偏离 / IQR / Z-Score / 自动 |
| 敏感度 | 中 | 低（宽松）/ 中 / 高（严格） |
| 分组键 | 无 | stock_code / entity_name / 无 |
| 方向 | 双向 | 仅偏高 / 仅偏低 / 双向 |

### 全指标覆盖

- **所有 NUMERIC 类型指标**自动纳入异常检测
- ~~硬编码指标名~~ 改为遍历 `extracted_metrics` 中所有 `expected_type=NUMERIC` 的指标
- 检测时机：批次处理完成时自动触发，结果实时计算（不在 DB 中持久化，避免阈值调整后数据不一致）

### 图表呈现

| 图表类型 | 异常标记方式 |
|----------|-------------|
| 柱状图 | 异常柱子标红 + ⚠️ 标记，Tooltip 显示偏离百分比 |
| 折线图 | 异常点用红色虚线圆圈标出 |
| 热力图 | 异常单元格加粗红色边框 |
| 指标卡 | 异常数字变红，仪表盘指针进入红色区域 |
| 饼图 | 异常扇区略突出（explode） |
| 雷达图 | 异常维度轴线标红 |

### 后端 API

改造 `POST /batches/{id}/anomalies`，参数新增：

```json
{
  "method": "auto",        // auto | median_deviation | iqr | zscore
  "sensitivity": "medium", // low | medium | high
  "group_by": null,        // stock_code | entity_name | null
  "direction": "both"      // high | low | both
}
```

---

## 验证方案

### 后端验证

1. `ai_metric_recommender.py` 单元测试：Mock PDF + Mock AI 响应，验证推荐的 JSON 格式
2. 模板 CRUD API 集成测试：创建→导入→删除全流程
3. 指标编辑 API 测试：编辑自定义指标、拒绝编辑系统指标、拒绝编辑 metric_key
4. 可视化 API 测试：新图表类型数据查询返回正确 SeriesData
5. 异常检测测试：用已知数据验证三种方法的检测结果准确性

### 前端验证

1. AI 推荐弹窗：上传样本 PDF → 检查推荐结果展示 → 勾选 → 一键创建 → 验证指标创建成功
2. 模板选择器：选择系统模板 → 导入 → 验证指标列表更新
3. 自动可视化：创建含提取数据的批次 → 进入详情 → 验证图表矩阵自动渲染
4. ChartRegistry：验证 6 种图表在各自适用场景下正确渲染
5. 智能降载：上传 50 份报告的批次 → 验证 Top-N 截断 → 切换分页 → 切换粒度
6. 异常检测：创建含异常值的测试数据 → 验证图表中异常标注正确显示

### 端到端验证

1. 上传多份 PDF → AI 推荐指标 → 确认创建 → 等待处理 → 进入批次详情 → 验证自动图表矩阵 + 异常标注
2. 从模板导入指标 → 上传文件 → 验证处理正确 → 验证降载控件可调节
3. 指标编辑 → 验证历史数据不受影响 → 验证新处理使用更新后的配置

---

## 实施优先级

| 优先级 | 模块 | 理由 |
|--------|------|------|
| P0 | 模板系统 + 指标编辑 | 不依赖 AI，可立即提升创建效率 |
| P0 | 异常检测通用化 | 改动小，影响面大，风险低 |
| P1 | 自动可视化 + 新图表类型 | 核心体验升级，需模板系统先就位 |
| P1 | 智能降载系统 | 为大数据量场景提供保障 |
| P2 | AI 指标推荐 | 依赖 AI 调用，需前序模块稳定后接入 |

---

## 风险与注意事项

1. **AI 推荐不稳定性**：模板系统作为 fallback 保障，确保用户永远有路可走
2. **异常检测误报**：三种方法 + 可调敏感度 + 用户手动标记，逐步优化
3. **图表渲染性能**：6 张图表同时渲染可能影响性能，使用 React.lazy + 虚拟化按需加载
4. **历史数据兼容**：旧批次无 metric_definitions 时回退到系统预置指标，确保已有功能不受影响
