"""
Rate limiting utilities for API endpoints.

限流引擎已迁移至 Redis（支持分布式部署的滑动窗口计数器），
Redis 不可用时自动降级为内存滑动窗口兜底。
"""
import time
import logging
from typing import Dict, Tuple
from collections import defaultdict
from fastapi import HTTPException, status
from redis.exceptions import RedisError
from app.config import settings
from app.utils.redis_client import get_redis

logger = logging.getLogger(__name__)


class RateLimiter:
    """
    混合限流引擎：Redis 优先，内存兜底。

    使用 Redis 有序集合（Sorted Set）实现分布式滑动窗口算法，
    每个请求作为 member，score 为时间戳。窗口外旧记录自动清理。
    """

    def __init__(self):
        self._requests: Dict[str, list] = defaultdict(list)

    # ── Redis 路径 ──────────────────────────────────────────

    def _redis_is_allowed(self, key: str, max_requests: int, window_seconds: int) -> Tuple[bool, int]:
        try:
            r = get_redis()
            redis_key = f"ratelimit:chat:{key}"
            now = time.time()
            window_start = now - window_seconds

            with r.pipeline() as pipe:
                # 清理窗口外旧记录
                pipe.zremrangebyscore(redis_key, 0, window_start)
                # 统计窗口内请求数
                pipe.zcard(redis_key)
                _, count = pipe.execute()

            if count >= max_requests:
                return False, 0

            # 记录本次请求
            r.zadd(redis_key, {str(now): now})
            r.expire(redis_key, window_seconds + 10)

            remaining = max_requests - count - 1
            return True, remaining
        except (RedisError, OSError) as e:
            logger.warning(f"Redis 限流查询失败，降级为内存模式: {e}")
            raise  # 抛出异常让调用方 fallback

    # ── 内存兜底路径 ──────────────────────────────────────

    def _memory_is_allowed(self, key: str, max_requests: int, window_seconds: int) -> Tuple[bool, int]:
        current_time = time.time()
        window_start = current_time - window_seconds

        self._requests[key] = [
            ts for ts in self._requests[key] if ts > window_start
        ]

        if len(self._requests[key]) >= max_requests:
            return False, 0

        self._requests[key].append(current_time)
        remaining = max_requests - len(self._requests[key])
        return True, remaining

    # ── 统一入口 ──────────────────────────────────────────

    def is_allowed(self, key: str, max_requests: int, window_seconds: int) -> Tuple[bool, int]:
        """
        检查请求是否在限流窗口内允许。

        参数:
            key: 唯一标识（如 user_id 或 IP）
            max_requests: 窗口内最大允许请求数
            window_seconds: 时间窗口长度（秒）

        返回:
            (is_allowed, remaining_requests)
        """
        try:
            return self._redis_is_allowed(key, max_requests, window_seconds)
        except (RedisError, OSError):
            return self._memory_is_allowed(key, max_requests, window_seconds)

    def check_rate_limit(self, key: str) -> None:
        """
        检查当前 key 的聊天限流状态，超限则抛出 429。

        参数:
            key: 唯一标识

        异常:
            HTTPException 429: 超出频率限制
        """
        allowed, remaining = self.is_allowed(
            key,
            settings.CHAT_RATE_LIMIT,
            settings.CHAT_RATE_WINDOW,
        )
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="请求过于频繁，请稍后再试。",
            )


rate_limiter = RateLimiter()