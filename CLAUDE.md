# CLAUDE.md

本文件为 Claude Code 提供此代码仓库的工作指引。

## 项目概览

DeepReader Agent — 批量上传 PDF 研究报告，通过 DeepSeek-V3（硅基流动平台）提取关键指标，生成对比表格（Excel/Markdown）的 Web 应用。内置 AI 聊天组件，支持基于报告内容的智能问答。

**技术栈：** React 18 + Vite + TypeScript（前端）| Python FastAPI（后端）| MySQL 8.0.30 | Celery + Redis | 硅基流动 API（DeepSeek-V3）

## 文档撰写规则

撰写任何文档内容（项目报告、技术文档、说明文件等）时，必须调用 `chinese-humanizer` 技能。该技能确保输出文本：
- 去除 AI 写作痕迹（空洞修饰语、模板化过渡词、夸大意义陈述等）
- 采用自然、专业的学术写作风格
- 句式长短交错，段落结构自然变化
- 不使用破折号（——和—）、中文括号（）、斜杠（/）、连字符（-）等符号
- 以具体数据和事实替代空泛评价

## 常用命令

### 后端（Python FastAPI）

```bash
cd backend

# 虚拟环境位于 backend/venv
source venv/Scripts/activate  # Windows Git Bash

# 安装依赖
pip install -r requirements.txt

# 初始化数据库（建表 + 写入默认管理员）
python init_db.py

# 启动 API 服务（热重载）
uvicorn app.main:app --reload --host 0.0.0.0 --port 8005

# 启动 Celery Worker（PDF 处理必需）
celery -A app.tasks.celery_app worker --loglevel=info --pool=threads

# 启动 Redis（Celery 依赖）
redis-server
```

### 前端（React + Vite）

```bash
cd frontend

# 安装依赖
npm install

# 开发服务器（端口 5173，/api → localhost:8005）
npm run dev

# 生产构建
npm run build
```

### 一键启动

```powershell
.\start-all.ps1   # 依次启动 Redis、Celery、后端、前端
```

### 环境变量

配置于 `backend/.env`（参考模板 `backend/.env.example`）。关键变量：
- `DATABASE_URL` — MySQL 连接字符串
- `SECRET_KEY` — JWT 签名密钥（生产环境必须修改）
- `REDIS_URL` — Celery 使用的 Redis 地址
- `SILICONFLOW_API_KEY` — 硅基流动平台 API 密钥
- `MAIL_SANDBOX_MODE` — `true` 时将邮件写入 `/logs/mock_mails/` 而非真实发送

## 架构

### 后端（`backend/app/`）

