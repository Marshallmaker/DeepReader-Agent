"""
清理数据库中的指标数据，确保符合项目需求文档。
保留8项系统预置的港股指标，删除测试指标和重复记录。
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

print("=" * 60)
print("清理指标数据 - 确保符合项目需求文档")
print("=" * 60)

# 1. 删除所有非系统预置的指标
print("\n[1] 删除测试指标和重复记录...")

# 系统预置的8项指标
system_metrics = {
    'company_name': '公司名称',
    'stock_code': '证券代号',
    'submission_date': '呈交日期',
    'repurchase_date': '交易日',
    'shares_repurchased': '购回股份数目',
    'highest_price_paid': '每股最高购回价',
    'lowest_price_paid': '每股最低购回价',
    'total_consideration': '付出价格总额'
}

# 删除非系统预置的指标
cursor.execute("DELETE FROM metric_definitions WHERE metric_key NOT IN %s", 
              (tuple(system_metrics.keys()),))
deleted_count = cursor.rowcount
print(f"  -> 删除了 {deleted_count} 个非系统预置指标")

# 2. 确保每个系统指标只有一条记录
print("\n[2] 处理重复的系统指标...")
for metric_key, metric_label in system_metrics.items():
    # 获取该指标的所有记录
    cursor.execute("SELECT id FROM metric_definitions WHERE metric_key = %s ORDER BY id", (metric_key,))
    records = cursor.fetchall()
    
    if len(records) > 1:
        # 保留第一条，删除其余的
        keep_id = records[0][0]
        delete_ids = [str(r[0]) for r in records[1:]]
        cursor.execute(f"DELETE FROM metric_definitions WHERE id IN ({','.join(delete_ids)})")
        print(f"  -> {metric_key}: 保留ID={keep_id}，删除了 {len(delete_ids)} 条重复记录")

# 3. 更新系统指标的显示名称为正确的中文
print("\n[3] 更新系统指标的显示名称...")
for metric_key, metric_label in system_metrics.items():
    cursor.execute("""
        UPDATE metric_definitions 
        SET metric_label = %s, is_system = true 
        WHERE metric_key = %s
    """, (metric_label, metric_key))
    print(f"  -> {metric_key} -> {metric_label}")

# 4. 更新系统指标的prompt_instruction
print("\n[4] 更新系统指标的提取提示...")
prompt_instructions = {
    'company_name': '提取文件中的公司名称',
    'stock_code': '提取5位港股证券代码，不足5位前面补0',
    'submission_date': '提取呈交日期，格式YYYY-MM-DD',
    'repurchase_date': '提取交易日日期，格式YYYY-MM-DD',
    'shares_repurchased': '提取购回股份数目，纯数字',
    'highest_price_paid': '提取每股最高购回价，纯数字',
    'lowest_price_paid': '提取每股最低购回价，纯数字',
    'total_consideration': '提取付出价格总额，纯数字'
}

for metric_key, instruction in prompt_instructions.items():
    cursor.execute("""
        UPDATE metric_definitions 
        SET prompt_instruction = %s 
        WHERE metric_key = %s
    """, (instruction, metric_key))
    print(f"  -> {metric_key}: 设置提取提示")

conn.commit()

# 5. 验证结果
print("\n[5] 验证结果...")
cursor.execute("SELECT metric_key, metric_label, is_system FROM metric_definitions ORDER BY id")
results = cursor.fetchall()
print(f"  -> 当前系统指标数量: {len(results)}")
print("  -> 指标列表:")
for row in results:
    print(f"     - {row[0]}: {row[1]} (系统预置: {row[2]})")

print("\n" + "=" * 60)
print("指标数据清理完成！")
print("=" * 60)

conn.close()
