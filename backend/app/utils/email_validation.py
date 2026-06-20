"""
邮箱域名严格校验工具。

解决 .comm、.con 等 TLD 拼写错误绕过验证的问题。
策略：2-3 字符 TLD 一律放行（覆盖全部 ccTLD），4+ 字符 TLD 必须命中已知白名单。

用法：
    from app.utils.email_validation import validate_email_domain

    is_valid, error_message = validate_email_domain("test@qq.com")
    # → (True, None)

    is_valid, error_message = validate_email_domain("test@qq.comm")
    # → (False, '邮箱域名 ".comm" 无效，您是否想输入 ".com"？')
"""

import re
import logging

logger = logging.getLogger(__name__)

# ── 常见长 TLD 白名单（≥4 字符）──────────────────────────────
# 收录广泛使用的长顶级域名。不在列表中的长 TLD 将被拒绝。
# 2-3 字符 TLD 无需列入（.com .cn .io .uk .de .jp ...），自动放行。
KNOWN_LONG_TLDS: set[str] = {
    # 通用 gTLD
    'info', 'biz', 'name', 'mobi', 'asia', 'coop', 'aero',
    # 新通用 gTLD（常用）
    'tech', 'online', 'site', 'shop', 'store', 'cloud',
    'group', 'email', 'work', 'link', 'live', 'blog',
    'club', 'design', 'world', 'space', 'website', 'press',
    'wiki', 'host', 'plus', 'pro', 'app', 'dev', 'xyz',
    'vip', 'top', 'fun', 'ltd', 'ink', 'love', 'art',
    'fit', 'beauty', 'market', 'media', 'news', 'studio',
    'agency', 'center', 'guru', 'today', 'solutions',
    'company', 'computer', 'systems', 'network', 'academy',
    'careers', 'codes', 'domains', 'education', 'events',
    'florist', 'gallery', 'glass', 'graphics', 'gratis',
    'holdings', 'industries', 'institute', 'international',
    'limited', 'management', 'partners', 'photos', 'pics',
    'repair', 'report', 'school', 'science', 'services',
    'social', 'software', 'support', 'team', 'training',
    'ventures', 'vision', 'watch', 'zone',
    # 中文 TLD
    '公司', '网络', '网址', '中国', '在线', '中文网',
}

# ── 常见拼写错误 → 正确 TLD 建议 ─────────────────────────────
TLD_SUGGESTIONS: dict[str, str] = {
    'comm':  'com',
    'commm': 'com',
    'comn':  'com',
    'cmo':   'com',
    'con':   'com',
    'conm':  'com',
    'nett':  'net',
    'netn':  'net',
    'orgg':  'org',
    'orrg':  'org',
    'eddu':  'edu',
    'eduu':  'edu',
    'govv':  'gov',
    'govn':  'gov',
    'cnn':   'cn',
    'cnm':   'cn',
    'iio':   'io',
    'coom':  'co',
}

# ── 基本邮箱格式正则（本地部分 + 域名部分）───────────────────
EMAIL_PATTERN = re.compile(
    r'^[a-zA-Z0-9._%+\-]+@([a-zA-Z0-9.\-]+)\.([a-zA-Z一-鿿]{2,})$'
)


def validate_email_domain(email: str) -> tuple[bool, str | None]:
    """
    严格校验邮箱域名的 TLD 是否合法。

    校验策略：
    1. 基本格式检查（@ + 域名 + 点 + TLD）
    2. TLD 长度 ≤3 字符 → 直接放行（覆盖全部国家级域名和 .com .net .org .edu .gov）
    3. TLD 长度 ≥4 字符 → 必须在 KNOWN_LONG_TLDS 白名单中
    4. 不在白名单的长 TLD → 检查是否为常见拼写错误，给出友好纠正建议

    Args:
        email: 待校验的邮箱地址

    Returns:
        (is_valid, error_message)
        - is_valid=True, error_message=None  → 域名合法
        - is_valid=False, error_message=str → 域名不合法及原因
    """
    if not email or not isinstance(email, str):
        return False, '邮箱地址不能为空'

    email = email.strip()

    # 1. 基本格式检查
    match = EMAIL_PATTERN.match(email)
    if not match:
        return False, '邮箱格式不正确，请输入有效的邮箱地址'

    # domain = match.group(1)   # 域名部分（不含 TLD），暂未使用
    tld = match.group(2).lower()

    # 2. 2-3 字符 TLD 直接放行
    if len(tld) <= 3:
        return True, None

    # 3. 检查白名单
    if tld in KNOWN_LONG_TLDS:
        return True, None

    # 4. 不在白名单 → 给出错误提示
    if tld in TLD_SUGGESTIONS:
        suggestion = TLD_SUGGESTIONS[tld]
        logger.info(f"Email TLD typo detected: '{tld}' → suggested '{suggestion}' for {email}")
        return False, f'邮箱域名 ".{tld}" 无效，您是否想输入 ".{suggestion}"？'

    logger.info(f"Unknown email TLD rejected: '.{tld}' in {email}")
    return False, f'邮箱域名 ".{tld}" 无效，请检查邮箱地址是否正确'
