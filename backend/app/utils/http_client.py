"""
共享 HTTP 客户端模块。

提供线程安全的 httpx.Client 和 OpenAI 兼容客户端，
避免每次 AI 调用都重新建立 TCP/TLS 连接。

线程安全策略：
- httpx.Client：使用 threading.local() 为每个线程维护独立实例，
  解决 Celery --pool=threads 并发场景下的连接池损坏问题。
  httpx.Client 官方明确标注不是线程安全的，不可跨线程共享。
- OpenAI 客户端：其内部 httpx 客户端同样不是线程安全的，
  同样使用线程本地存储隔离。
"""
import threading
import httpx
from openai import OpenAI
from app.config import settings

# ── 线程本地 httpx 客户端（用于 pdf_processor.py） ──────────

_local = threading.local()


def get_httpx_client() -> httpx.Client:
    """
    获取当前线程专属的 httpx 客户端，线程安全。

    每个 Celery 线程持有独立的连接池，避免跨线程连接损坏。
    首次调用时自动初始化，后续调用复用同一实例。
    """
    client = getattr(_local, 'client', None)
    if client is None:
        client = httpx.Client(
            timeout=httpx.Timeout(120.0),
            limits=httpx.Limits(
                max_keepalive_connections=5,
                max_connections=10,
            ),
        )
        _local.client = client
    return client


# ── 线程本地 OpenAI 兼容客户端（用于 ai_metric_recommender.py） ──


def get_openai_client() -> OpenAI:
    """
    获取当前线程专属的 OpenAI 兼容客户端，线程安全。

    OpenAI SDK 内部使用 httpx，同样不是线程安全的，
    因此每个线程必须持有独立实例。
    """
    client = getattr(_local, 'openai_client', None)
    if client is None:
        client = OpenAI(
            api_key=settings.SILICONFLOW_API_KEY,
            base_url=settings.SILICONFLOW_API_BASE,
            timeout=60.0,
            max_retries=1,
        )
        _local.openai_client = client
    return client
