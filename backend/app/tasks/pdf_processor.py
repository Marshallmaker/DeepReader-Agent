"""
PDF processing and AI extraction tasks.
支持动态指标系统：从 batch_metric_relations 读取批次绑定的指标定义，
动态组装 AI Prompt 和 JSON Schema，彻底废除硬编码。
"""
import json
import re
import time
import random
from typing import Optional, List, Dict
from celery import shared_task
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models.batch import UploadBatch, BatchStatus
from app.models.report import Report, ReportStatus
from app.models.metric import ExtractedMetric
from app.models.metric_definition import MetricDefinition, BatchMetricRelation, ExpectedType
from app.config import settings
from app.utils.http_client import get_httpx_client
from app.utils.text_utils import smart_truncate
from app.utils.file import resolve_stored_path

# 默认港股 8 项指标的 metric_key 集合（用于判断是否可使用调优版 Prompt）
_DEFAULT_HK_METRIC_KEYS = {
    "company_name", "stock_code", "submission_date", "repurchase_date",
    "shares_repurchased", "highest_price_paid", "lowest_price_paid", "total_consideration"
}

# 调优版港股 Prompt（当批次绑定的指标恰好是 8 项默认港股指标时使用）
_HK_STOCK_SYSTEM_PROMPT = """你是一个精通港股合规公告的数据审计专家。请仔细阅读用户提供的"翌日披露报表" PDF 文本，精准提取指定的 8 项核心指标。

【特定定位指导（极其重要）】：
1. 寻找文本顶部的"公司名稱"和"呈交日期"。
2. 忽略"第一章節"中关于期权、股份变动的干扰数据。
3. 必须精准定位到"第二章節 購回報告"（或 A. 購回報告）的表格结构中，提取里面的"交易日"、"購回股份數目"、"每股最高購回價"、"每股最低購回價"以及"付出的價格總額"。

【数据清洗规整三原则（极为重要，违反将导致系统解析崩溃）】：
1. 日期格式转化：所有提取的日期（submission_date, repurchase_date）必须统一规整为 "YYYY-MM-DD" 格式。如文本中写着 "2026年6月2日" 或 "02/06/2026"，必须在 JSON 中强制输出为 "2026-06-02"。
2. 数值纯化剔除：提取的所有数值型字段（shares_repurchased, highest_price_paid, lowest_price_paid, total_consideration）必须输出为纯粹的整型（integer）或浮点型（float）。必须在输出前剔除如 "港元"、"元"、"$"、"股"、"%" 等一切非数字文本，且严禁夹带用作千分位符的逗号（例如，"47,350,000" 必须纯化规整为 47350000.00）。
3. 证券代码消歧：针对证券代号（stock_code），必须清洗为标准的 5 位主板港股代号字符串（不足 5 位的前面强制补 0，如提取到"700"或"0700"必须规范输出为 "00700"）。若文中同时存在人民币柜台代号（如"80700"），必须直接予以忽略，仅锁定并提取港币柜台主板代号。

必须严格遵循以下 JSON Schema 输出数据，严禁夹带任何 Markdown 标记（如 ```json）或多余的自然语言解释。
如果文本中未提及某项指标，该指标的对应字段必须返回 null。

JSON Schema 约束：
{
  "company_name": string or null,
  "stock_code": string or null,
  "submission_date": string (YYYY-MM-DD) or null,
  "repurchase_date": string (YYYY-MM-DD) or null,
  "shares_repurchased": integer or null,
  "highest_price_paid": float or null,
  "lowest_price_paid": float or null,
  "total_consideration": float or null,
  "_units": {
    "shares_repurchased": "股" or "万股" or null,
    "highest_price_paid": "港元" or "元" or "美元" or null,
    "lowest_price_paid": "港元" or "元" or "美元" or null,
    "total_consideration": "港元" or "元" or "美元" or null
  }
}"""


