"""
数据库表结构修复脚本。
"""
import pymysql

# 连接数据库
conn = pymysql.connect(
    host='localhost',
    user='root',
    password='123456',
    database='deepreader_db',
    charset='utf8mb4'
)
cursor = conn.cursor()

print("=" * 50)
print("检查并修复数据库表结构")
print("=" * 50)

# 1. 检查 reports 表结构
print("\n[1] 检查 reports 表...")
cursor.execute("DESCRIBE reports")
columns = {row[0]: row[1] for row in cursor.fetchall()}
print(f"当前字段: {list(columns.keys())}")

# 修复字段名
if 'file_md5' in columns and 'pdf_md5' not in columns:
    print("  -> 重命名 file_md5 为 pdf_md5")
    cursor.execute("ALTER TABLE reports CHANGE COLUMN file_md5 pdf_md5 VARCHAR(32)")
    conn.commit()
    print("  -> 完成")

# 2. 检查 users 表结构
print("\n[2] 检查 users 表...")
cursor.execute("DESCRIBE users")
columns = {row[0]: row[1] for row in cursor.fetchall()}
print(f"当前字段: {list(columns.keys())}")

# 修复 nickname 约束
if 'nickname' in columns and 'YES' in str(columns.get('nickname')):
    print("  -> 修改 nickname 为 NOT NULL")
    cursor.execute("ALTER TABLE users MODIFY COLUMN nickname VARCHAR(100) NOT NULL")
    conn.commit()
    print("  -> 完成")

# 3. 检查 metric_definitions 表结构
print("\n[3] 检查 metric_definitions 表...")
cursor.execute("DESCRIBE metric_definitions")
columns = {row[0]: row[1] for row in cursor.fetchall()}
print(f"当前字段: {list(columns.keys())}")

# 检查唯一约束
cursor.execute("SHOW INDEX FROM metric_definitions WHERE Key_name = 'uidx_user_key'")
if not cursor.fetchall():
    print("  -> 添加唯一约束 uidx_user_key")
    cursor.execute("CREATE UNIQUE INDEX uidx_user_key ON metric_definitions(user_id, metric_key)")
    conn.commit()
    print("  -> 完成")
else:
    print("  -> 唯一约束已存在")

# 4. 检查 upload_batches 表结构
print("\n[4] 检查 upload_batches 表...")
cursor.execute("DESCRIBE upload_batches")
columns = {row[0]: row[1] for row in cursor.fetchall()}
print(f"当前字段: {list(columns.keys())}")

# 检查 batch_name 约束
if 'batch_name' in columns and 'YES' in str(columns.get('batch_name')):
    print("  -> 修改 batch_name 为 NOT NULL")
    cursor.execute("ALTER TABLE upload_batches MODIFY COLUMN batch_name VARCHAR(255) NOT NULL")
    conn.commit()
    print("  -> 完成")

# 检查索引
cursor.execute("SHOW INDEX FROM upload_batches WHERE Key_name = 'idx_user_batches'")
if not cursor.fetchall():
    print("  -> 添加索引 idx_user_batches")
    cursor.execute("CREATE INDEX idx_user_batches ON upload_batches(user_id)")
    conn.commit()
    print("  -> 完成")
else:
    print("  -> 索引已存在")

# 5. 检查 batch_metric_relations 表结构
print("\n[5] 检查 batch_metric_relations 表...")
cursor.execute("SHOW INDEX FROM batch_metric_relations WHERE Key_name = 'uidx_batch_metric'")
if not cursor.fetchall():
    print("  -> 添加唯一约束 uidx_batch_metric")
    cursor.execute("CREATE UNIQUE INDEX uidx_batch_metric ON batch_metric_relations(batch_id, metric_def_id)")
    conn.commit()
    print("  -> 完成")
else:
    print("  -> 唯一约束已存在")

# 6. 检查 extracted_metrics 表结构
print("\n[6] 检查 extracted_metrics 表...")
cursor.execute("DESCRIBE extracted_metrics")
columns = {row[0]: row[1] for row in cursor.fetchall()}
print(f"当前字段: {list(columns.keys())}")

# 7. 检查 chat_messages 表结构
print("\n[7] 检查 chat_messages 表...")
cursor.execute("DESCRIBE chat_messages")
columns = {row[0]: row[1] for row in cursor.fetchall()}
print(f"当前字段: {list(columns.keys())}")

# 添加 model_used 字段
if 'model_used' not in columns:
    print("  -> 添加字段 model_used")
    cursor.execute("ALTER TABLE chat_messages ADD COLUMN model_used VARCHAR(50) DEFAULT 'deepseek-ai/DeepSeek-V3' AFTER content")
    conn.commit()
    print("  -> 完成")

print("\n" + "=" * 50)
print("数据库表结构修复完成！")
print("=" * 50)

conn.close()
