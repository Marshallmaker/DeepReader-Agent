# CLAUDE.md

本文件为 Claude Code 提供此代码仓库的工作指引。

## 项目概览

DeepReader Agent — 批量上传 PDF 研究报告，通过 DeepSeek-V3（硅基流动平台）提取关键指标，生成对比表格（Excel/Markdown）的 Web 应用。内置 AI 聊天组件，支持基于报告内容的智能问答。

**技术栈：** React 18 + Vite（前端）| Python FastAPI（后端）| MySQL 8.0.30 | Celery + Redis | 硅基流动 API（DeepSeek-V3）

## 需求文档对照（已同步）

`项目需求文档.md` 与代码实现已完成双向对齐，以下历史差距已全部修复：

- ✅ **动态指标系统**：`pdf_processor.py` 已通过 `_load_batch_metrics()` 从 `batch_metric_relations` 读取批次绑定的指标，`_build_dynamic_prompt()` 动态组装 Prompt，港股默认指标集使用调优版 Prompt
- ✅ **聊天模型**：代码 `ChatSession`/`ChatMessage` 与 DDL `chat_sessions`/`chat_messages` 完全一致
- ✅ **Token 黑名单**：已迁移至 Redis（SETEX 自动过期），Redis 不可用时自动降级为内存 Set
- ✅ **reports 表**：DDL 已包含 `file_size`、`error_message`、`entity_name` 及 `PARSING`/`EXTRACTING` 中间状态
- ✅ **entity_name 冗余字段**：Report 模型已添加，`pdf_processor.py` 中 AI 提取 company_name 后自动回填
- ✅ **批次状态 `partial`**：`BatchStatus` 枚举与 DDL 均已包含
- ✅ **前端 401 死循环**：`api.ts` 拦截器已修复（跳过 `/auth/refresh`、全局刷新锁、失败队列）

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
├── main.py              # FastAPI 应用、CORS、生命周期（启动时 init_db）、异常处理
├── config.py            # pydantic-settings 读取 .env，通过 @lru_cache 缓存
├── database.py          # SQLAlchemy 引擎、SessionLocal、Base、get_db() 依赖注入
├── models/              # SQLAlchemy ORM 模型
│   ├── user.py          #   User（id, email, password_hash, nickname, is_admin, is_active）
│   ├── batch.py         #   UploadBatch（user_id, status, total_files, processed_files）
│   ├── report.py        #   Report（batch_id, pdf_md5, stored_path, raw_markdown, status）
│   ├── metric.py        #   ExtractedMetric（EAV 模式：report_id, metric_name, metric_value_num/raw, fiscal_year）
│   ├── metric_definition.py  # MetricDefinition + BatchMetricRelation（动态指标配置）
│   ├── chat.py          #   ChatSession + ChatMessage（会话级聊天历史）
│   └── password_reset_code.py  # PasswordResetCode（SHA-256 哈希验证码，含重试计数与使用标记）
├── schemas/             # Pydantic 请求/响应模型
├── api/
│   ├── dependencies.py  # get_current_user、get_current_admin_user（JWT 解码 + 黑名单校验）
│   └── v1/
│       ├── auth.py      #   注册、登录（双 Token + Cookie）、刷新、忘记密码
│       ├── files.py     #   上传（MD5 去重、指标绑定、Celery 分发）
│       ├── batches.py   #   批次列表、批次详情（含指标对比矩阵）
│       ├── chat.py      #   SSE 流式聊天（支持绑定报告或通用模式）
│       ├── admin.py     #   用户列表、启停状态、审计报告
│       ├── metrics.py   #   自定义指标定义的增删改查
│       └── visualization.py  # 趋势图（折线）和对比图（柱状）数据
├── tasks/
│   ├── celery_app.py    # Celery 实例（Redis broker/backend，30分钟超时，3次重试）
│   └── pdf_processor.py # process_batch → process_single_report：parse_pdf（PyMuPDF，≤20页）→ extract_metrics_with_ai（DeepSeek-V3，json_object 模式）→ save_metrics（EAV 写入）
└── utils/
    ├── auth.py          # JWT 签发/校验（access 15分钟，refresh 7天），bcrypt 哈希/验证
    ├── email.py         # SMTP 邮件发送（沙盒模式下写入本地 HTML 文件）
    ├── file.py          # 文件保存、MD5 计算
    ├── anomaly_detection.py  # 价格偏离检测（±5% 中位数）和成交量异常检测（200% 均值）
    └── rate_limit.py    # 聊天接口令牌桶限流
