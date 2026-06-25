/**
 * LineChart — 折线图
 *
 * 适用条件：数值指标 >= 1 且报告 >= 2
 *
 * 双模式自动检测：
 * - 趋势模式：数据含 fiscal_year → X 轴按时间排序，支持聚合降载
 * - 对比模式：数据含 report_name → X 轴为报告名（用于单指标跨报告对比）
 *
 * 异常数据点以红色标注
 */

import * as ChartRegistry from './ChartRegistry'
import type { ChartTypeConfig, SeriesData, ReductionConfig, DataPoint } from './ChartRegistry'
import { buildYAxis, assignYAxisIndex, COLORS, ANOMALY_COLORS, formatAnomalyTooltip } from './ChartRegistry'
import type { EChartsOption } from 'echarts'

const config: ChartTypeConfig = {
  type: 'line',
  name: '折线图',
  isApplicable: (metrics, reports) => metrics.length >= 1 && reports.length >= 2,
  buildOption: (data: SeriesData[], reduction?: ReductionConfig): EChartsOption => {
    const topN = reduction?.topN ?? 50

    // 自动检测数据模式：所有 series 均有至少一个 fiscal_year → 趋势，否则 → 对比
    // 逐 series 检测以避免混合数据模式下静默丢失数据点
    const hasFiscalYear = data.every((s) => s.data.some((d) => !!d.fiscal_year))

    if (!hasFiscalYear) {
      // ── 对比模式（X 轴 = 报告名，用于单指标跨报告对比）────────────
      // X 轴优先使用 report_name（唯一文件名），缺失时回退 entity_name
      const rawNames = [
        ...new Set(
          data
            .flatMap((s) =>
              s.data.map((d) => d.report_name || d.entity_name || '')
            )
            .filter(Boolean)
        ),
      ].sort()

      // 防御性：对重名追加序号区分
      const seen = new Map<string, number>()
      const displayNames = rawNames.slice(0, topN).map((name) => {
        const count = seen.get(name) || 0
        seen.set(name, count + 1)
        return count === 0 ? name : `${name} (${count + 1})`
      })

      const yAxisIndices = assignYAxisIndex(data)

      const series = data.map((s, i) => {
        const color = COLORS[i % COLORS.length]
        return {
          name: s.metric_label,
          type: 'line' as const,
          yAxisIndex: yAxisIndices[i],
          smooth: true,
          symbolSize: 8,
          lineStyle: { color, width: 2 },
          itemStyle: { color },
          data: displayNames.map((name, idx) => {
            const rawName = rawNames[idx] ?? name
            const point = s.data.find(
              (d) => (d.report_name || d.entity_name) === rawName
            )
            if (!point || point.value == null) return null
            if (point.is_anomaly) {
              const anomalyColor = ANOMALY_COLORS[point.anomaly_direction || ''] || '#FF3B30'
              return {
                value: point.value,
                itemStyle: { color: anomalyColor, borderColor: anomalyColor, borderWidth: 2 },
                symbolSize: 14,
                _dp: point,
              }
            }
            return point.value
          }),
        }
      })

      return {
        tooltip: {
          trigger: 'axis' as const,
          formatter: (params: any) => {
            if (!Array.isArray(params)) params = [params]
            let html = ''
            for (const p of params) {
              const rawData = typeof p.data === 'object' ? p.data : null
              const val = rawData?.value ?? p.data
              const dp: DataPoint | undefined = rawData?._dp
              html += `<div>${p.marker} ${p.seriesName}: ${val != null ? val : '-'}</div>`
              if (dp) html += formatAnomalyTooltip(dp)
            }
            return html
          },
        },
        xAxis: {
          type: 'category' as const,
          data: displayNames.map((n) =>
            n.length > 18 ? n.slice(0, 18) + '...' : n
          ),
          axisLabel: { rotate: 25, fontSize: 11 },
        },
        yAxis: buildYAxis(data),
        series,
        grid: { left: '10%', right: '8%', bottom: '18%', top: '18%' },
        legend: {
          data: data.map((s) => s.metric_label),
          top: 0,
          type: data.length > 6 ? 'scroll' as const : 'plain' as const,
        },
      }
    }

    // ── 趋势模式（X 轴 = fiscal_year，原逻辑保持不变）────────────
    // 收集所有 fiscal_year，去重并按字符串字典序排序
    // 空 fiscal_year 回退到 report_name，避免数据点被静默丢弃
    const allYearsRaw = [
      ...new Set<string>(
        data.flatMap((s) => s.data.map((d) => d.fiscal_year || d.report_name || '未知').filter(Boolean))
      ),
    ]
    allYearsRaw.sort()
    const allYears = allYearsRaw.slice(0, topN)

    const yAxisIndices = assignYAxisIndex(data)

    const series = data.map((s, i) => {
      const color = COLORS[i % COLORS.length]
      return {
        name: s.metric_label,
        type: 'line' as const,
        yAxisIndex: yAxisIndices[i],
        smooth: true,
        symbolSize: 6,
        lineStyle: { color, width: 2 },
        itemStyle: { color },
        data: allYears.map((year) => {
          const point = s.data.find((d) => d.fiscal_year === year)
          if (!point || point.value == null) return null
          if (point.is_anomaly) {
            const anomalyColor = ANOMALY_COLORS[point.anomaly_direction || ''] || '#FF3B30'
            return {
              value: point.value,
              itemStyle: { color: anomalyColor, borderColor: anomalyColor, borderWidth: 2 },
              symbolSize: 12,
              _dp: point,
            }
          }
          return point.value
        }),
      }
    })

    return {
      tooltip: {
        trigger: 'axis' as const,
        formatter: (params: any) => {
          if (!Array.isArray(params)) params = [params]
          let html = ''
          for (const p of params) {
            const rawData = typeof p.data === 'object' ? p.data : null
            const val = rawData?.value ?? p.data
            const dp: DataPoint | undefined = rawData?._dp
            html += `<div>${p.marker} ${p.seriesName}: ${val != null ? val : '-'}</div>`
            if (dp) html += formatAnomalyTooltip(dp)
          }
          return html
        },
      },
      xAxis: {
        type: 'category' as const,
        data: allYears,
        axisLabel: { rotate: 25, fontSize: 11 },
      },
      yAxis: buildYAxis(data),
      series,
      grid: { left: '10%', right: '8%', bottom: '18%', top: '18%' },
      legend: { data: data.map((s) => s.metric_label), top: 0, type: data.length > 6 ? 'scroll' as const : 'plain' as const },
    }
  },
  defaultReduction: { defaultTopN: 50, pageSize: 0, aggregateGranularity: 'month' },
}

ChartRegistry.register(config)
export default config
