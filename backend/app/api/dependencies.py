"""
API dependencies for authentication and authorization.

Token 黑名单已迁移至 Redis（支持持久化与分布式部署），
Redis 不可用时自动降级为内存 Set 兜底，确保单机场景仍可运行。
所有错误提示已汉化。
"""
import logging
from typing import Optional
from fastapi import Depends, HTTPException, status, Cookie, Header
from sqlalchemy.orm import Session
from jose import jwt, JWTError
from app.config import settings
from app.database import get_db
from app.models.user import User
from app.utils.redis_client import (
    add_token_to_blacklist as _redis_blacklist_add,
    is_token_blacklisted as _redis_blacklist_check,
    is_redis_available,
)

logger = logging.getLogger(__name__)

# 内存兜底黑名单（Redis 不可用时启用）
_fallback_blacklist: set[str] = set()


def get_token_from_cookie_or_header(
    access_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None)
) -> Optional[str]:
    """Extract JWT token from cookie or Authorization header."""
    if access_token:
        return access_token

    if authorization and authorization.startswith("Bearer "):
        return authorization[7:]

    return None


async def get_current_user(
    token: Optional[str] = Depends(get_token_from_cookie_or_header),
    db: Session = Depends(get_db)
) -> User:
    """
    Get the current authenticated user from JWT token.

    Raises:
        HTTPException: If token is invalid or user not found
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无法验证凭证",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if not token:
        raise credentials_exception

    # 检查 token 是否已列入黑名单（Redis 优先，内存兜底）
    if _redis_blacklist_check(token) or token in _fallback_blacklist:
        raise credentials_exception

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])

        user_id: str = payload.get("sub")
        token_type: str = payload.get("type")

        if user_id is None:
            raise credentials_exception

        if token_type != "access":
            raise credentials_exception

    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.id == int(user_id)).first()

    if user is None:
        raise credentials_exception

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="用户账号已被禁用"
        )

    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """Get current active user."""
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="用户未激活"
        )
    return current_user


async def get_current_admin_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """Get current admin user."""
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限"
        )
    return current_user


def add_to_blacklist(token: str, ttl_seconds: int = 900) -> None:
    """
    将 token 加入黑名单。

    Redis 正常时写入 Redis（支持自动过期和分布式共享）；
    Redis 不可用时降级写入内存 Set（单机兜底）。

    参数:
        token: JWT access_token 原始字符串
        ttl_seconds: 黑名单存活时间（秒），默认 15 分钟（与 access_token 有效期一致）
    """
    if is_redis_available():
        _redis_blacklist_add(token, ttl_seconds)
    else:
        _fallback_blacklist.add(token)
        logger.warning("Redis 不可用，token 黑名单降级为内存存储（重启后丢失）")


def clear_blacklist() -> None:
    """清空黑名单（仅清理内存兜底列表；Redis 中的 key 由 TTL 自动过期）。"""
    _fallback_blacklist.clear()
