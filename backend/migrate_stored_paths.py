"""
数据库迁移脚本：将 reports 表中的绝对路径 stored_path 转为相对路径。

背景：旧版代码将文件绝对路径（如 E:\\CC_T\\backend\\uploads\\1\\abc.pdf）
写入数据库，导致项目目录移动或重新部署后文件"丢失"。
新版代码统一使用相对路径（如 1/abc.pdf），读取时基于 UPLOAD_DIR 拼接。

运行方式：cd backend && python migrate_stored_paths.py
"""
import sys
from pathlib import Path
from app.database import SessionLocal
from app.models.report import Report
from app.config import settings


def migrate():
    db = SessionLocal()
    try:
        reports = db.query(Report).all()

        if not reports:
            print("[INFO] 没有任何报告记录，无需迁移。")
            return

        upload_dir = Path(settings.UPLOAD_DIR).resolve()
        print(f"[INFO] UPLOAD_DIR 解析为: {upload_dir}")
        print(f"[INFO] 共 {len(reports)} 条报告记录\n")

        migrated = 0
        skipped = 0

        for report in reports:
            stored = Path(report.stored_path)

            if stored.is_absolute():
                # 尝试将绝对路径转为相对于 UPLOAD_DIR 的路径
                try:
                    relative = stored.relative_to(upload_dir)
                    # 统一使用正斜杠（跨平台兼容）
                    report.stored_path = relative.as_posix()
                    migrated += 1
                    print(f"  [OK] #{report.id}: -> {report.stored_path}")
                except ValueError:
                    # 路径不在 UPLOAD_DIR 下（可能是旧数据异常），保留原样
                    print(f"  [WARN] #{report.id}: 路径不在 UPLOAD_DIR 下，保留原值: {stored}")
                    skipped += 1
            else:
                print(f"  [SKIP] #{report.id}: 已是相对路径，跳过")
                skipped += 1

        if migrated > 0:
            db.commit()
            print(f"\n[DONE] 迁移完成: {migrated} 条记录已转换为相对路径, {skipped} 条跳过")
        else:
            print(f"\n[DONE] 无需迁移: 所有 {skipped} 条记录已是相对路径")

    except Exception as e:
        db.rollback()
        print(f"\n[ERROR] 迁移失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    migrate()
