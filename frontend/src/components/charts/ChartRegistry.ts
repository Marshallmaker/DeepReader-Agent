/**
 * ChartRegistry -- 图表注册工厂
 *
 * 所有图表类型在此注册，供 ChartRenderer、AutoChartGrid 等组件统一发现和调用。
 */

import type { EChartsOption } from 'echarts'

// ── 公共类型定义 ────────────────────────────────────────────────

export interface MetricDef {
  metric_key: string
  metric_label: string
  expected_type: string
}

export interface Report {
  id: number
  report_name: string
  entity_name?: string
  batch_id: number
}

/** 图表数据点 — 基于 API 返回类型，fiscal_year 在对比端点可能为空字符串 */
export interface DataPoint {
  fiscal_year: string
  report_name?: string
  entity_name?: string
  report_id?: number
  batch_id?: number
  value: number | null
  unit?: string
  is_anomaly?: boolean
  anomaly_deviation?: number
  /** 异常方向："high"（偏高）| "low"（偏低） */
  anomaly_direction?: string
  /** 检测方法："median_deviation" | "iqr" | "zscore" */
  anomaly_method?: string
  /** 检测阈值（方法不同含义不同） */
  anomaly_threshold?: number
}

export interface SeriesData {
  metric_key: string
  metric_label: string
  data: DataPoint[]
  /** 量纲类型（count/amount/price/ratio/unknown），用于双轴分组和颜色绑定 */
  dimension?: string
}

// ── 维度颜色映射 ──────────────────────────────────────────────

/** 量纲类型 → 坐标轴颜色 */
export const DIMENSION_COLORS: Record<string, string> = {
  count: '#007AFF',
  amount: '#0040D0',
  price: '#FF9500',
  ratio: '#34C759',
  unknown: '#8E8E93',
}

/** 获取量纲对应的显示颜色 */
export function getDimensionColor(dimension?: string): string {
  return DIMENSION_COLORS[dimension ?? 'unknown'] ?? DIMENSION_COLORS.unknown
}

// ── 系列颜色调色板 ──────────────────────────────────────────

/** 12 色调色板（Apple 系统色风格），供所有图表组件共享 */
export const COLORS = [
  '#007AFF', '#FF9500', '#34C759', '#FF3B30', '#AF52DE',
  '#5856D6', '#00C7BE', '#FF2D55', '#8E8E93', '#FF6B35',
  '#0A84FF', '#30D158',
]

// ── 双 Y 轴辅助函数（维度感知版）─────────────────────────────

/**
 * 基于量纲维度构建 Y 轴配置。
 *
 * 逻辑：
 * 1. 若所有指标属于同一维度 → 单轴
 * 2. 若存在两种不同维度 → 双轴（各维度绑定一个轴，轴颜色与维度色一致）
 * 3. 若存在三种及以上维度 → 双轴（ratio 放右轴，其余放左轴）
 *
 * 回退：无 dimension 信息时回退到纯量级判断（向后兼容）
 */
export function buildYAxis(series: SeriesData[]): EChartsOption['yAxis'] {
  if (series.length < 2) return { type: 'value' }

  // 收集各 series 的维度信息
  const dimensions = series.map((s) => s.dimension || 'unknown')

  // 回退路径：全为 unknown 时使用旧的量级判断
  if (dimensions.every((d) => d === 'unknown')) {
    return buildYAxisByMagnitude(series)
  }

  const uniqueDims = [...new Set(dimensions.filter((d) => d !== 'unknown'))]

  if (uniqueDims.length <= 1) {
    // 单一维度 → 单轴
    const dim = uniqueDims[0] || 'unknown'
    return {
      type: 'value',
      name: getDimensionLabel(dim),
      axisLabel: { color: getDimensionColor(dim) },
    }
  }

  // 多维度 → 双轴
  // 主维度（左轴）：第一个非 ratio 维度，或第一个维度
  const primaryDim = uniqueDims.find((d) => d !== 'ratio') || uniqueDims[0]
  // 次要维度（右轴）：ratio 优先，否则第二个维度
  const secondaryDim = uniqueDims.find((d) => d !== primaryDim) || uniqueDims[1] || uniqueDims[0]

  return [
    {
      type: 'value',
      name: getDimensionLabel(primaryDim),
      axisLabel: { color: getDimensionColor(primaryDim) },
    },
    {
      type: 'value',
      name: getDimensionLabel(secondaryDim),
      axisLabel: { color: getDimensionColor(secondaryDim) },
    },
  ]
}

/**
 * 回退：纯量级判断双轴（无 dimension 信息时使用）。
 */