```

### 前端（`frontend/src/`）

```
src/
├── main.tsx             # React 入口，BrowserRouter
├── App.tsx              # 路由定义（公开：/login、/register、/forgot-password；需登录：/dashboard、/admin）
├── components/
│   ├── Layout.tsx       # 应用外壳：顶栏、侧边栏、内容区
│   └── ChatWidget.tsx   # 浮动 AI 聊天（SSE 流式，可折叠，固定右下角）
├── pages/
│   ├── Login.tsx        # 登录/注册切换表单
│   ├── ForgotPassword.tsx  # 两步找回密码：发送验证码 → 重置密码
│   ├── Dashboard.tsx    # 主工作区：上传、批次列表、对比矩阵、Excel 导出
│   └── AdminPanel.tsx   # 管理面板：用户管理、审计检查
├── stores/
│   ├── authStore.ts     # Zustand + persist（accessToken 存内存，用户信息存 localStorage）
│   └── chatStore.ts     # 聊天消息历史状态
└── services/
    ├── api.ts           # Axios 实例：baseURL /api/v1，withCredentials，401 拦截器（自动调用 /auth/refresh）
    ├── authService.ts   # 登录、注册、刷新、忘记密码 API
    ├── batchService.ts  # 批次列表/详情 API
    ├── fileService.ts   # 文件上传（multipart/form-data）
    ├── chatService.ts   # SSE 流式连接
    ├── metricService.ts # 自定义指标 CRUD
    └── visualizationService.ts  # 趋势/对比图表数据
```

### 核心架构模式

**双 Token 认证流程：**
1. 登录 → `access_token` 在 JSON body 中返回（存于 Zustand 内存，不落 localStorage）
2. 登录 → `refresh_token` 设为 `httpOnly` Cookie（`Set-Cookie` 响应头）
3. `remember_me=true` → Cookie 设 `Max-Age=604800`（持久化）；`false` → 会话 Cookie
4. Axios 拦截器捕获 401 → 调用 `/auth/refresh`（浏览器自动携带 Cookie）→ 重试原请求
5. JWT 载荷：`{sub: user_id, email, is_admin, type: "access"|"refresh", exp}`

**PDF 处理管道（Celery 异步）：**
1. `POST /api/v1/files/upload` → 校验文件 → 计算 MD5 → 去重检查 → 创建批次和报告行 → 分发 `process_batch` 任务
2. `process_batch(batch_id)` → 逐条待处理报告：`parse_pdf`（PyMuPDF，最多 20 页）→ `extract_metrics_with_ai`（DeepSeek-V3，`response_format: json_object`）→ `save_metrics`（写入 `extracted_metrics` EAV 行）
3. 重试策略：最多 3 次，间隔 10 秒；最终失败 → 状态标记为 `failed`

**EAV 指标存储：**
- `extracted_metrics` 表采用实体-属性-值模式
- `metric_value_num`（DECIMAL）存储可排序/可筛选的数值；`metric_value_raw`（VARCHAR）存储原始文本
- `fiscal_year` 字段作为灵活的时期锚点（可承载日期如 "2026-06-02" 或财年如 "2025"）

**异常检测（看板）：**
- 仅当批次中有 ≥3 份报告共享同一 `stock_code` 时启用
- 价格异常：`highest_price_paid` 或 `lowest_price_paid` 偏离中位数超过 ±5%
- 成交量异常：`shares_repurchased` 或 `total_consideration` 超过其他报告均值的 200%（N-1 分母）

### 数据库

- MySQL 8.0.30，字符集 `utf8mb4_unicode_ci`
- 默认管理员：`admin@deepreader.com` / `Admin@123456`（bcrypt 哈希在启动时自动修复损坏）
- `init_db.py` 负责建表和写入默认数据

### 关键设计决策

- **refresh_token 不单独在响应体中返回**：`/auth/login` 接口同时在 JSON body 和 Cookie 中返回 `refresh_token`。Cookie 是主要传递机制，body 字段仅为向后兼容保留。
- **PDF 页数限制**：`parse_pdf()` 中硬编码最多处理 20 页，超出部分静默丢弃。
- **AI Prompt 为硬编码**：`pdf_processor.py` 中的系统提示词专门针对港股回购报告。尚未实现从 `metric_definitions.prompt_instruction` 动态组装 Prompt。
- **CORS 白名单**：允许 localhost:5173、5174、3000、8080。生产环境需更新。
- **Redis 3.0 兼容性（Windows）**：本项目使用的 Windows Redis 3.0.504 不支持 RESP3 协议（HELLO 命令），因此 `requirements.txt` 锁定 redis-py 5.3.1，配合 `backend/sitecustomize.py` 补丁自动降级为 RESP2。`start-all.ps1` 启动时自动部署该补丁到 venv。若 Celery 日志出现 `unknown command 'HELLO'`，手动执行 `copy backend\sitecustomize.py backend\venv\Lib\site-packages\` 并重启 Celery。
- **Windows 端口策略**：端口被释放后可能有短暂残留期，`start-all.ps1` 启动前自动清理目标端口的僵尸进程。