def _load_batch_metrics(db: Session, batch_id: int) -> List[MetricDefinition]:
    """
    从 batch_metric_relations 加载批次绑定的指标定义。

    若批次未绑定任何指标（历史数据兼容），回退到系统预置指标。
    """
    relations = db.query(BatchMetricRelation).filter(
        BatchMetricRelation.batch_id == batch_id
    ).all()

    if relations:
        metric_def_ids = [r.metric_def_id for r in relations]
        metrics = db.query(MetricDefinition).filter(
            MetricDefinition.id.in_(metric_def_ids)
        ).all()
        return metrics

    # 历史兼容：旧批次可能没有 batch_metric_relations 记录，回退到系统默认（仅启用的）
    metrics = db.query(MetricDefinition).filter(
        MetricDefinition.is_system == True,
        MetricDefinition.is_active == True
    ).all()
    return metrics


def _is_default_hk_metrics(metrics: List[MetricDefinition]) -> bool:
    """判断指标集是否恰好为 8 项默认港股指标（可使用调优版 Prompt）。"""
    if len(metrics) != 8:
        return False
    return {m.metric_key for m in metrics} == _DEFAULT_HK_METRIC_KEYS


def _build_dynamic_prompt(metrics: List[MetricDefinition]) -> str:
    """
    根据指标定义动态组装 AI System Prompt 和 JSON Schema。

    若为默认港股指标集，使用调优版 Prompt（含章节锚定、数据清洗规则）；
    若为自定义指标集，生成通用 Prompt。
    """
    # 构造 JSON Schema 描述
    schema_lines = []
    for m in metrics:
        type_desc = "float or null" if m.expected_type == ExpectedType.NUMERIC else "string or null"
        hint = f"  // {m.prompt_instruction}" if m.prompt_instruction else ""
        schema_lines.append(f'  "{m.metric_key}": {type_desc},{hint}')

    json_schema = "{\n" + "\n".join(schema_lines) + ',\n  "_units": {}\n}'

    # 构造每个指标的提取指引
    instruction_lines = []
    for m in metrics:
        type_hint = "数值型（剔除货币符号、千分位符等单位文本）" if m.expected_type == ExpectedType.NUMERIC else "文本型"
        extra = m.prompt_instruction or ""
        instruction_lines.append(f"- **{m.metric_key}** ({m.metric_label})：{type_hint}。{extra}")

    prompt = f"""你是一个专业的数据审计与文档分析专家。请仔细阅读用户提供的文档文本，精准提取以下 {len(metrics)} 项指标。

【指标提取指引】：
{chr(10).join(instruction_lines)}

【数据清洗通用规则】：
1. 日期格式统一规整为 "YYYY-MM-DD"。
2. 数值型字段必须剔除货币符号、千分位逗号、百分比符号等单位文本，仅保留纯数字。同时在 _units 对象中输出每个数值字段的原始单位（如：元/港元/美元/股/万股/% 等），无法确定时填 null。
3. 若文档中某指标不存在或无法确定，对应字段返回 null。

必须严格遵循以下 JSON Schema 输出数据，严禁夹带任何 Markdown 标记（如 ```json）或多余的自然语言解释。

JSON Schema 约束：
{json_schema}"""

    return prompt


def _build_json_schema_dict(metrics: List[MetricDefinition]) -> dict:
    """根据指标定义构建 JSON Schema 字典（用于 response_format 和解析校验）。"""
    properties = {}
    for m in metrics:
        if m.expected_type == ExpectedType.NUMERIC:
            properties[m.metric_key] = {"type": ["number", "null"]}
        else:
            properties[m.metric_key] = {"type": ["string", "null"]}
    properties["_units"] = {"type": "object"}
    return {
        "type": "object",
        "properties": properties,
        "required": [m.metric_key for m in metrics],
        "additionalProperties": False
    }


def _numeric_clean(value) -> Optional[float]:
    """清洗数值型指标：剔除单位文本和千分位符，转为 float。"""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        # 剔除货币符号、单位文字、千分位逗号
        cleaned = re.sub(r'[^\d.\-]', '', value.replace(',', ''))
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


