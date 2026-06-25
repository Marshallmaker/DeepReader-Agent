"""
Celery application configuration.
"""
from celery import Celery
from app.config import settings

# Create Celery app
celery_app = Celery(
    "deepreader",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.tasks.pdf_processor"]
)

# Celery configuration
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=30 * 60,  # 30 minutes max per task
    task_soft_time_limit=25 * 60,  # 25 minutes soft limit
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=50,
    # Concurrency & rate limiting
    worker_concurrency=4,          # 4 个并发 worker，平衡 API 速率和吞吐
    task_annotations={
        'app.tasks.pdf_processor.process_single_report_task': {
            'rate_limit': '20/m',   # 单报告任务限速 20/min（4 workers × 5 calls/min）
        },
    },
    # Retry settings
    task_default_retry_delay=10,
    task_max_retries=3,
)
