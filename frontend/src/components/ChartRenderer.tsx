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

import type { SeriesData, ReductionConfig, ChartType, ReductionStrategy } from './charts/ChartRegistry'
import { buildOption, get } from './charts/ChartRegistry'
import { useDataReducer } from '../hooks/useDataReducer'

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

  // ── 降载策略 ─────────────────────────────────────────────────
  const strategy: ReductionStrategy = get(mappedType)?.defaultReduction ?? {
    defaultTopN: 15,
    pageSize: 8,
  }

  const { reducedData, controls, stats } = useDataReducer(normalizedData, strategy)

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

  const option = buildOption(mappedType, reducedData, reduction)

  if (!option) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
        暂不支持的图表类型: {mappedType}
      </div>
    )
  }

  return (
    <>
      {stats.hasReduction && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            padding: '8px 0',
            fontSize: 13,
          }}
        >
          {/* Top-N 选择器 */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            Top-N:
            <select
              value={controls.topN}
              onChange={(e) => controls.setTopN(Number(e.target.value))}
              style={{ fontSize: 13 }}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={0}>全部</option>
            </select>
          </label>

          {/* 聚合粒度选择器 */}
          {strategy.aggregateGranularity && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              聚合:
              <select
                value={controls.granularity ?? ''}
                onChange={(e) =>
                  controls.setGranularity(
                    e.target.value
                      ? (e.target.value as 'day' | 'month' | 'quarter')
                      : null
                    )
                  }
                style={{ fontSize: 13 }}
              >
                <option value="">不聚合</option>
                <option value="day">按日</option>
                <option value="month">按月</option>
                <option value="quarter">按季度</option>
              </select>
            </label>
          )}

          {/* 异常优先复选框 */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="checkbox"
              checked={controls.anomalyFirst}
              onChange={(e) => controls.setAnomalyFirst(e.target.checked)}
            />
            异常优先
          </label>

          {/* 分页控件 */}
          {controls.totalPages > 1 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                disabled={controls.page <= 1}
                onClick={() => controls.setPage(controls.page - 1)}
                style={{ fontSize: 13, cursor: controls.page <= 1 ? 'not-allowed' : 'pointer' }}
              >
                上一页
              </button>
              <span>
                {controls.page}/{controls.totalPages}
              </span>
              <button
                disabled={controls.page >= controls.totalPages}
                onClick={() => controls.setPage(controls.page + 1)}
                style={{ fontSize: 13, cursor: controls.page >= controls.totalPages ? 'not-allowed' : 'pointer' }}
              >
                下一页
              </button>
            </span>
          )}

          {/* 降载统计文本 */}
          <span style={{ color: '#faad14' }}>
            ⚠️ 已智能降载: 展示 {stats.shown}/{stats.total} 条，隐藏 {stats.hidden} 条普通数据
          </span>
        </div>
      )}
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ height }}
        notMerge
      />
    </>
  )
}

export default ChartRenderer
