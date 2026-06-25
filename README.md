# DeepReader Agent

AI 驱动的 PDF 研究报告指标提取与对比分析系统。

上传 PDF 研究报告 → 自动提取关键指标 → 可视化对比分析 → AI 智能问答。

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python FastAPI + Celery + Redis |
| 前端 | React 18 + TypeScript + Vite + Ant Design |
| 数据库 | MySQL 8.0 |
| AI | DeepSeek-V3（硅基流动平台） |
| 图表 | Apache ECharts |

## 功能

- PDF 批量上传，MD5 去重检测
- AI 自动提取关键指标（支持自定义指标集）
- 6 种可视化图表（折线图、柱状图、环形图、雷达图、仪表盘、热力图）
- 多报告对比矩阵，异常值自动高亮
- SSE 流式 AI 对话，支持报告绑定问答
- JWT 双令牌认证，邮箱验证码注册

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 20.x LTS
- MySQL 8.0
- Redis（Windows 下建议使用 Redis 3.0）

### 后端

```bash
cd backend

# 创建虚拟环境
python -m venv venv
source venv/Scripts/activate  # Windows Git Bash
# 或 venv\Scripts\activate   # Windows CMD

# 安装依赖
pip install -r requirements.txt

# 配置环境变量（参考 .env.example 创建 .env）
cp .env.example .env

# 初始化数据库
python init_db.py

# 启动 API 服务
uvicorn app.main:app --reload --host 0.0.0.0 --port 8005

# 另开终端，启动 Celery Worker
celery -A app.tasks.celery_app worker --loglevel=info --pool=threads
```

### 前端

```bash
cd frontend

npm install
npm run dev
```

浏览器访问 `http://localhost:5173`。

### 一键启动

```powershell
.\start-all.ps1
```

## 项目结构

```
├── backend/              # FastAPI 后端
│   ├── app/
│   │   ├── api/v1/       #   路由模块（auth/files/batches/chat/admin/metrics/templates/visualization）
│   │   ├── models/       #   ORM 模型
│   │   ├── schemas/      #   Pydantic 请求响应模型
│   │   ├── services/     #   业务服务
│   │   ├── tasks/        #   Celery 异步任务
│   │   └── utils/        #   工具函数
│   ├── init_db.py        #   数据库初始化
│   └── requirements.txt
├── frontend/             # React 前端
│   └── src/
│       ├── components/   #   组件
│       ├── pages/        #   页面
│       ├── hooks/        #   自定义 Hooks
│       ├── services/     #   API 调用
│       ├── stores/       #   状态管理
│       └── utils/        #   工具函数
├── start-all.ps1         # 一键启动脚本
└── .gitignore
```

## 默认管理员

- 邮箱：`15082036178@163.com`
- 密码：`123456Zz@`

首次登录后建议修改。
