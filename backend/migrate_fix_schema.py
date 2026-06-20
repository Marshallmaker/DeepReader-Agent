"""
Database schema migration: fix discrepancies with DDL specification.
Run: cd backend && source venv/Scripts/activate && python migrate_fix_schema.py
"""
import sys
sys.path.insert(0, '.')

from app.database import engine
from sqlalchemy import text

def run():
    with engine.connect() as conn:
        # ==========================================
        # Phase 1: Fix existing NULL data
        # ==========================================
        print("=" * 60)
        print("Phase 1: Fix existing NULL data")
        print("=" * 60)

        # 1.1 users.nickname - set NULL values to defaults
        conn.execute(text(
            "UPDATE users SET nickname = 'system_admin' WHERE id = 1 AND nickname IS NULL"
        ))
        conn.execute(text(
            "UPDATE users SET nickname = 'user' WHERE nickname IS NULL"
        ))
        print("  [OK] users.nickname NULLs filled")

        # 1.2 upload_batches.batch_name
        conn.execute(text(
            "UPDATE upload_batches SET batch_name = CONCAT('batch_', id) WHERE batch_name IS NULL"
        ))
        print("  [OK] upload_batches.batch_name NULLs filled")

        conn.commit()

        # ==========================================
        # Phase 2: Fix column definitions
        # ==========================================
        print()
        print("=" * 60)
        print("Phase 2: Fix column definitions")
        print("=" * 60)

        migrations = [
            # (description, sql, safe_to_fail)
            ("reports.entity_name ADD",
             "ALTER TABLE reports ADD COLUMN entity_name VARCHAR(255) NULL "
             "COMMENT 'entity name filled by AI extracted company_name'",
             True),

            ("reports.raw_markdown -> LONGTEXT",
             "ALTER TABLE reports MODIFY COLUMN raw_markdown LONGTEXT NULL",
             False),

            ("reports.original_filename VARCHAR(255) NOT NULL",
             "ALTER TABLE reports MODIFY COLUMN original_filename VARCHAR(255) NOT NULL",
             False),

            ("reports.stored_path VARCHAR(500) NOT NULL",
             "ALTER TABLE reports MODIFY COLUMN stored_path VARCHAR(500) NOT NULL",
             False),

            ("reports.pdf_md5 VARCHAR(32) NOT NULL",
             "ALTER TABLE reports MODIFY COLUMN pdf_md5 VARCHAR(32) NOT NULL",
             False),

            ("users.nickname VARCHAR(100) NOT NULL",
             "ALTER TABLE users MODIFY COLUMN nickname VARCHAR(100) NOT NULL",
             False),

            ("upload_batches.batch_name VARCHAR(255) NOT NULL",
             "ALTER TABLE upload_batches MODIFY COLUMN batch_name VARCHAR(255) NOT NULL",
             False),

            ("upload_batches.total_files INT DEFAULT 0",
             "ALTER TABLE upload_batches MODIFY COLUMN total_files INT NOT NULL DEFAULT 0",
             False),

            ("upload_batches.processed_files INT DEFAULT 0",
             "ALTER TABLE upload_batches MODIFY COLUMN processed_files INT NOT NULL DEFAULT 0",
             False),

            ("users.is_admin TINYINT(1) DEFAULT 0",
             "ALTER TABLE users MODIFY COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0",
             False),

            ("users.is_active TINYINT(1) DEFAULT 1",
             "ALTER TABLE users MODIFY COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1",
             False),

            ("chat_sessions.is_active TINYINT(1) DEFAULT 1",
             "ALTER TABLE chat_sessions MODIFY COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1",
             False),

            ("password_reset_codes.retry_count INT DEFAULT 0",
             "ALTER TABLE password_reset_codes MODIFY COLUMN retry_count INT NOT NULL DEFAULT 0",
             False),

            ("password_reset_codes.is_used TINYINT(1) DEFAULT 0",
             "ALTER TABLE password_reset_codes MODIFY COLUMN is_used TINYINT(1) NOT NULL DEFAULT 0",
             False),

            ("metric_definitions.is_system TINYINT(1) NOT NULL DEFAULT 0",
             "ALTER TABLE metric_definitions MODIFY COLUMN is_system TINYINT(1) NOT NULL DEFAULT 0",
             False),

            ("extracted_metrics.confidence FLOAT DEFAULT 1.0",
             "ALTER TABLE extracted_metrics MODIFY COLUMN confidence FLOAT NOT NULL DEFAULT 1.0",
             False),
        ]

        for desc, sql, safe in migrations:
            try:
                conn.execute(text(sql))
                print("  [OK] %s" % desc)
            except Exception as e:
                if safe and 'Duplicate column' in str(e):
                    print("  [SKIP] %s (already exists)" % desc)
                else:
                    print("  [ERR] %s: %s" % (desc, e))

        conn.commit()

        # ==========================================
        # Phase 3: Add ON UPDATE CURRENT_TIMESTAMP
        # ==========================================
        print()
        print("=" * 60)
        print("Phase 3: Add ON UPDATE CURRENT_TIMESTAMP")
        print("=" * 60)

        on_update_tables = [
            'metric_definitions',
            'upload_batches',
            'reports',
            'chat_sessions',
        ]

        for table in on_update_tables:
            try:
                conn.execute(text(
                    "ALTER TABLE %s MODIFY COLUMN updated_at DATETIME NULL "
                    "DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP" % table
                ))
                print("  [OK] %s.updated_at ON UPDATE CURRENT_TIMESTAMP" % table)
            except Exception as e:
                print("  [ERR] %s.updated_at: %s" % (table, e))

        # Fix extracted_metrics.updated_at: remove DEFAULT CURRENT_TIMESTAMP, keep ON UPDATE
        try:
            conn.execute(text(
                "ALTER TABLE extracted_metrics MODIFY COLUMN updated_at DATETIME NULL "
                "DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP"
            ))
            print("  [OK] extracted_metrics.updated_at (match DDL)")
        except Exception as e:
            print("  [ERR] extracted_metrics.updated_at: %s" % e)

        conn.commit()

        print()
        print("=" * 60)
        print("Migration complete!")
        print("=" * 60)


if __name__ == "__main__":
    run()
