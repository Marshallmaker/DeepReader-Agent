"""
Application configuration module.
Loads environment variables and provides configuration settings.
"""
import os
import logging
from pathlib import Path
from pydantic import field_validator
from pydantic_settings import BaseSettings
from functools import lru_cache

logger = logging.getLogger(__name__)

# 不安全的默认密钥，用于启动时检测
_INSECURE_DEFAULTS = {
    "your-secret-key-change-in-production",
    "your-secret-key-change-in-production-2024",
    "change-me",
    "secret",
}


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Database
    DATABASE_URL: str = "mysql+pymysql://root:password@localhost:3306/deepreader"

    # JWT
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # SiliconFlow API
    SILICONFLOW_API_KEY: str = ""
    SILICONFLOW_API_BASE: str = "https://api.siliconflow.cn/v1"
    SILICONFLOW_MODEL: str = "deepseek-ai/DeepSeek-V3"

    # File Upload
    MAX_UPLOAD_FILES: int = 10
    MAX_FILE_SIZE_MB: int = 20
    UPLOAD_DIR: str = "uploads"

    # Rate Limiting
    CHAT_RATE_LIMIT: int = 10
    CHAT_RATE_WINDOW: int = 60

    # Email Settings
    SMTP_SERVER: str = "smtp.qq.com"
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_SENDER_NAME: str = "DeepReader"
    MAIL_SANDBOX_MODE: bool = True

    # Debug Mode
    DEBUG: bool = True

    @field_validator("SECRET_KEY")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        """拒绝使用不安全的默认密钥启动。"""
        if v.lower() in _INSECURE_DEFAULTS:
            logger.warning(
                "⚠️  SECRET_KEY 仍为不安全默认值，请通过环境变量或 .env 设置强密钥"
            )
        if len(v) < 32:
            logger.warning(
                "⚠️  SECRET_KEY 长度不足 32 字符，建议使用 openssl rand -hex 32 生成"
            )
        return v

    class Config:
        env_file = ".env"
        case_sensitive = True
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


# Create upload directory if not exists
def ensure_upload_dir():
    """Ensure upload directory exists."""
    settings = get_settings()
    upload_path = Path(settings.UPLOAD_DIR).resolve()
    upload_path.mkdir(parents=True, exist_ok=True)
    return upload_path


settings = get_settings()