```
app/
├── main.py              # FastAPI 应用、CORS、生命周期（启动时 init_db）、统一异常处理（中文错误提示）
├── config.py            # pydantic-settings 读取 .env，通过 @lru_cache 缓存
├── database.py          # SQLAlchemy 引擎、SessionLocal、Base、get_db() 依赖注入
├── models/              # SQLAlchemy ORM 模型
│   ├── user.py          #   User（id, email, password_hash, nickname, is_admin, is_active, avatar_url）
│   ├── batch.py         #   UploadBatch（user_id, batch_name, status, total_files, processed_files）
│   ├── report.py        #   Report（batch_id, original_filename, stored_path, pdf_md5, file_size, status, raw_markdown, entity_name, error_message）
│   ├── metric.py        #   ExtractedMetric（EAV 模式：report_id, metric_name, metric_display_name, metric_value_num/raw, fiscal_year, unit, confidence）
│   ├── metric_definition.py  # MetricDefinition + BatchMetricRelation（动态指标配置，含 is_system/is_active）
│   ├── metric_template.py    # MetricTemplate（指标合集模板，含 JSON 指标列表 + category 分类）
│   ├── chat.py          #   ChatSession（session_id, user_id, report_id, title）+ ChatMessage（role, content, model_used）
│   └── password_reset_code.py  # PasswordResetCode（SHA-256 哈希验证码，含 retry_count 与 is_used 熔断）
├── schemas/             # Pydantic 请求/响应模型（user, batch, report, file, metric, metric_template, chat）
├── api/
│   ├── dependencies.py  # get_current_user、get_current_admin_user（JWT 解码 + Redis 黑名单校验）
│   └── v1/
│       ├── auth.py      #   注册（两步验证码）、登录（双 Token + Cookie）、刷新、忘记密码（两步）、邮箱修改（两步）、头像上传、个人信息
│       ├── files.py     #   上传（MD5 去重、指标绑定、Celery 分发）、报告删除/重命名/查看内容/PDF预览、跨批次文件列表
│       ├── batches.py   #   批次列表（分页）、批次详情（含指标对比矩阵）、兼容性校验、指标更新、可用报告、删除/重命名
│       ├── chat.py      #   SSE 流式聊天（报告绑定/通用双模态）、会话 CRUD（列表/创建/重命名/删除/清空消息）、历史消息
│       ├── admin.py     #   用户列表（搜索/筛选/分页）、启停状态、用户批次审计、报告穿透查看；系统指标 CRUD + 启停；合集模板 CRUD + 启停 + 一键全部切换
│       ├── metrics.py   #   自定义指标定义 CRUD、批量删除、AI 推荐（流式 + 非流式 + 直传文件分析）
│       ├── templates.py #   用户模板 CRUD + 导入指标
│       └── visualization.py  # 多批次/多指标趋势数据（折线图）和对比数据（柱状图），含异常标注
├── tasks/
│   ├── celery_app.py    # Celery 实例（Redis broker/backend，30分钟超时，4并发 worker，指数退避重试）
│   └── pdf_processor.py # process_batch（分发模式）→ process_single_report_task：parse_pdf（PyMuPDF，≤20页）→ extract_metrics_with_ai（DeepSeek-V3，json_object 模式，动态组装 Prompt）→ save_metrics（NUMERIC/TEXT 分流写入 EAV）
├── services/
│   └── ai_metric_recommender.py  # AI 指标推荐：分析 PDF 文本 → 返回推荐指标体系（含流式 SSE）
└── utils/
    ├── auth.py          # JWT 签发/校验（access 15分钟，refresh 7天），bcrypt 哈希/验证
    ├── email.py         # SMTP 邮件发送（沙盒模式下写入本地 HTML 文件）
    ├── email_validation.py  # 邮箱域名 TLD 严格校验 + 常见拼写纠正建议
    ├── file.py          # 文件保存（相对路径）、MD5 计算、删除、路径兼容解析、批量校验
    ├── http_client.py   # 线程安全 httpx.Client（threading.local 隔离，解决 Celery 并发问题）
    ├── redis_client.py  # Redis 单例管理、Token 黑名单操作（SETEX 自动过期）、可用性检测 + 内存降级
    ├── rate_limit.py    # 令牌桶限流（Redis 滑动窗口 + 内存兜底）
    ├── text_utils.py    # smart_truncate 智能截断（保留首尾，中间省略标记）
    └── anomaly_detection.py  # 三种异常检测算法（中位数偏离 ±5% / IQR 四分位距 / Z-Score），自动方法选择，三级敏感度，分组检测
```

### 前端（`frontend/src/`）

