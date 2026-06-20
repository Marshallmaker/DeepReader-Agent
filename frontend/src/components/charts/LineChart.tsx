/**
 * LineChart — 折线图
 *
 * 适用条件：数值指标 >= 1 且报告 >= 2
 * X 轴：fiscal_year（去重排序），label 旋转 30°
 * 异常数据点以红色标注
 */

import * as ChartRegistry from './ChartRegistry'
import type { ChartTypeConfig, SeriesData, ReductionConfig } from './ChartRegistry'
import type { EChartsOption } from 'echarts'

const SERIES_COLORS = [
  '#007AFF', '#FF9500', '#34C759', '#FF3B30', '#AF52DE',
  '#5856D6', '#00C7BE', '#FF2D55', '#8E8E93', '#007AFF',
]

const config: ChartTypeConfig = {
  type: 'line',
  name: '折线图',
  isApplicable: (metrics, reports) => metrics.length >= 1 && reports.length >= 2,
  buildOption: (data: SeriesData[], reduction?: ReductionConfig): EChartsOption => {
    const topN = reduction?.topN ?? 20

    // 收集所有 fiscal_year，去重并排序
    const allYearsRaw = [
      ...new Set<string>(
        data.flatMap((s) => s.data.map((d) => d.fiscal_year).filter((v): v is string => !!v))
      ),
    ]
    allYearsRaw.sort()
    const allYears = allYearsRaw.slice(0, topN)

    const series = data.map((s, i) => {
      const color = SERIES_COLORS[i % SERIES_COLORS.length]
      return {
        name: s.metric_label,
        type: 'line' as const,
        smooth: true,
        symbolSize: 6,
        lineStyle: { color, width: 2 },
        itemStyle: { color },
        data: allYears.map((year) => {
          const point = s.data.find((d) => d.fiscal_year === year)
          if (!point || point.value == null) return null
          if (point.is_anomaly) {
            return {
              value: point.value,
              itemStyle: { color: '#FF3B30', borderColor: '#FF3B30', borderWidth: 2 },
              symbolSize: 12,
            }
          }
          return point.value
        }),
      }
    })

    return {
      tooltip: { trigger: 'axis' as const },
      legend: { data: data.map((s) => s.metric_label), top: 0 },
      xAxis: {
        type: 'category' as const,
        data: allYears,
        axisLabel: { rotate: 30 },
      },
      yAxis: { type: 'value' as const },
      series,
      grid: { left: '10%', right: '8%', bottom: '15%', top: '12%' },
    }
  },
  defaultReduction: { defaultTopN: 20, pageSize: 0, aggregateGranularity: 'month' },
}

ChartRegistry.register(config)
export default config
