/**
 * 量纲检测模块
 *
 * 纯前端轻量分类：通过关键词推断指标量纲，无需后端改造。
 * 四层推断机制：关键词匹配 → 单位推断 → 预置映射 → 兜底 unknown
 */

// ── 类型定义 ────────────────────────────────────────────────

/** 量纲类型：数量 / 金额 / 单价 / 比率 / 未知 */
export type Dimension = 'count' | 'amount' | 'price' | 'ratio' | 'unknown'

/** 量纲详情：类型 + 中文标签 + 典型单位 */
export interface DimensionInfo {
  dimension: Dimension
  label: string
  unit: string
}

/** 冲突等级 */
export type ConflictLevel = 'none' | 'low' | 'high'

/** 冲突检测结果 */
export interface ConflictResult {
  level: ConflictLevel
  dimensions: Dimension[]
  message: string | null
}

// ── 量纲元数据 ──────────────────────────────────────────────

const DIMENSION_META: Record<Dimension, DimensionInfo> = {
  count: { dimension: 'count', label: '数量', unit: '股数' },
  amount: { dimension: 'amount', label: '金额', unit: '港元' },
  price: { dimension: 'price', label: '单价', unit: '港元/股' },
  ratio: { dimension: 'ratio', label: '比率', unit: '%' },
  unknown: { dimension: 'unknown', label: '未知', unit: '' },
}

// ── 第一层：关键词规则匹配 ──────────────────────────────────

const KEYWORD_RULES: Array<{ dimension: Dimension; keys: string[] }> = [
  { dimension: 'count',  keys: ['shares', 'count', 'volume', 'quantity', '股数', '数量', 'vol', 'qty'] },
  { dimension: 'amount', keys: ['total', 'amount', 'consideration', 'value', '金额', '总价', '代价', 'sum'] },
  { dimension: 'price',  keys: ['price', 'avg', 'average', 'nav', '价格', '均价', '单价', '净值'] },
  { dimension: 'ratio',  keys: ['rate', 'ratio', 'percentage', 'pct', 'premium', 'discount', '率', '比例', '百分比', '溢价', '折价'] },
]

// ── 第三层：系统预置指标映射 ─────────────────────────────────

const PRESET_MAP: Record<string, Dimension> = {
  // 回购相关
  shares_repurchased: 'count',
  total_consideration: 'amount',
  highest_price_paid: 'price',
  lowest_price_paid: 'price',
  average_price_paid: 'price',
  shares_outstanding: 'count',
  shares_cancelled: 'count',
  percentage_of_shares: 'ratio',
  nav_per_share: 'price',
  buyback_premium: 'ratio',
  // 财务通用
  revenue: 'amount',
  net_income: 'amount',
  total_assets: 'amount',
  eps: 'price',
  roe: 'ratio',
  roa: 'ratio',
  pe_ratio: 'ratio',
  pb_ratio: 'ratio',
  dividend_yield: 'ratio',
  market_cap: 'amount',
  volume: 'count',
}

// ── 公共 API ────────────────────────────────────────────────

/**
 * 检测单个指标的量纲类型。
 *
 * 推断优先级：预置映射 > 关键词匹配 > 单位推断 > 未知
 */
export function detectDimension(
  metricKey: string,
  metricLabel?: string,
  unit?: string
): Dimension {
  const key = metricKey?.toLowerCase() ?? ''
  const label = metricLabel?.toLowerCase() ?? ''
  const combined = `${key} ${label}`

  // 第三层：预置映射（最高优先级）
  if (PRESET_MAP[key]) return PRESET_MAP[key]

  // 第一层：关键词匹配
  for (const rule of KEYWORD_RULES) {
    for (const kw of rule.keys) {
      if (combined.includes(kw.toLowerCase())) {
        return rule.dimension
      }
    }
  }

  // 第二层：单位推断
  if (unit) {
    const u = unit.toLowerCase()
    if (u.includes('%') || u.includes('％') || u.includes('pct')) return 'ratio'
    if (u.includes('元') || u.includes('$') || u.includes('hkd') || u.includes('usd')) {
      if (u.includes('/') || u.includes('每')) return 'price'
      return 'amount'
    }
    if (u.includes('股') || u.includes('share')) return 'count'
  }

  // 第四层：兜底
  return 'unknown'
}

/**
 * 批量检测指标量纲。
 * 返回 metric_key → Dimension 的 Map。
 */
export function detectDimensions(
  metrics: Array<{ metric_key: string; metric_label: string; unit?: string }>
): Map<string, Dimension> {
  const result = new Map<string, Dimension>()
  for (const m of metrics) {
    result.set(m.metric_key, detectDimension(m.metric_key, m.metric_label, m.unit))
  }
  return result
}

/**
 * 评估量纲冲突等级。
 *
 * 规则：
 * - 所有指标同类型 → none
 * - 2 种量纲混合 → low
 * - ≥3 种量纲，或 ratio 与绝对值指标混合 → high
 */
export function evaluateConflict(dimensions: Dimension[]): ConflictResult {
  const unique = [...new Set(dimensions.filter((d) => d !== 'unknown'))]

  if (unique.length <= 1) {
    return { level: 'none', dimensions: unique, message: null }
  }

  // ratio 与 count/amount/price 混合 → 高冲突
  const hasRatio = unique.includes('ratio')
  const hasAbsolute = unique.some((d) => ['count', 'amount', 'price'].includes(d))

  if (unique.length >= 3 || (hasRatio && hasAbsolute)) {
    return {
      level: 'high',
      dimensions: unique,
      message: `当前指标包含 ${unique.length} 种量纲（${unique.map((d) => DIMENSION_META[d].label).join('、')}），数据可比性较差，建议减少指标或拆分为多个图表`,
    }
  }

  return {
    level: 'low',
    dimensions: unique,
    message: `当前指标包含 ${unique.map((d) => DIMENSION_META[d].label).join(' 与 ')} 两种量纲，系统将使用双轴展示`,
  }
}

/**
 * 获取量纲的中文标签和默认单位。
 */
export function getDimensionInfo(dimension: Dimension): DimensionInfo {
  return DIMENSION_META[dimension]
}