```
src/
├── main.tsx             # React 入口，ConfigProvider（Apple 主题色 #007AFF + 中文 locale），BrowserRouter
├── App.tsx              # 路由定义 + 启动时自动恢复会话（refresh_token Cookie → access_token）
├── components/
│   ├── Layout.tsx       # 应用外壳：磨砂顶栏、侧边导航菜单、面包屑、内容区（Outlet）、浮动 ChatWidget
│   ├── ChatWidget.tsx   # 浮动 AI 聊天小窗（SSE 流式，可折叠，固定右下角）
│   ├── ChatSidebar.tsx  # DeepSeek 风格历史会话侧边栏：时间分组（今天/昨天/7天内/30天内/按月）、折叠、行内重命名、删除
│   ├── MarkdownMessage.tsx  # AI 回复 Markdown 渲染（react-markdown + GFM），React.memo 优化流式性能
│   ├── VerificationCodeInput.tsx  # 6 位验证码输入（粘贴、方向键、自动跳格）
│   ├── UploadZone.tsx   # PDF 批量上传区域（拖拽、大小校验、批次命名、指标标签、AI 推荐入口）
│   ├── BatchTable.tsx   # 批次列表表格（行内重命名、状态图标、指标标签展开、操作按钮）
│   ├── ProcessingProgressOverlay.tsx  # 活跃批次处理进度卡片
│   ├── AddMetricModal.tsx  # 新增/编辑自定义指标弹窗（键名、显示名、类型、提示词）
│   ├── MetricSettingsModal.tsx  # 批次指标勾选矩阵弹窗（全选/新增/模板导入/AI 推荐/批量删除）
│   ├── TemplateSelector.tsx  # 指标模板选择器（系统+用户分组、预览、一键导入）
│   ├── AIMetricRecommender.tsx  # AI 智能推荐指标（上传前/批次/文本三种模式，SSE 流式，编辑确认创建）
│   ├── ChartRenderer.tsx  # 统一图表渲染器（6 种图表类型，兼容旧 trend/comparison，Top-N/聚合/分页控制）
│   ├── ChartModal.tsx   # 图表分析弹窗（自动模式：系统选型；手动模式：自选图表类型+批次多选+指标多选）量纲冲突检测
│   ├── ComparisonModal.tsx  # 对比矩阵弹窗（动态列，异常值高亮+Tooltip，Excel 导出，绑定 AI 助手）
│   ├── AutoChartGrid.tsx  # 自动图表网格（每指标独立折线图卡片，可切换柱状图，附加雷达/饼图辅助视图）
│   └── charts/
│       ├── ChartRegistry.ts   # 图表注册中心（类型定义、双 Y 轴构建、异常工具函数、autoAssign 自动分派）
│       ├── LineChart.tsx      # 折线图（趋势+对比模式，异常点红色标注）
│       ├── BarChart.tsx       # 柱状图（异常柱红色，支持 dataZoom 分页）
│       ├── PieChart.tsx       # 环形图（Top 8 + "其他"合并，中心总计，异常红边框）
│       ├── RadarChart.tsx     # 雷达图（归一化 0-100，polygon 形状，异常点标注）
│       ├── GaugeCard.tsx      # 仪表盘（半圆仪表，颜色分档绿/黄/红，异常指针变红）
│       ├── HeatmapChart.tsx   # 热力图（绿→蓝渐变，异常红边框，dataZoom 纵向分页）
│       └── index.ts           # 统一入口，副作用导入触发所有图表自注册
├── pages/
│   ├── Login.tsx         # 登录/注册双 Tab 页（两步注册流程：邮箱验证码 → 密码+昵称）
│   ├── ForgotPassword.tsx  # 忘记密码三步流程（邮箱 → 验证码 → 新密码）
│   ├── Dashboard.tsx     # 主工作台：上传 PDF、批次列表、对比矩阵、图表分析、AutoChartGrid
│   ├── Analytics.tsx     # 数据分析中心：多批次多指标可视化，自动模式（每指标独立图+辅助视图）和手动模式
│   ├── Metrics.tsx       # 指标库：自定义指标 CRUD、AI 推荐、模板导入、批量管理
│   ├── ChatPage.tsx      # AI 对话页：DeepSeek 风格全屏聊天（左侧历史栏+右侧对话区）、全屏模式（四向延展动画）、报告绑定
│   ├── FileList.tsx      # 全部文件：跨批次统一查看、搜索筛选、PDF 预览、Markdown 内容查看
│   ├── Profile.tsx       # 个人中心：头像上传、昵称编辑、邮箱修改（两步验证码流程）
│   └── AdminPanel.tsx    # 管理员面板：用户管理（搜索/筛选/状态切换/批次审计）、系统指标管理（CRUD + 启停）、合集模板管理（CRUD + 一键全部切换）
├── stores/
│   ├── authStore.ts      # Zustand + persist（accessToken 存内存，user 持久化 localStorage）；login/logout 时自动重置 chatStore
│   └── chatStore.ts      # 聊天状态管理：会话列表、消息历史、会话 CRUD、报告绑定、resetAll()
├── hooks/
│   ├── useChatStream.ts  # SSE 流式聊天 Hook（rAF 批量渲染、Abort 取消、120s 超时、401 自动刷新）
│   ├── useDataReducer.ts # 智能数据降载（Top-N 截断、时间聚合按日/月/季度、分页）
│   └── useDraggableModal.tsx  # Ant Design Modal 可拖拽 Hook（标题栏拖动、边界约束）
├── services/
│   ├── api.ts            # Axios 实例（baseURL /api/v1，withCredentials，401 拦截器全局互斥刷新+排队重试）
│   ├── authService.ts    # 认证 API（注册、登录、刷新、忘记密码、个人信息、头像上传、邮箱修改）
│   ├── batchService.ts   # 批次 API（列表/详情/对比/删除/重命名/指标更新）
│   ├── fileService.ts    # 文件 API（上传/列表/内容/PDF预览/删除/重命名）
│   ├── chatService.ts    # 聊天 API（SSE 流式、会话 CRUD、历史消息、清空消息）
│   ├── metricService.ts  # 指标 API（CRUD、批量删除、AI 推荐、管理员系统指标管理）
│   ├── templateService.ts  # 模板 API（用户模板 CRUD + 导入、管理员合集模板管理）
│   └── visualizationService.ts  # 可视化 API（趋势数据、对比数据、兼容性校验）
├── utils/
│   ├── errorHandler.ts   # 统一错误信息提取（Axios、FastAPI detail、Pydantic 验证错误）
│   ├── password.ts       # 密码强度检测器（5 项评分，weak/medium/strong + 中文标签）
│   └── dimensionDetector.ts  # 量纲智能检测（四层推断：关键词→单位→预置映射→兜底，冲突评估三级）
└── styles/
    ├── tokens.css        # CSS 设计 Token 变量（品牌色、中性色、间距、圆角、阴影、过渡、字体、布局）
    ├── shared.css        # 认证页面共享样式
    ├── components.css    # 跨页面公共组件样式
    └── index.css         # 全局基础样式
```