@shared_task(bind=True, max_retries=3, default_retry_delay=10)
def process_batch(self, batch_id: int):
    """
    处理批次中的所有报告（异步任务入口 — 分发模式）。

    不再串行处理报告，改为逐条 dispatch process_single_report_task，
    让 Celery worker 并发执行（受 worker_concurrency 限制）。
    """
    db = SessionLocal()
    try:
        batch = db.query(UploadBatch).filter(UploadBatch.id == batch_id).first()
        if not batch:
            return {"error": "Batch not found"}

        # 更新批次状态为处理中
        batch.status = BatchStatus.PROCESSING
        db.commit()

        # 获取批次中所有待处理报告
        reports = db.query(Report).filter(
            Report.batch_id == batch_id,
            Report.status == ReportStatus.PENDING
        ).all()

        # 逐条分发独立任务，让 Celery worker 并发执行
        dispatched = 0
        for report in reports:
            process_single_report_task.delay(report.id)
            dispatched += 1

        return {"batch_id": batch_id, "dispatched": dispatched}

    except Exception as e:
        db.rollback()
        raise self.retry(exc=e)
    finally:
        db.close()


def process_single_report(db: Session, report: Report, metric_definitions: List[MetricDefinition]):
    """
    处理单个报告：PDF 解析 → AI 指标提取 → 持久化。

    Args:
        db: 数据库会话
        report: 待处理报告
        metric_definitions: 批次绑定的指标定义列表
    """
    # Step 1: PDF 解析
    report.status = ReportStatus.PARSING
    db.commit()

    markdown_content = parse_pdf(str(resolve_stored_path(report.stored_path)))
    if not markdown_content:
        raise Exception("PDF 解析失败：未能提取文本内容")

    report.raw_markdown = markdown_content
    db.commit()

    # Step 2: AI 指标提取（传入动态指标定义）
    report.status = ReportStatus.EXTRACTING
    db.commit()

    metrics_data = extract_metrics_with_ai(markdown_content, metric_definitions)
    if not metrics_data:
        raise Exception("AI 指标提取失败")

    # Step 3: 持久化提取结果（EAV 纵表）
    save_metrics(db, report.id, metrics_data, metric_definitions)

    # 回填 entity_name（加速跨批次趋势查询）
    company_name = metrics_data.get("company_name")
    if company_name and isinstance(company_name, str):
        report.entity_name = company_name

    report.status = ReportStatus.SUCCESS
    db.commit()


def parse_pdf(file_path: str) -> Optional[str]:
    """
    使用 PyMuPDF 解析 PDF 并提取文本内容。

    硬性截取前 20 页，超出部分丢弃并在日志中记录。
    """
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(file_path)
        total_pages = len(doc)
        max_pages = min(total_pages, 20)

        markdown_parts = []
        for page_num in range(max_pages):
            page = doc[page_num]
            text = page.get_text()
            if text.strip():
                markdown_parts.append(f"## Page {page_num + 1}\n\n{text}")

        doc.close()

        # 记录页数超限日志
        if total_pages > 20:
            print(f"[parse_pdf] 页数超限: 原始 {total_pages} 页, 已丢弃 {total_pages - 20} 页, "
                  f"文件: {file_path}")

        return "\n\n".join(markdown_parts) if markdown_parts else None

    except Exception as e:
        print(f"[parse_pdf] 解析失败: {e}, 文件: {file_path}")
        return None


