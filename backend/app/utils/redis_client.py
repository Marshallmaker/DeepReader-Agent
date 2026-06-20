"""
Redis 客户端工具模块。
提供统一的 Redis 连接管理和黑名单操作。
"""
import logging
import redis
from redis.exceptions import RedisError
from app.config import settings

logger = logging.getLogger(__name__)

# 全局 Redis 客户端（懒加载）
_redis_client: redis.Redis | None = None


def get_redis() -> redis.Redis:
    """
    获取 Redis 客户端实例（单例模式，自动重连）。

    返回:
        redis.Redis 客户端实例
    """
    global _redis_client

    if _redis_client is not None:
        try:
            _redis_client.ping()
            return _redis_client
        except RedisError:
            logger.warning("Redis 连接已断开，尝试重连...")
            _redis_client = None

    try:
        _redis_client = redis.Redis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_keepalive=True,
            health_check_interval=30,
        )
        _redis_client.ping()
        logger.info(f"Redis 连接成功: {settings.REDIS_URL}")
        return _redis_client
    except RedisError as e:
        logger.error(f"Redis 连接失败: {e}")
        raise


def is_redis_available() -> bool:
    """检查 Redis 是否可用（不抛出异常）。"""
    try:
        get_redis().ping()
        return True
    except (RedisError, OSError):
        return False


# ── Token 黑名单操作 ────────────────────────────────────────────

def add_token_to_blacklist(token: str, ttl_seconds: int = 900) -> bool:
    """
    将 Access Token 加入 Redis 黑名单。

    使用 SETEX 设置自动过期，TTL 与 token 剩余有效期一致，
    过期后 Redis 自动清理，无需手动维护。

    参数:
        token: JWT access_token 原始字符串
        ttl_seconds: 黑名单存活时间（秒），默认 15 分钟

    返回:
        True 表示成功，False 表示 Redis 不可用
    """
    try:
        r = get_redis()
        key = f"blacklist:token:{token}"
        r.setex(key, ttl_seconds, "1")
        return True
    except (RedisError, OSError) as e:
        logger.warning(f"Token 黑名单写入失败 (fallback to in-memory): {e}")
        return False


def is_token_blacklisted(token: str) -> bool:
    """
    检查 Access Token 是否已在 Redis 黑名单中。

    参数:
        token: JWT access_token 原始字符串

    返回:
        True 表示已列入黑名单（应拒绝请求）
    """
    try:
        r = get_redis()
        key = f"blacklist:token:{token}"
        return r.exists(key) > 0
    except (RedisError, OSError) as e:
        logger.warning(f"Token 黑名单查询失败: {e}")
        return False


def remove_token_from_blacklist(token: str) -> bool:
    """从黑名单中移除指定 token（用于管理端手动解禁）。"""
    try:
        r = get_redis()
        key = f"blacklist:token:{token}"
        r.delete(key)
        return True
    except (RedisError, OSError) as e:
        logger.warning(f"Token 黑名单删除失败: {e}")
        return False