### 核心架构模式

**双 Token 认证流程：**
1. 登录 → `access_token` 在 JSON body 中返回（存于 Zustand 内存，不落 localStorage）
2. 登录 → `refresh_token` 设为 `httpOnly` Cookie（`Set-Cookie` 响应头）
3. `remember_me=true` → Cookie 设 `Max-Age=604800`（持久化）；`false` → 会话 Cookie
4. Axios 拦截器捕获 401 → 全局互斥调用 `/auth/refresh`（浏览器自动携带 Cookie）→ 排队重试失败请求
5. JWT 载荷：`{sub: user_id, email, is_admin, type: "access"|"refresh", exp}`
6. Token 黑名单存于 Redis（SETEX 自动过期），Redis 不可用时自动降级为内存 Set

**PDF 处理管道（Celery 异步）：**
1. `POST /api/v1/files/upload` → 校验文件（数量≤10、体积≤20MB）→ 计算 MD5 → 去重检查（命中秒传复用 raw_markdown）→ 创建批次和报告行 → 绑定指标到 batch_metric_relations → 分发 `process_batch` 任务
2. `process_batch(batch_id)` → 分发模式，每份报告独立 Celery 任务 → `parse_pdf`（PyMuPDF，最多 20 页）→ `extract_metrics_with_ai`（DeepSeek-V3，`response_format: json_object`，_build_dynamic_prompt 动态组装）→ `save_metrics`（按 NUMERIC/TEXT 分流写入 EAV 纵表）
3. 重试策略：最多 3 次，指数退避 + 随机抖动；最终失败 → 报告标记为 `failed`，批次状态联动更新（全部成功→completed，全部失败→failed，部分→partial）

**EAV 指标存储：**
- `extracted_metrics` 表采用实体-属性-值模式
- `metric_value_num`（DECIMAL）存储可排序/可筛选的数值；`metric_value_raw`（VARCHAR）存储原始文本
- `fiscal_year` 字段作为灵活的时期锚点（可承载日期如 "2026-06-02" 或财年如 "2025"）