def extract_metrics_with_ai(markdown_content: str, metric_definitions: List[MetricDefinition]) -> Optional[dict]:
    """
    调用 SiliconFlow API (DeepSeek-V3) 提取指标。

    根据 metric_definitions 动态组装 System Prompt 和 JSON Schema，
    港股默认指标集使用调优版 Prompt，自定义指标集使用通用 Prompt。

    内置重试机制：对可恢复错误（429 限流、5xx 服务端错误、网络抖动）
    自动重试最多 3 次，采用指数退避 + 随机抖动防止惊群效应。
    不可恢复错误（400/401/403）不重试，立即返回 None。
    """
    # 选择 Prompt 策略
    if _is_default_hk_metrics(metric_definitions):
        system_prompt = _HK_STOCK_SYSTEM_PROMPT
    else:
        system_prompt = _build_dynamic_prompt(metric_definitions)

    json_schema = _build_json_schema_dict(metric_definitions)

    max_retries = 3
    base_delay = 1.0  # 基础退避秒数

    for attempt in range(max_retries + 1):
        try:
            client = get_httpx_client()
            response = client.post(
                f"{settings.SILICONFLOW_API_BASE}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.SILICONFLOW_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": settings.SILICONFLOW_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": f"请提取以下文档中的指标：\n\n{smart_truncate(markdown_content, settings.AI_EXTRACT_TRUNCATE_CHARS)}"}
                    ],
                    "temperature": 0.1,
                    "max_tokens": 2000,
                    "response_format": {"type": "json_object"}
                }
            )

            if response.status_code == 200:
                result = response.json()
                content = result["choices"][0]["message"]["content"]
                metrics = json.loads(content)
                if attempt > 0:
                    print(f"[extract_metrics] 第 {attempt} 次重试成功")
                return metrics

            # ── 判断错误是否可重试 ──────────────────────────
            status_code = response.status_code

            # 429 (Rate Limit) 和 5xx (服务端错误) 可重试
            if status_code in (429, 502, 503, 504):
                if attempt < max_retries:
                    delay = base_delay * (2 ** attempt) + random.uniform(0, 1)
                    print(f"[extract_metrics] API {status_code} 限流/服务端错误，"
                          f"第 {attempt + 1}/{max_retries} 次重试，等待 {delay:.1f}s")
                    time.sleep(delay)
                    continue
                else:
                    print(f"[extract_metrics] API {status_code} 错误，已达最大重试次数: "
                          f"{response.text[:500]}")
                    return None

            # 4xx 客户端错误（除 429）不重试
            print(f"[extract_metrics] API 客户端错误 {status_code}（不可重试）: "
                  f"{response.text[:500]}")
            return None

        except (json.JSONDecodeError, KeyError) as e:
            # JSON 解析失败：可能是响应被截断或格式错误，可重试
            if attempt < max_retries:
                delay = base_delay * (2 ** attempt) + random.uniform(0, 0.5)
                print(f"[extract_metrics] 响应解析失败 ({e})，"
                      f"第 {attempt + 1}/{max_retries} 次重试，等待 {delay:.1f}s")
                time.sleep(delay)
                continue
            else:
                print(f"[extract_metrics] 响应解析失败，已达最大重试次数: {e}")
                return None

        except Exception as e:
            # 网络错误等可重试异常
            if attempt < max_retries:
                delay = base_delay * (2 ** attempt) + random.uniform(0, 1)
                print(f"[extract_metrics] 请求异常 ({e})，"
                      f"第 {attempt + 1}/{max_retries} 次重试，等待 {delay:.1f}s")
                time.sleep(delay)
                continue
            else:
                print(f"[extract_metrics] 请求异常，已达最大重试次数: {e}")
                return None

    return None


def save_metrics(db: Session, report_id: int, metrics_data: dict, metric_definitions: List[MetricDefinition]):
    """
    将 AI 提取结果持久化到 extracted_metrics 表（EAV 纵表结构）。

    根据 metric_definitions 中的 expected_type 执行数据路由：
    - NUMERIC → 强类型清洗后写入 metric_value_num，原始值备份到 metric_value_raw
    - TEXT → 直接写入 metric_value_raw，metric_value_num 置 NULL
    - AI 未输出某指标 → 写入兜底容错记录
    """
    units_map = metrics_data.get("_units", {}) or {}

    for mdef in metric_definitions:
        raw_value = metrics_data.get(mdef.metric_key)

        # AI 未输出该指标：写入兜底容错记录
        if raw_value is None:
            metric = ExtractedMetric(
                report_id=report_id,
                metric_name=mdef.metric_key,
                metric_display_name=mdef.metric_label,
                metric_value_num=None,
                metric_value_raw="AI未输出该指标内容",
                fiscal_year=None,
                unit=units_map.get(mdef.metric_key),
                confidence=1.0
            )
            db.add(metric)
            continue

        # 确定 fiscal_year（时期锚点）
        fiscal_year = None
        if mdef.metric_key in ("submission_date", "repurchase_date", "fiscal_year"):
            fiscal_year = str(raw_value) if raw_value else None

        # 根据 expected_type 分流存储
        if mdef.expected_type == ExpectedType.NUMERIC:
            cleaned = _numeric_clean(raw_value)
            metric = ExtractedMetric(
                report_id=report_id,
                metric_name=mdef.metric_key,
                metric_display_name=mdef.metric_label,
                metric_value_num=cleaned,
                metric_value_raw=str(raw_value) if raw_value is not None else None,
                fiscal_year=fiscal_year,
                unit=units_map.get(mdef.metric_key),
                confidence=1.0
            )
        else:
            # TEXT 类型：直接完整写入 raw 字段
            metric = ExtractedMetric(
                report_id=report_id,
                metric_name=mdef.metric_key,
                metric_display_name=mdef.metric_label,
                metric_value_num=None,
                metric_value_raw=str(raw_value) if raw_value else None,
                fiscal_year=fiscal_year,
                unit=units_map.get(mdef.metric_key),
                confidence=1.0
            )

        db.add(metric)

    db.commit()


