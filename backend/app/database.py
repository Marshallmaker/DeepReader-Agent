"""
数据库连接和会话管理。
"""
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.config import settings

# 创建数据库引擎
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=3600,
    echo=False
)

# 创建会话工厂
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 创建模型基类
Base = declarative_base()


def get_db():
    """
    获取数据库会话的依赖函数。
    确保请求结束后关闭会话。
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """
    初始化数据库表。
    导入所有模型并创建表结构。
    """
    from app.models import (
        user, batch, report, metric, 
        metric_definition, chat, password_reset_code
    )  # noqa: F401
    Base.metadata.create_all(bind=engine)