**动态指标系统：**
- `batch_metric_relations` 表解耦批次与指标定义的绑定关系
- Celery 任务通过 `_load_batch_metrics()` 从关联表读取批次绑定的指标子集
- `_build_dynamic_prompt()` 根据指标集动态组装 Prompt（港股默认 8 项使用调优版 System Prompt）
- `_is_default_hk_stock_set()` 检测是否为港股默认指标集以切换 Prompt 策略
- `expected_type` 字段控制数据分流：NUMERIC → 强类型正则清洗后写入 metric_value_num；TEXT → 直写 metric_value_raw

**异常检测（对比矩阵）：**
- 仅当批次中有 ≥3 份报告共享同一 `stock_code` 时启用
- 三种算法自动选择：中位数偏离（±5%）、IQR 四分位距、Z-Score
- 价格异常：`highest_price_paid` 或 `lowest_price_paid` 偏离中位数超过阈值 → 浅橘色背景
- 成交量异常：`shares_repurchased` 或 `total_consideration` 超过其他报告均值的 200% → 浅红色背景

**AI 聊天系统：**
- SSE 流式传输（text/event-stream），前端通过 rAF 批量渲染避免卡顿
- 双模态：报告绑定模式（注入 raw_markdown 作为 Context）+ 通用知识模式（自由问答）
- 上下文窗口滑动：每次仅携带最新 5 轮（10 条）对话历史
- 令牌桶限流：每分钟 10 条（Redis 滑动窗口 + 内存兜底）
- 会话管理：DeepSeek 风格侧边栏，时间分组，CRUD 完整（创建/重命名/删除/清空消息）
- 自动标题：首次对话自动截取用户消息前 30 字符作为会话标题

**图表可视化系统：**
- ChartRegistry 注册中心 + 6 种图表的 autoAssign 自动分派
- 智能量纲检测：四层推断机制（关键词→单位→预置映射→兜底），双 Y 轴分组渲染
- 数据降载：Top-N 截断、时间聚合（按日/月/季度）、分页
- 异常数据在图表中自动高亮标注

### 数据库

- MySQL 8.0.30，字符集 `utf8mb4_unicode_ci`
- 10 张核心表：users, password_reset_codes, metric_definitions, upload_batches, batch_metric_relations, reports, extracted_metrics, chat_sessions, chat_messages, metric_templates
- 默认管理员：`15082036178@163.com` / `123456Zz@`（bcrypt 哈希在启动时自动修复损坏）
- `init_db.py` 负责建表和写入默认数据（含 8 项港股系统预置指标）

### 关键设计决策

- **refresh_token 不单独在响应体中返回**：`/auth/login` 接口同时在 JSON body 和 Cookie 中返回 `refresh_token`。Cookie 是主要传递机制，body 字段仅为向后兼容保留。
- **PDF 页数限制**：`parse_pdf()` 中硬编码最多处理 20 页，超出部分静默丢弃。
- **AI Prompt 策略**：默认港股 8 项指标使用调优版 HK_STOCK_SYSTEM_PROMPT（含章节锚定+数据清洗规则），自定义指标集使用通用动态 Prompt 组装。
- **CORS 白名单**：允许 localhost:5173、5174、3000、8080。生产环境需更新。
- **Redis 3.0 兼容性（Windows）**：本项目使用的 Windows Redis 3.0.504 不支持 RESP3 协议（HELLO 命令），因此 `requirements.txt` 锁定 redis-py 5.3.1，配合 `backend/sitecustomize.py` 补丁自动降级为 RESP2。`start-all.ps1` 启动时自动部署该补丁到 venv。若 Celery 日志出现 `unknown command 'HELLO'`，手动执行 `copy backend\sitecustomize.py backend\venv\Lib\site-packages\` 并重启 Celery。
- **Windows 端口策略**：端口被释放后可能有短暂残留期，`start-all.ps1` 启动前自动清理目标端口的僵尸进程。
- **前端状态隔离**：`authStore.setAuth()` 和 `authStore.clearAuth()` 中均调用 `chatStore.resetAll()` 确保用户切换时聊天数据完全隔离。
- **全屏动画**：ChatPage 全屏使用 `getBoundingClientRect()` + CSS transition 0.6s 实现四方向延展动画。
- **SSE 性能优化**：流式聊天使用 `requestAnimationFrame` 批量更新（多个 chunk 合并到 ~16ms 帧），`React.memo` 优化 Markdown 组件避免历史消息重复渲染。