function buildYAxisByMagnitude(series: SeriesData[]): EChartsOption['yAxis'] {
  const maxValues = series.map((s) => {
    const values = s.data
      .filter((d) => d.value != null)
      .map((d) => d.value as number)
    return values.length > 0 ? Math.max(...values) : 0
  })

  const maxVal = Math.max(...maxValues, 1)
  const needsDualAxis = maxValues.some((v) => v > 0 && maxVal / v > 50)

  if (!needsDualAxis) {
    return { type: 'value' }
  }

  return [
    { type: 'value', name: '主坐标轴' },
    { type: 'value', name: '次坐标轴' },
  ]
}

/**
 * 为每个序列分配 Y 轴索引（0 = 左轴，1 = 右轴）。
 *
 * 维度感知：同一维度的序列分配到同一轴。
 * 回退：无维度信息时回退到量级判断。
 */
export function assignYAxisIndex(series: SeriesData[]): number[] {
  if (series.length < 2) return series.map(() => 0)

  const dimensions = series.map((s) => s.dimension || 'unknown')
  const uniqueDims = [...new Set(dimensions.filter((d) => d !== 'unknown'))]

  if (uniqueDims.length <= 1) {
    // 无维度差异：量级回退
    return fallbackYAxisIndexForUnknown(series, dimensions)
  }

  // 有已知维度且存在 unknown → 统一用量级回退
  if (dimensions.some((d) => d === 'unknown')) {
    return fallbackYAxisIndexForUnknown(series, dimensions)
  }

  // 纯维度驱动
  const primaryDim = uniqueDims.find((d) => d !== 'ratio') || uniqueDims[0]
  return dimensions.map((d) => (d === primaryDim ? 0 : 1))
}

/** 单个 series 的量级回退（用于 unknown 维度） */
function fallbackYAxisIndexForUnknown(
  series: SeriesData[],
  dimensions: string[]
): number[] {
  const maxValues = series.map((s) => {
    const values = s.data
      .filter((d) => d.value != null)
      .map((d) => d.value as number)
    return values.length > 0 ? Math.max(...values) : 0
  })
  const maxVal = Math.max(...maxValues, 1)
  const primaryDim = dimensions.find((d) => d !== 'unknown') || 'unknown'

  return series.map((_, i) => {
    // 已知维度：检查是否是 primary
    if (dimensions[i] !== 'unknown') {
      return dimensions[i] === primaryDim ? 0 : 1
    }
    // unknown：量级判断
    const v = maxValues[i]
    return v > 0 && maxVal / v > 50 ? 1 : 0
  })
}

/** 量纲 → 中文标签 */
function getDimensionLabel(dim: string): string {
  const labels: Record<string, string> = {
    count: '数量',
    amount: '金额',
    price: '价格',
    ratio: '比率',
    unknown: '',
  }
  return labels[dim] || dim
}

export interface ReductionConfig {
  topN?: number
  granularity?: string
  page?: number
  pageSize?: number
}

export interface ReductionStrategy {
  defaultTopN: number
  pageSize: number
  aggregateGranularity?: string
}

// ── 异常相关常量与工具函数 ──────────────────────────────────────

/** 异常方向 → 显示颜色 */
export const ANOMALY_COLORS: Record<string, string> = {
  high: '#FF3B30',   // 红色：显著偏高
  low: '#FF9500',    // 琥珀色：显著偏低
}

/** 检测方法 → 中文标签 */
export const METHOD_LABELS: Record<string, string> = {
  median_deviation: '中位数偏离法',
  iqr: '四分位距法（IQR）',
  zscore: 'Z-Score 法',
}

/**
 * 构建异常 tooltip 附加行（HTML 片段）。
 * 供各图表 tooltip formatter 复用。
 *
 * 根据检测方法输出人类可读的解释：
 * - median_deviation: "偏离中位数 15.2%（阈值 5.0%）"
 * - iqr:              "超出上界 2.5 倍 IQR（阈值 1.5 倍）"
 * - zscore:           "偏离均值 3.2 个标准差（阈值 2.0σ）"
 */
