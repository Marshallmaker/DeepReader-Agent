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

export interface DataPoint {
  fiscal_year?: string
  report_name?: string
  entity_name?: string
  batch_id?: number
  value: number | null
  unit?: string
  is_anomaly?: boolean
  anomaly_deviation?: number
}

export interface SeriesData {
  metric_key: string
  metric_label: string
  data: DataPoint[]
}

// ── 双 Y 轴辅助函数 ──────────────────────────────────────────────

/**
 * 根据序列的量级差异自动构建 Y 轴配置。
 *
 * 逻辑：当某个序列的最大值与全局最大值的比值 > 50 倍时，
 * 启用双 Y 轴（左：主坐标轴，右：次坐标轴），否则使用单 Y 轴。
 *
 * @param series 指标序列数组
 * @returns EChartsOption 中的 yAxis 配置（单个对象或两个对象的数组）
 */
export function buildYAxis(series: SeriesData[]): EChartsOption['yAxis'] {
  if (series.length < 2) return { type: 'value' }

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
 * 为每个序列分配 Y 轴索引（0 = 左/主坐标轴，1 = 右/次坐标轴）。
 *
 * 量级较小的序列（最大值 < 全局最大值的 1/50）分配到次坐标轴。
 *
 * @param series 指标序列数组
 * @returns 与 series 一一对应的 yAxisIndex 数组
 */
export function assignYAxisIndex(series: SeriesData[]): number[] {
  if (series.length < 2) return series.map(() => 0)

  const maxValues = series.map((s) => {
    const values = s.data
      .filter((d) => d.value != null)
      .map((d) => d.value as number)
    return values.length > 0 ? Math.max(...values) : 0
  })

  const maxVal = Math.max(...maxValues, 1)
  return maxValues.map((v) => (v > 0 && maxVal / v > 50) ? 1 : 0)
}

export interface ReductionConfig {
  topN?: number
  granularity?: string
  anomalyFirst?: boolean
  page?: number
  pageSize?: number
}

export interface ReductionStrategy {
  defaultTopN: number
  pageSize: number
  aggregateGranularity?: string
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
        matched.push(registry.get(needed)!)
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
