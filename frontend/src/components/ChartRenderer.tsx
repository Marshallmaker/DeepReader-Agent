/**
 * ChartRenderer — 统一图表渲染组件
 *
 * 从 ChartRegistry 获取图表配置并委托渲染，支持 6 种图表类型。
 * 向后兼容旧的 'trend' / 'comparison' 图表类型（自动映射为 'line' / 'bar'）。
 */

import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import {
  LineChart,
  BarChart,
  PieChart,
  GaugeChart,
  RadarChart,
  HeatmapChart,
} from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  VisualMapComponent,
  GraphicComponent,
  RadarComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

import type { SeriesData, ReductionConfig, ChartType } from './charts/ChartRegistry'
import { buildOption } from './charts/ChartRegistry'

// 副作用导入：触发所有图表类型的自注册
import './charts'

// ── 注册 ECharts 组件（树摇优化） ─────────────────────────

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GaugeChart,
  RadarChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  VisualMapComponent,
  GraphicComponent,
  RadarComponent,
  CanvasRenderer,
])

// ── 公开常量 ──────────────────────────────────────────────

/** 10 色调色板（Apple 系统色风格） */
export const COLORS = [
  '#007AFF', '#FF9500', '#34C759', '#FF3B30', '#AF52DE',
  '#5856D6', '#00C7BE', '#FF2D55', '#8E8E93', '#007AFF',
]

// ── 向后兼容类型映射 ─────────────────────────────────────

type OldChartType = 'trend' | 'comparison'

/** 旧图表类型 → 新图表类型映射 */
const LEGACY_MAP: Record<OldChartType, ChartType> = {
  trend: 'line',
  comparison: 'bar',
}

function isLegacyType(type: string): type is OldChartType {
  return type === 'trend' || type === 'comparison'
}

// ── 兼容旧数据格式 ────────────────────────────────────────

interface LegacyDataShape {
  series?: SeriesData[]
}

function normalizeData(
  raw: SeriesData[] | LegacyDataShape
): SeriesData[] {
  if (Array.isArray(raw)) return raw
  return raw.series ?? []
}

// ── Props ─────────────────────────────────────────────────

interface Props {
  /** 图表类型（支持新旧两种） */
  chartType: ChartType | OldChartType
  /** 数据（兼容旧的 { series } 包裹格式） */
  data: SeriesData[] | LegacyDataShape
  /** 降载配置 */
  reduction?: ReductionConfig
  /** 图表高度（默认 400） */
  height?: number
}

// ── 组件 ──────────────────────────────────────────────────

function ChartRenderer({
  chartType,
  data,
  reduction,
  height = 400,
}: Props) {
  const mappedType: ChartType = isLegacyType(chartType)
    ? LEGACY_MAP[chartType]
    : chartType

  const normalizedData = normalizeData(data)

  if (
    !normalizedData ||
    normalizedData.length === 0 ||
    normalizedData.every((s) => s.data.length === 0)
  ) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
        暂无数据
      </div>
    )
  }

  const option = buildOption(mappedType, normalizedData, reduction)

  if (!option) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
        暂不支持的图表类型: {mappedType}
      </div>
    )
  }

  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      style={{ height }}
      notMerge
    />
  )
}

export default ChartRenderer
