#!/usr/bin/env python
"""
数据库初始化脚本。
创建数据库、初始化表、预置系统默认数据。
"""
import sys
import os

# 添加 backend 到路径
sys.path.append(os.path.join(os.path.dirname(__file__)))

from sqlalchemy import create_engine
from sqlalchemy_utils import database_exists, create_database
from app.config import settings
from app.database import Base, init_db
from app.models.user import User
from app.models.metric_definition import MetricDefinition, ExpectedType
from app.database import SessionLocal
from app.utils.auth import get_password_hash


def create_database_if_not_exists():
    """创建数据库（如果不存在）"""
    # 从 URL 中移除数据库名称以连接到 MySQL 服务器
    parts = settings.DATABASE_URL.split('/')
    if len(parts) >= 4:
        server_url = '/'.join(parts[:3]) + '/sys'
    else:
        server_url = settings.DATABASE_URL
    
    # 首先尝试直接连接到数据库
    try:
        engine = create_engine(settings.DATABASE_URL)
        if not database_exists(engine.url):
            print(f"正在创建数据库: {settings.DATABASE_URL}")
            create_database(engine.url)
        else:
            print(f"数据库已存在: {settings.DATABASE_URL}")
        return True
    except Exception as e:
        print(f"连接数据库时出错: {e}")
        return False


def create_admin_user():
    """创建默认管理员用户（如果不存在）"""
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.email == "admin@deepreader.com").first()
        if not admin:
            print("正在创建默认管理员用户...")
            # 使用需求文档中指定的密码：Admin@123456
            admin = User(
                email="admin@deepreader.com",
                password_hash=get_password_hash("Admin@123456"),
                nickname="系统管理员",
                is_admin=True,
                is_active=True
            )
            db.add(admin)
            db.commit()
            print("管理员用户创建成功")
        else:
            print("管理员用户已存在")
        return admin
    finally:
        db.close()


def create_system_metric_definitions():
    """
    创建系统预置指标定义。
    为管理员用户（user_id=1）预置8项港股常用指标，作为新用户首次使用时的默认兜底选项。
    """
    db = SessionLocal()
    try:
        # 检查是否已存在系统预置指标
        existing_metrics = db.query(MetricDefinition).filter(
            MetricDefinition.is_system == True
        ).count()
        
        if existing_metrics > 0:
            print("系统预置指标已存在")
            return
        
        print("正在创建系统预置指标...")
        
        # 港股预置核心指标（根据需求文档定义）
        system_metrics = [
            {
                "metric_key": "company_name",
                "metric_label": "公司名称",
                "expected_type": ExpectedType.TEXT,
                "prompt_instruction": "提取报告顶部的公司名称",
                "is_system": True
            },
            {
                "metric_key": "stock_code",
                "metric_label": "证券代号",
                "expected_type": ExpectedType.TEXT,
                "prompt_instruction": "提取标准的5位主板港股代号字符串（不足5位的前面强制补0）",
                "is_system": True
            },
            {
                "metric_key": "submission_date",
                "metric_label": "呈交日期",
                "expected_type": ExpectedType.TEXT,
                "prompt_instruction": "提取呈交日期，统一规整为YYYY-MM-DD格式",
                "is_system": True
            },
            {
                "metric_key": "repurchase_date",
                "metric_label": "交易日",
                "expected_type": ExpectedType.TEXT,
                "prompt_instruction": "从第二章節購回報告表格中提取交易日，统一规整为YYYY-MM-DD格式",
                "is_system": True
            },
            {
                "metric_key": "shares_repurchased",
                "metric_label": "购回股份数目",
                "expected_type": ExpectedType.NUMERIC,
                "prompt_instruction": "从第二章節購回報告表格中提取购回股份数目，剔除所有非数字文本",
                "is_system": True
            },
            {
                "metric_key": "highest_price_paid",
                "metric_label": "每股最高购回价",
                "expected_type": ExpectedType.NUMERIC,
                "prompt_instruction": "从第二章節購回報告表格中提取每股最高购回价，剔除货币符号和千分位符",
                "is_system": True
            },
            {
                "metric_key": "lowest_price_paid",
                "metric_label": "每股最低购回价",
                "expected_type": ExpectedType.NUMERIC,
                "prompt_instruction": "从第二章節購回報告表格中提取每股最低购回价，剔除货币符号和千分位符",
                "is_system": True
            },
            {
                "metric_key": "total_consideration",
                "metric_label": "付出价格总额",
                "expected_type": ExpectedType.NUMERIC,
                "prompt_instruction": "从第二章節購回報告表格中提取付出的价格总额，剔除货币符号和千分位符",
                "is_system": True
            }
        ]
        
        # 获取管理员用户 ID
        admin = db.query(User).filter(User.email == "admin@deepreader.com").first()
        if not admin:
            print("警告：管理员用户不存在，无法创建系统预置指标")
            return
        
        # 创建指标定义
        for metric_data in system_metrics:
            metric = MetricDefinition(
                user_id=admin.id,
                metric_key=metric_data["metric_key"],
                metric_label=metric_data["metric_label"],
                expected_type=metric_data["expected_type"],
                prompt_instruction=metric_data["prompt_instruction"],
                is_system=metric_data["is_system"]
            )
            db.add(metric)
        
        db.commit()
        print(f"系统预置指标创建成功，共 {len(system_metrics)} 项")
        
    except Exception as e:
        print(f"创建系统预置指标时出错: {e}")
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    print("=" * 60)
    print("DeepReader Agent 数据库初始化")
    print("=" * 60)
    
    # 创建数据库
    if create_database_if_not_exists():
        # 初始化表
        print("正在初始化数据库表...")
        init_db()
        
        # 创建管理员用户
        create_admin_user()
        
        # 创建系统预置指标
        create_system_metric_definitions()
        
        print("=" * 60)
        print("数据库初始化完成！")
        print("=" * 60)
        print("\n测试账号信息：")
        print("  - 管理员邮箱: admin@deepreader.com")
        print("  - 管理员密码: Admin@123456")
        print("\n系统预置指标已创建，共8项港股常用指标")
    else:
        print("创建数据库失败，请检查 MySQL 连接配置")
        sys.exit(1)
