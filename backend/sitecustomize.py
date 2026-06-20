"""
sitecustomize — 在所有用户代码之前由 Python 解释器自动执行。

部署方式：
  - 由 start-all.ps1 在启动后端前自动复制到 venv/Lib/site-packages/sitecustomize.py
  - 也可手动复制：copy backend\sitecustomize.py backend\venv\Lib\site-packages\

作用：
  Windows 版 Redis 3.0.504 不支持 HELLO 命令（RESP3 协议协商）。
  redis-py >= 4.0 连接时默认发送 HELLO 3，导致 Redis 返回 "unknown command 'HELLO'"。
  此补丁拦截所有 redis.Redis() 调用，强制注入 protocol=2（RESP2），
  确保 Celery 及其他组件能正常连接 Redis。
"""
import redis as _redis_module

_OriginalRedis = _redis_module.Redis


class _RedisRESP2(_OriginalRedis):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault("protocol", 2)
        super().__init__(*args, **kwargs)


_redis_module.Redis = _RedisRESP2