def _increment_batch_counter(db: Session, batch_id: int):
    """
    原子递增批次处理计数，并在全部完成时更新批次状态。

    使用 SQL UPDATE 表达式实现无锁计数器递增，避免并行竞态。
    """
    db.query(UploadBatch).filter(
        UploadBatch.id == batch_id
    ).update({
        UploadBatch.processed_files: UploadBatch.processed_files + 1
    }, synchronize_session=False)
    db.commit()

    # 检查是否全部完成
    batch = db.query(UploadBatch).filter(UploadBatch.id == batch_id).first()
    if batch and batch.processed_files >= batch.total_files:
        all_failed = db.query(Report).filter(
            Report.batch_id == batch_id,
            Report.status != ReportStatus.FAILED
        ).count() == 0
        batch.status = BatchStatus.FAILED if all_failed else BatchStatus.COMPLETED
        db.commit()


@shared_task(bind=True, max_retries=3, default_retry_delay=10)
def process_single_report_task(self, report_id: int):
    """
    处理单个报告（并行分发入口）。

    由 process_batch 逐条 dispatch，多个 worker 并发执行。
    成功或失败后均原子递增批次计数器。
    """
    db = SessionLocal()
    try:
        report = db.query(Report).filter(Report.id == report_id).first()
        if not report:
            return {"error": "Report not found"}

        batch_id = report.batch_id
        metric_definitions = _load_batch_metrics(db, batch_id)

        try:
            process_single_report(db, report, metric_definitions)
        except Exception as e:
            db.rollback()
            # 重新获取 report 对象（回滚后原对象脱离会话）
            report = db.query(Report).filter(Report.id == report_id).first()
            if report:
                report.status = ReportStatus.FAILED
                report.error_message = str(e)[:500]
            db.commit()

        # 无论成功还是失败，原子递增批次计数器
        _increment_batch_counter(db, batch_id)

        return {"report_id": report_id, "status": report.status.value if report else "unknown"}

    except Exception as e:
        db.rollback()
        # 外层异常也尝试更新计数器，防止计数器卡死
        try:
            report = db.query(Report).filter(Report.id == report_id).first()
            if report:
                _increment_batch_counter(db, report.batch_id)
        except Exception:
            pass
        raise self.retry(exc=e)
    finally:
        db.close()


@shared_task
def process_report(report_id: int):
    """
    处理单个报告（独立 Celery 任务入口，用于手动重试场景）。

    与 process_single_report_task 功能相同，但不带自动重试和 batch counter 更新。
    保留用于向后兼容。
    """
    db = SessionLocal()
    try:
        report = db.query(Report).filter(Report.id == report_id).first()
        if not report:
            return {"error": "Report not found"}

        metric_definitions = _load_batch_metrics(db, report.batch_id)
        process_single_report(db, report, metric_definitions)

        # 更新批次计数器
        _increment_batch_counter(db, report.batch_id)

        return {"report_id": report_id, "status": "success"}

    except Exception as e:
        db.rollback()
        # 失败也更新计数器
        try:
            report = db.query(Report).filter(Report.id == report_id).first()
            if report:
                report.status = ReportStatus.FAILED
                report.error_message = str(e)[:500]
                db.commit()
                _increment_batch_counter(db, report.batch_id)
        except Exception:
            pass
        return {"report_id": report_id, "error": str(e)}
    finally:
        db.close()
