/**
 * RadarChart — 雷达图
 *
 * 适用条件：数值指标 >= 3 且报告 >= 1
 * 形状：polygon，指标值归一化到 0-100
 * 内部限制：最多取前 10 个指标、前 5 条报告线（通过 Top-N 控件可调整）
 */

import * as ChartRegistry from './ChartRegistry'
import type { ChartTypeConfig, SeriesData, ReductionConfig, DataPoint } from './ChartRegistry'
import { ANOMALY_COLORS, formatAnomalyTooltip } from './ChartRegistry'
import type { EChartsOption } from 'echarts'

const LINE_COLORS = [
  '#007AFF', '#FF9500', '#34C759', '#FF3B30', '#AF52DE',
  '#5856D6', '#00C7BE', '#FF2D55',
]

const config: ChartTypeConfig = {
  type: 'radar',
  name: '雷达图',
  isApplicable: (metrics, reports) =>
    metrics.length >= 3 && reports.length >= 1,
  buildOption: (data: SeriesData[], reduction?: ReductionConfig): EChartsOption => {
    const metricTopN = reduction?.topN ?? 10
    const metrics = data.slice(0, metricTopN)

    if (metrics.length === 0) {
      return { series: [] }
    }

    // 收集所有唯一报告名（优先 entity_name 显示公司名，回退到 report_name）
    const rawNames = [
      ...new Set(
        data
          .flatMap((s) =>
            s.data.map((d) => d.entity_name || d.report_name || '')
          )
          .filter(Boolean)
      ),
    ]

    // 防御性：对重名追加序号区分
    const seen = new Map<string, number>()
    const uniqueNames = rawNames.map((name) => {
      const count = seen.get(name) || 0
      seen.set(name, count + 1)
      return count === 0 ? name : `${name} (${count + 1})`
    })
    const maxReports = Math.min(uniqueNames.length, 8)

    // 计算每个指标的最大值用于归一化（排除 null/0，至少为 1 避免除零）
    const metricMaxes = metrics.map((s) => {
      let max = 0
      for (const d of s.data) {
        if (d.value != null && d.value > max) max = d.value
      }
      return max || 1
    })

    // 指示器（雷达轴），归一化到 100，标签放宽到 12 字
    const indicators = metrics.map((s) => ({
      name:
        s.metric_label.length > 12
          ? s.metric_label.slice(0, 12) + '...'
          : s.metric_label,
      max: 100,
    }))

    // 辅助函数：从数据点数组中获取指定报告的最新值（按 fiscal_year 降序）
    const getLatestPoint = (
      dataPoints: DataPoint[],
      targetName: string
    ): DataPoint | undefined => {
      const matches = dataPoints.filter(
        (d) => (d.entity_name || d.report_name) === targetName && d.value != null
      )
      if (matches.length === 0) return undefined
      if (matches.length === 1) return matches[0]
      // 按 fiscal_year 降序排列，取最新数据点
      return matches.sort((a, b) =>
        (b.fiscal_year || '').localeCompare(a.fiscal_year || '')
      )[0]
    }

    // 每条报告一条 Radar 线
    const series = uniqueNames.slice(0, maxReports).map((displayName, ri) => {
      const rawName = rawNames[ri] ?? displayName
      const shortName = displayName.length > 20 ? displayName.slice(0, 20) + '...' : displayName
      const color = LINE_COLORS[ri % LINE_COLORS.length]
      // 异常标记映射：{metricIndex: DataPoint}
      const anomalyFlags: Record<number, DataPoint> = {}
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const values: any[] = metrics.map((s, mi) => {
        const point = getLatestPoint(s.data, rawName)
        // 缺失数据返回 null，ECharts 雷达图将其渲染为断点而非 0 分
        if (!point || point.value == null) return null
        const normalizedValue = parseFloat(
          ((point.value / metricMaxes[mi]) * 100).toFixed(1)
        )
        // 异常数据点：使用对象格式以支持 itemStyle
        if (point.is_anomaly) {
          anomalyFlags[mi] = point
          const anomalyColor = ANOMALY_COLORS[point.anomaly_direction || ''] || '#FF3B30'
          return {
            value: normalizedValue,
            itemStyle: { color: anomalyColor, borderColor: anomalyColor, borderWidth: 2 },
            symbolSize: 12,
            _dp: point,
          }
        }
        return normalizedValue
      })

      return {
        name: shortName,
        type: 'radar' as const,
        data: [{ value: values, name: displayName, _anomalyFlags: anomalyFlags }] as any[],
        lineStyle: { color, width: 2 },
        itemStyle: { color },
        symbolSize: 6,
        areaStyle: { color: `${color}20` },
      }
    })

    return {
      tooltip: {
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params
          if (!p) return ''
          let html = `<div style="font-weight:bold;margin-bottom:4px;">${p.name}</div>`
          if (Array.isArray(p.value)) {
            p.value.forEach((item: any, idx: number) => {
              const val = typeof item === 'object' && item !== null ? item.value : item
              const metricLabel = indicators[idx]?.name || `指标${idx + 1}`
              const dp: DataPoint | undefined =
                typeof item === 'object' && item !== null ? item._dp : undefined
              html += `<div>${p.marker} ${metricLabel}: ${val != null ? val + '%' : '-'}</div>`
              if (dp) html += formatAnomalyTooltip(dp)
            })
          }
          return html
        },
      },
      legend: {
        data: uniqueNames.slice(0, maxReports).map(
          (n) => (n.length > 20 ? n.slice(0, 20) + '...' : n)
        ),
        bottom: 0,
        type: 'scroll' as const,
        textStyle: { fontSize: 11 },
      },
      radar: {
        indicator: indicators,
        shape: 'polygon' as const,
        center: ['50%', '50%'],
        radius: '58%',
        splitArea: {
          areaStyle: {
            color: ['rgba(0, 122, 255, 0.05)', 'rgba(0, 122, 255, 0.02)'],
          },
        },
      },
      series,
    }
  },
  defaultReduction: { defaultTopN: 0, pageSize: 0 },
}

ChartRegistry.register(config)
export default config