export function formatAnomalyTooltip(dp: DataPoint): string {
  if (!dp.is_anomaly) return ''
  const dir = dp.anomaly_direction || ''
  const dirLabel = dir === 'high' ? '显著偏高 ↑' : dir === 'low' ? '显著偏低 ↓' : '异常'
  const color = ANOMALY_COLORS[dir] || '#FF3B30'
  const method = dp.anomaly_method || ''
  const methodLabel = METHOD_LABELS[method] || method
  const deviation = dp.anomaly_deviation
  const threshold = dp.anomaly_threshold

  let html = `<div style="color:${color};font-size:12px;margin-top:4px;font-weight:bold;">⚠️ ${dirLabel}</div>`

  // 根据检测方法给出人类可读的偏离解释
  if (deviation != null) {
    if (method === 'median_deviation') {
      // deviation 是比值（如 0.152 = 偏离中位数 15.2%）
      const devPct = (deviation * 100).toFixed(1)
      const thrPct = threshold != null ? (threshold * 100).toFixed(1) : '?'
      html += `<div style="font-size:11px;color:#666;">偏离中位数 <b>${devPct}%</b>（阈值 ${thrPct}%）</div>`
    } else if (method === 'iqr') {
      // deviation 是 IQR 倍数（如 2.5 = 超出边界 2.5 倍 IQR）
      const boundary = dir === 'high' ? '上界' : '下界'
      const thrStr = threshold != null ? threshold.toFixed(1) : '?'
      html += `<div style="font-size:11px;color:#666;">超出${boundary} <b>${deviation.toFixed(1)}</b> 倍 IQR（阈值 ${thrStr} 倍）</div>`
    } else if (method === 'zscore') {
      // deviation 是 z-score（如 3.2 = 偏离均值 3.2 个标准差）
      const thrStr = threshold != null ? `${threshold.toFixed(1)}σ` : '?σ'
      html += `<div style="font-size:11px;color:#666;">偏离均值 <b>${deviation.toFixed(1)}</b> 个标准差（阈值 ${thrStr}）</div>`
    } else {
      // 未知方法：回退通用显示
      html += `<div style="font-size:11px;color:#666;">偏离度: ${deviation.toFixed(2)}</div>`
    }
  }

  html += `<div style="font-size:10px;color:#999;">检测方法: ${methodLabel}</div>`
  return html
}

export type ChartType = 'line' | 'bar' | 'pie' | 'gauge' | 'radar' | 'heatmap'

export interface ChartTypeConfig {
  type: ChartType
  name: string
  isApplicable: (metrics: MetricDef[], reports: Report[]) => boolean
  buildOption: (data: SeriesData[], reduction?: ReductionConfig) => EChartsOption
  defaultReduction: ReductionStrategy
}

// ── 注册表（内部 Map） ─────────────────────────────────────────

const registry = new Map<string, ChartTypeConfig>()

// ── 公开 API ───────────────────────────────────────────────────

/**
 * 注册图表类型。
 * 若相同 type 已存在，console.warn 并覆盖。
 */
export function register(config: ChartTypeConfig): void {
  if (registry.has(config.type)) {
    console.warn(
      `[ChartRegistry] 图表类型 "${config.type}" 已注册，将被覆盖`
    )
  }
  registry.set(config.type, config)
}

/** 按 type 获取图表配置，未注册时返回 undefined */
export function get(type: string): ChartTypeConfig | undefined {
  return registry.get(type)
}

/** 返回所有已注册图表配置的数组 */
export function list(): ChartTypeConfig[] {
  return Array.from(registry.values())
}

/**
 * 自动分配：遍历注册表，对每个 config 调用 isApplicable，
 * 返回所有匹配的图表类型。
 *
 * 特殊规则：当报告数 >= 2 时，至少包含 line 和 bar（若已注册）。
 */
export function autoAssign(
  metrics: MetricDef[],
  reports: Report[]
): ChartTypeConfig[] {
  const matched: ChartTypeConfig[] = []

  for (const config of registry.values()) {
    if (config.isApplicable(metrics, reports)) {
      matched.push(config)
    }
  }

  // 报告数 >= 2 时保证 line 和 bar 出现在结果中
  if (reports.length >= 2) {
    const registeredTypes = new Set(matched.map((c) => c.type))
    for (const needed of ['line', 'bar'] as ChartType[]) {
      if (!registeredTypes.has(needed) && registry.has(needed)) {
        const config = registry.get(needed)!
        // 复核 isApplicable —— 只追加真正适用的图表类型
        if (config.isApplicable(metrics, reports)) {
          matched.push(config)
        }
      }
    }
  }

  return matched
}

/**
 * 按 type 构建 ECharts option。
 * 若 type 未注册，返回 null 并 console.warn。
 */
export function buildOption(
  type: string,
  data: SeriesData[],
  reduction?: ReductionConfig
): EChartsOption | null {
  const config = registry.get(type)
  if (!config) {
    console.warn(`[ChartRegistry] 未注册的图表类型: "${type}"`)
    return null
  }
  return config.buildOption(data, reduction)
}
