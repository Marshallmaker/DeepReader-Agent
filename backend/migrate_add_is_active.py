"""
迁移脚本：为 metric_definitions 表添加 is_active 字段。

用途：
- 管理员可通过 is_active 控制某个系统指标模版是否对所有用户可见
- 被禁用的系统指标不会出现在用户的指标选择列表中
- 默认值为 True（启用），向后兼容

执行方式：
    python migrate_add_is_active.py
"""
from app.database import engine
from sqlalchemy import text


def migrate():
    with engine.connect() as conn:
        # 检查字段是否已存在（幂等迁移）
        result = conn.execute(text("""
            SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'metric_definitions'
              AND COLUMN_NAME = 'is_active'
        """))
        if result.scalar() > 0:
            print("字段 is_active 已存在，跳过迁移。")
            return

        print("正在添加 is_active 字段...")
        conn.execute(text("""
            ALTER TABLE metric_definitions
            ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1
        """))
        conn.commit()
        print("迁移完成：已添加 is_active 字段到 metric_definitions 表。")


if __name__ == "__main__":
    migrate()
