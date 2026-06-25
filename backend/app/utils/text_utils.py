"""
文本处理工具函数。
提供智能截断等通用文本操作。
"""


def smart_truncate(text: str, max_chars: int, head_ratio: float = 0.6) -> str:
    """
    智能截断文本：保留头部和尾部，中间用省略标记分隔。

    与简单的 text[:N] 不同，此函数同时保留文本的首部和尾部，
    确保关键信息（常出现在文档后半部分的财务数据表等）不被丢弃。

    Args:
        text: 原始文本
        max_chars: 最大保留字符数
        head_ratio: 头部占比（0.0 ~ 1.0），默认 0.6 即头部占 60%

    Returns:
        截断后的文本。若原始长度 ≤ max_chars 则原样返回。

    Example:
        >>> smart_truncate("abcdefghij", 8, head_ratio=0.5)
        "abcd\\n\\n... [中间省略 4 字符] ...\\n\\nghij"
    """
    if len(text) <= max_chars:
        return text

    # 至少保留 100 字符给省略标记和有意义的内容
    if max_chars < 150:
        head_size = max(1, max_chars - 3)
        return text[:head_size] + "..."

    head_size = int(max_chars * head_ratio)
    tail_size = max_chars - head_size - 50  # 50 字符留给省略标记行

    # 边界安全：确保 head 和 tail 至少各有 50 字符
    if head_size < 50:
        head_size = 50
        tail_size = max_chars - head_size - 50
    if tail_size < 50:
        tail_size = 50
        head_size = max_chars - tail_size - 50

    head = text[:head_size]
    tail = text[-tail_size:]

    omitted = len(text) - max_chars
    return f"{head}\n\n... [中间省略约 {omitted} 字符] ...\n\n{tail}"
