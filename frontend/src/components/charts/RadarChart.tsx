/**
 * RadarChart — 雷达图
 *
 * 适用条件：数值指标 3-10 且报告 1-5
 * 形状：polygon，指标值归一化到 0-100
 * 最多 5 条报告线，每条不同颜色
 */

import * as ChartRegistry from './ChartRegistry'
import type { ChartTypeConfig, SeriesData, ReductionConfig } from './ChartRegistry'
import type { EChartsOption } from 'echarts'

const LINE_COLORS = [
  '#007AFF', '#FF9500', '#34C759', '#FF3B30', '#AF52DE',
]

const config: ChartTypeConfig = {
  type: 'radar',
  name: '雷达图',
  isApplicable: (metrics, reports) =>
    metrics.length >= 3 && metrics.length <= 10 &&
    reports.length >= 1 && reports.length <= 5,
  buildOption: (data: SeriesData[], reduction?: ReductionConfig): EChartsOption => {
    const topN = Math.min(reduction?.topN ?? 10, 10)
    const metrics = data.slice(0, topN)

    if (metrics.length === 0) {
      return { series: [] }
    }

    // 收集所有唯一报告名
    const reportNames = [
      ...new Set(
        data
          .flatMap((s) =>
            s.data.map((d) => d.report_name || d.entity_name || '')
          )
          .filter(Boolean)
      ),
    ]
    const maxReports = Math.min(reportNames.length, 5)

    // 计算每个指标的最大值用于归一化
    const metricMaxes = metrics.map((s) => {
      let max = 0
      for (const d of s.data) {
        if (d.value != null && d.value > max) max = d.value
      }
      return max || 1
    })

    // 指示器（雷达轴），归一化到 100
    const indicators = metrics.map((s) => ({
      name:
        s.metric_label.length > 8
          ? s.metric_label.slice(0, 8) + '...'
          : s.metric_label,
      max: 100,
    }))

    // 每条报告一条 Radar 线
    const series = reportNames.slice(0, maxReports).map((reportName, ri) => {
      const color = LINE_COLORS[ri % LINE_COLORS.length]
      const values = metrics.map((s, mi) => {
        const point = s.data.find(
          (d) => (d.report_name || d.entity_name) === reportName
        )
        if (!point || point.value == null) return 0
        return parseFloat(
          ((point.value / metricMaxes[mi]) * 100).toFixed(1)
        )
      })

      return {
        name: reportName,
        type: 'radar' as const,
        data: [{ value: values, name: reportName }],
        lineStyle: { color, width: 2 },
        itemStyle: { color },
        symbolSize: 6,
        areaStyle: { color: `${color}20` },
      }
    })

    return {
      tooltip: {},
      legend: {
        data: reportNames.slice(0, maxReports),
        top: 0,
      },
      radar: {
        indicator: indicators,
        shape: 'polygon' as const,
        center: ['50%', '55%'],
        radius: '65%',
        splitArea: {
          areaStyle: {
            color: ['rgba(0, 122, 255, 0.05)', 'rgba(0, 122, 255, 0.02)'],
          },
        },
      },
      series,
    }
  },
  defaultReduction: { defaultTopN: 10, pageSize: 0 },
}

ChartRegistry.register(config)
export default config
