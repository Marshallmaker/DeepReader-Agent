"""
extracted_metrics 表重构脚本 - 将硬编码字段结构重构为 EAV 结构
"""
import pymysql
import json

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
print("重构 extracted_metrics 表为 EAV 结构")
print("=" * 50)

# 1. 读取所有旧数据
print("\n[1] 读取现有数据...")
cursor.execute("SELECT * FROM extracted_metrics")
old_data = cursor.fetchall()
print(f"  -> 找到 {len(old_data)} 条记录")

# 2. 创建临时表保存旧数据
print("\n[2] 创建临时表保存旧数据...")
cursor.execute("CREATE TABLE IF NOT EXISTS extracted_metrics_backup LIKE extracted_metrics")
cursor.execute("INSERT INTO extracted_metrics_backup SELECT * FROM extracted_metrics")
conn.commit()
print("  -> 完成")

# 3. 获取旧表的列信息
print("\n[3] 获取旧表结构...")
cursor.execute("DESCRIBE extracted_metrics")
old_columns = [row[0] for row in cursor.fetchall()]
print(f"  -> 旧字段: {old_columns}")

# 4. 删除旧表
print("\n[4] 删除旧表...")
cursor.execute("DROP TABLE IF EXISTS extracted_metrics")
conn.commit()
print("  -> 完成")

# 5. 创建新的 EAV 结构表
print("\n[5] 创建新的 EAV 结构表...")
cursor.execute("""
CREATE TABLE extracted_metrics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    report_id INT NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    metric_display_name VARCHAR(100) NOT NULL,
    metric_value_num DECIMAL(18, 4) NULL,
    metric_value_raw VARCHAR(500) NULL,
    fiscal_year VARCHAR(20) NULL,
    unit VARCHAR(50) NULL,
    confidence FLOAT DEFAULT 1.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_report_metric (report_id),
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
""")
conn.commit()
print("  -> 完成")

# 6. 数据迁移
print("\n[6] 迁移数据到新结构...")
# 港股预置指标映射（metric_name -> metric_display_name）
metric_mapping = {
    "company_name": "公司名称",
    "stock_code": "证券代号",
    "submission_date": "呈交日期",
    "repurchase_date": "交易日",
    "shares_repurchased": "购回股份数目",
    "highest_price_paid": "每股最高购回价",
    "lowest_price_paid": "每股最低购回价",
    "total_consideration": "付出价格总额"
}

# 字段映射（旧的字段名 -> metric_name）
field_mapping = {
    "company_name": ("company_name", "VARCHAR(100)"),
    "stock_code": ("stock_code", "VARCHAR(100)"),
    "submission_date": ("submission_date", "DATE"),
    "repurchase_date": ("repurchase_date", "DATE"),
    "shares_repurchased_num": ("shares_repurchased", "DECIMAL(18,4)"),
    "highest_price_paid_num": ("highest_price_paid", "DECIMAL(18,4)"),
    "lowest_price_paid_num": ("lowest_price_paid", "DECIMAL(18,4)"),
    "total_consideration_num": ("total_consideration", "DECIMAL(18,4)")
}

# 从备份表读取数据
cursor.execute("SELECT * FROM extracted_metrics_backup")
for row in cursor.fetchall():
    # row 的列顺序对应 old_columns
    # old_columns = ['id', 'report_id', 'company_name', 'stock_code', 'submission_date', 
    #                'repurchase_date', 'shares_repurchased_num', 'shares_repurchased_raw', 
    #                'highest_price_paid_num', 'highest_price_paid_raw', 'lowest_price_paid_num', 
    #                'lowest_price_paid_raw', 'total_consideration_num', 'total_consideration_raw', 
    #                'raw_json', 'created_at', 'updated_at']
    
    report_id = row[1]
    created_at = row[15]
    
    # 为每个指标创建新记录
    for metric_name, display_name in metric_mapping.items():
        # 获取对应的值
        if metric_name == "company_name":
            value_raw = row[2]  # company_name
            value_num = None
            fiscal_year = None
        elif metric_name == "stock_code":
            value_raw = row[3]  # stock_code
            value_num = None
            fiscal_year = None
        elif metric_name == "submission_date":
            value_raw = str(row[4]) if row[4] else None  # submission_date
            value_num = None
            fiscal_year = str(row[4]) if row[4] else None
        elif metric_name == "repurchase_date":
            value_raw = str(row[5]) if row[5] else None  # repurchase_date
            value_num = None
            fiscal_year = str(row[5]) if row[5] else None
        elif metric_name == "shares_repurchased":
            value_num = float(row[6]) if row[6] else None  # shares_repurchased_num
            value_raw = str(row[7]) if row[7] else None   # shares_repurchased_raw
        elif metric_name == "highest_price_paid":
            value_num = float(row[8]) if row[8] else None  # highest_price_paid_num
            value_raw = str(row[9]) if row[9] else None   # highest_price_paid_raw
        elif metric_name == "lowest_price_paid":
            value_num = float(row[10]) if row[10] else None  # lowest_price_paid_num
            value_raw = str(row[11]) if row[11] else None   # lowest_price_paid_raw
        elif metric_name == "total_consideration":
            value_num = float(row[12]) if row[12] else None  # total_consideration_num
            value_raw = str(row[13]) if row[13] else None   # total_consideration_raw
        
        # 插入新记录
        if value_raw is not None or value_num is not None:
            cursor.execute("""
                INSERT INTO extracted_metrics 
                (report_id, metric_name, metric_display_name, metric_value_num, metric_value_raw, fiscal_year, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (report_id, metric_name, display_name, value_num, value_raw, fiscal_year, created_at))

conn.commit()
print(f"  -> 迁移了 {len(old_data)} 条记录到新的 EAV 结构")

# 7. 删除备份表
print("\n[7] 删除备份表...")
cursor.execute("DROP TABLE IF EXISTS extracted_metrics_backup")
conn.commit()
print("  -> 完成")

print("\n" + "=" * 50)
print("extracted_metrics 表重构完成！")
print("=" * 50)

conn.close()
