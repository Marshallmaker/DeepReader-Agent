# backend/app/services/ai_metric_recommender.py
"""
AI 指标推荐服务 — 分析 PDF 样本，推荐指标体系 + 自动生成提示词。
"""
import json
import logging
from typing import Optional, Dict, Any
from app.config import get_settings
from app.utils.http_client import get_openai_client
from app.utils.text_utils import smart_truncate

logger = logging.getLogger(__name__)

RECOMMEND_SYSTEM_PROMPT = """你是一个金融分析专家。请分析以下研究报告，完成两个任务：

1. 判断这份报告的类型（如：港股回购报告、A股年报、美股10-K、宏观研报等）
2. 列出该报告中**所有可以提取的关键指标**，并为每个指标：
   - 生成一个英文 metric_key（snake_case）
   - 给出中文 metric_label
   - 判断 expected_type（NUMERIC 数值型 或 TEXT 文本型）
   - 编写一句简洁的 prompt_instruction，指导 AI 如何从报告中精准提取该指标

返回严格 JSON 格式：
{
  "report_type": "报告类型",
  "recommended_metrics": [
    {
      "metric_key": "net_profit",
      "metric_label": "归母净利润",
      "expected_type": "NUMERIC",
      "prompt_instruction": "从合并利润表中提取归属于母公司股东的净利润，剔除一次性项目，单位为亿元"
    }
  ]
}

要求：
- 指标数量不少于 5 个，不多于 20 个
- 优先提取核心财务指标（营收、利润、资产、现金流等）
- 其次提取行业特有指标
- prompt_instruction 要具体，包含数据来源（如"合并资产负债表"）和清洗规则
- metric_key 全小写，用下划线分隔，如 total_assets、eps_diluted
"""


def recommend_metrics_from_report(
    report_markdown: str,
    report_type_hint: Optional[str] = None,
) -> Dict[str, Any]:
    """
    分析 PDF 报告内容，推荐可提取的指标体系。

    Args:
        report_markdown: PDF 转换后的 Markdown 文本（前 20 页）
        report_type_hint: 用户提供的报告类型提示（可选）

    Returns:
        {"report_type": str, "recommended_metrics": [{...}]}
    """
    settings = get_settings()
    client = get_openai_client()

    # 智能首尾截断，兼顾报告前半部分的概述和后半部分的财务数据
    truncated = smart_truncate(report_markdown, settings.AI_RECOMMEND_TRUNCATE_CHARS)

    user_prompt = f"请分析以下研究报告内容：\n\n{truncated}"
    if report_type_hint:
        user_prompt = f"这份报告的类型可能是：{report_type_hint}\n\n{user_prompt}"

    try:
        response = client.chat.completions.create(
            model=settings.SILICONFLOW_MODEL,
            messages=[
                {"role": "system", "content": RECOMMEND_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=2000,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content
        try:
            result = json.loads(content)
        except (json.JSONDecodeError, TypeError) as e:
            logger.error(f"AI 指标推荐 JSON 解析失败: {e}, 原始内容: {content}")
            raise RuntimeError("AI 指标推荐返回格式异常，请稍后重试。")
        # 验证返回格式
        if "recommended_metrics" not in result:
            result["recommended_metrics"] = []
        for m in result["recommended_metrics"]:
            m.setdefault("expected_type", "NUMERIC")
            m.setdefault("prompt_instruction", "")
        return result
    except Exception as e:
        logger.error(f"AI 指标推荐失败: {e}")
        raise RuntimeError("AI 指标推荐服务暂时不可用，请稍后重试。")


def recommend_metrics_from_text(
    text: str,
    report_type_hint: Optional[str] = None,
) -> Dict[str, Any]:
    """无 PDF 时，根据文字描述推荐指标"""
    settings = get_settings()
    client = get_openai_client()

    user_prompt = f"请为以下类型的报告推荐指标体系：{text}"
    if report_type_hint:
        user_prompt = f"报告类型：{report_type_hint}。{user_prompt}"

    try:
        response = client.chat.completions.create(
            model=settings.SILICONFLOW_MODEL,
            messages=[
                {"role": "system", "content": RECOMMEND_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=2000,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content
        try:
            result = json.loads(content)
        except (json.JSONDecodeError, TypeError) as e:
            logger.error(f"AI 指标推荐 JSON 解析失败（文本模式）: {e}, 原始内容: {content}")
            raise RuntimeError("AI 指标推荐返回格式异常，请稍后重试。")
        # 验证返回格式
        if "recommended_metrics" not in result:
            result["recommended_metrics"] = []
        for m in result["recommended_metrics"]:
            m.setdefault("expected_type", "NUMERIC")
            m.setdefault("prompt_instruction", "")
        return result
    except Exception as e:
        logger.error(f"AI 指标推荐失败（文本模式）: {e}")
        raise RuntimeError("AI 指标推荐服务暂时不可用，请稍后重试。")


def recommend_metrics_stream(
    report_markdown: str,
    report_type_hint: Optional[str] = None,
):
    """
    流式 AI 指标推荐 — 逐 token 返回生成内容。

    使用 OpenAI stream=True，yield SSE 格式的 data chunk。
    流式模式下不使用 json_object 约束（避免兼容性问题），
    由前端累积后解析 JSON。
    """
    settings = get_settings()
    client = get_openai_client()

    truncated = smart_truncate(report_markdown, settings.AI_RECOMMEND_TRUNCATE_CHARS)
    user_prompt = f"请分析以下研究报告内容：\n\n{truncated}"
    if report_type_hint:
        user_prompt = f"这份报告的类型可能是：{report_type_hint}\n\n{user_prompt}"

    full_content = ""
    try:
        response = client.chat.completions.create(
            model=settings.SILICONFLOW_MODEL,
            messages=[
                {"role": "system", "content": RECOMMEND_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=2000,
            stream=True,
        )

        for chunk in response:
            delta = chunk.choices[0].delta
            if delta.content:
                full_content += delta.content
                yield f"data: {json.dumps({'chunk': delta.content})}\n\n"

        # 解析最终结果
        try:
            parsed = json.loads(full_content)
        except (json.JSONDecodeError, TypeError):
            # 尝试提取 JSON（模型可能在前后加了说明文字）
            parsed = _extract_json_from_text(full_content)

        if parsed is None:
            yield f"data: {json.dumps({'error': 'AI 返回内容无法解析为 JSON', 'raw': full_content[:500]})}\n\n"
            return

        parsed.setdefault("recommended_metrics", [])
        for m in parsed.get("recommended_metrics", []):
            m.setdefault("expected_type", "NUMERIC")
            m.setdefault("prompt_instruction", "")
        yield f"data: {json.dumps({'done': True, 'result': parsed})}\n\n"

    except Exception as e:
        logger.error(f"流式 AI 指标推荐失败: {e}")
        yield f"data: {json.dumps({'error': str(e)})}\n\n"


def _extract_json_from_text(text: str) -> Optional[Dict[str, Any]]:
    """从可能包含额外说明文字的 AI 输出中提取 JSON 对象。"""
    import re
    # 尝试找到第一个 { 和最后一个 }
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except (json.JSONDecodeError, TypeError):
            pass
    return None
