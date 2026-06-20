"""
API v1 路由聚合。
包含所有 API 接口的路由注册。
"""
from fastapi import APIRouter
from app.api.v1 import auth, files, batches, chat, admin, metrics, visualization

api_router = APIRouter()

# 注册所有 v1 路由
api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api_router.include_router(files.router, prefix="/files", tags=["Files"])
api_router.include_router(batches.router, prefix="/batches", tags=["Batches"])
api_router.include_router(chat.router, prefix="/chat", tags=["AI Chat"])
api_router.include_router(admin.router, prefix="/admin", tags=["Admin"])
api_router.include_router(metrics.router, prefix="/metrics", tags=["Metrics"])
api_router.include_router(visualization.router, prefix="/visualization", tags=["Visualization"])