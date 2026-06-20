"""
DeepReader Agent - Main FastAPI Application
"""
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from pathlib import Path
from app.config import settings, ensure_upload_dir
from app.database import init_db
from app.api.v1 import api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    # Startup
    ensure_upload_dir()
    init_db()
    # 输出关键配置（方便调试）
    import logging
    _log = logging.getLogger("startup")
    _log.info(f"SMTP: {settings.SMTP_SERVER}:{settings.SMTP_PORT} "
              f"sandbox={settings.MAIL_SANDBOX_MODE} "
              f"user={settings.SMTP_USERNAME}")
    yield
    # Shutdown
    pass


# Create FastAPI application
app = FastAPI(
    title="DeepReader Agent API",
    description="AI-powered PDF report analysis and comparison platform",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:3000", "http://localhost:8080"],  # Frontend origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Pydantic 验证异常处理器 —— 精简中文提示。"""
    # 提取字段名（忽略 body/query 等前缀，取最后有意义的部分）
    def _field_name(loc: tuple) -> str:
        parts = [p for p in loc if p not in ("body", "query", "path", "header", "cookie")]
        return str(parts[-1]) if parts else str(loc[-1])

    # Pydantic v2 错误消息 → 精简中文（按匹配优先级排序）
    import re
    _MSG_MAP = [
        ("Field required", "必填"),
        ("field required", "必填"),
        ("Input should be a valid integer", "请输入整数"),
        ("Input should be a valid string", "请输入文本"),
        ("Input should be a valid number", "请输入数字"),
        ("Input should be a valid float", "请输入数字"),
        ("Input should be a valid boolean", "请输入是/否"),
        ("Input should be a valid list", "格式错误"),
        ("Input should be a valid email", "邮箱格式错误"),
        ("value is not a valid email address", "邮箱格式错误"),
        ("String should have at least", "字符过短"),
        ("String should have at most", "字符过长"),
        ("unable to parse string as an integer", "无法解析为整数"),
        ("Input should be less than or equal to", "数值过大"),
        ("Input should be greater than or equal to", "数值过小"),
        ("Value error, ", ""),
    ]

    errors = []
    for e in exc.errors():
        field = _field_name(e["loc"])
        msg = e["msg"]
        for en, zh in _MSG_MAP:
            if en in msg:
                msg = zh + msg[len(en):]
                break
        # 剔除尾部英文细节（如 "6 characters"、": An email address..."）
        msg = re.sub(r'\s*\d+\s*characters?\b.*', '', msg)
        msg = re.sub(r'[:\s]*[A-Z][a-z].*$', '', msg)
        msg = msg.rstrip(' ,:;')
        errors.append(f"{field}: {msg}" if msg else field)

    return JSONResponse(
        status_code=422,
        content={"code": 422, "message": "；".join(errors), "details": None}
    )


# Global exception handler
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler for consistent error responses."""
    return JSONResponse(
        status_code=500,
        content={
            "code": 500,
            "message": "服务器内部错误",
            "details": str(exc) if settings.DEBUG else None
        }
    )


# HTTPException handler -统一错误响应格式为项目需求文档规定的格式
async def http_exception_handler(request: Request, exc: HTTPException):
    """HTTPException handler -统一错误响应格式为项目需求文档规定的格式"""
    # 处理 detail 为列表的情况（如 Pydantic 验证错误）
    if isinstance(exc.detail, list):
        message = "; ".join([str(item.get("msg", str(item))) for item in exc.detail])
    elif isinstance(exc.detail, dict):
        message = str(exc.detail.get("message", str(exc.detail)))
    else:
        message = str(exc.detail)
    
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "code": exc.status_code,
            "message": message,
            "details": None
        }
    )


# 注册异常处理器
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(Exception, global_exception_handler)
app.add_exception_handler(HTTPException, http_exception_handler)


# Include API routers
app.include_router(api_router, prefix="/api/v1")

# 挂载 uploads 目录为静态文件服务（用于头像等资源访问）
uploads_path = Path(settings.UPLOAD_DIR)
uploads_path.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_path)), name="uploads")


# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "version": "1.0.0"}


# Root endpoint
@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "DeepReader Agent API",
        "version": "1.0.0",
        "docs": "/docs"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
