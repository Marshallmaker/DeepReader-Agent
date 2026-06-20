/**
 * BarChart — 柱状图
 *
 * 适用条件：数值指标 >= 1 且报告 >= 1
 * X 轴：report_name（超过 18 字截断，旋转 45°）
 * 异常柱以红色标注，支持 dataZoom 分页
 */

import * as ChartRegistry from './ChartRegistry'
import type { ChartTypeConfig, SeriesData, ReductionConfig } from './ChartRegistry'
import type { EChartsOption } from 'echarts'

const SERIES_COLORS = [
  '#007AFF', '#FF9500', '#34C759', '#FF3B30', '#AF52DE',
  '#5856D6', '#00C7BE', '#FF2D55', '#8E8E93', '#007AFF',
]

const config: ChartTypeConfig = {
  type: 'bar',
  name: '柱状图',
  isApplicable: (metrics, reports) => metrics.length >= 1 && reports.length >= 1,
  buildOption: (data: SeriesData[], reduction?: ReductionConfig): EChartsOption => {
    const topN = reduction?.topN ?? 15
    const pageSize = reduction?.pageSize ?? 8

    // 收集所有报告名称
    const allNames = [
      ...new Set(
        data
          .flatMap((s) =>
            s.data.map((d) => d.report_name || d.entity_name || '')
          )
          .filter(Boolean)
      ),
    ]
    const displayNames = allNames.slice(0, topN)
    const totalItems = displayNames.length
    const visibleEnd = totalItems > 0 ? Math.min(pageSize / totalItems, 1) * 100 : 100

    const series = data.map((s, i) => {
      const color = SERIES_COLORS[i % SERIES_COLORS.length]
      return {
        name: s.metric_label,
        type: 'bar' as const,
        itemStyle: {
          color,
          borderRadius: [4, 4, 0, 0] as [number, number, number, number],
        },
        data: displayNames.map((name) => {
          const point = s.data.find(
            (d) => (d.report_name || d.entity_name) === name
          )
          if (!point || point.value == null) return null
          if (point.is_anomaly) {
            return {
              value: point.value,
              itemStyle: {
                color: '#FF3B30',
                borderRadius: [4, 4, 0, 0] as [number, number, number, number],
              },
            }
          }
          return point.value
        }),
      }
    })

    const option: EChartsOption = {
      tooltip: { trigger: 'axis' as const },
      legend: { data: data.map((s) => s.metric_label), top: 0 },
      xAxis: {
        type: 'category' as const,
        data: displayNames.map((n) =>
          n.length > 18 ? n.slice(0, 18) + '...' : n
        ),
        axisLabel: { rotate: 45, fontSize: 11 },
      },
      yAxis: { type: 'value' as const },
      series,
      grid: { left: '10%', right: '8%', bottom: '20%', top: '12%' },
    }

    // 当数据量超过 pageSize 时启用 dataZoom 分页
    if (totalItems > pageSize) {
      option.dataZoom = [
        {
          type: 'slider' as const,
          start: 0,
          end: visibleEnd,
        },
      ]
    }

    return option
  },
  defaultReduction: { defaultTopN: 15, pageSize: 8 },
}

ChartRegistry.register(config)
export default config
