/**
 * BarChart — 柱状图
 *
 * 适用条件：数值指标 >= 1 且报告 >= 1
 * X 轴：report_name（超过 18 字截断，旋转 45°）
 * 异常柱以红色标注，支持 dataZoom 分页
 */

import * as ChartRegistry from './ChartRegistry'
import type { ChartTypeConfig, SeriesData, ReductionConfig, DataPoint } from './ChartRegistry'
import { buildYAxis, assignYAxisIndex, COLORS, ANOMALY_COLORS, formatAnomalyTooltip } from './ChartRegistry'
import type { EChartsOption } from 'echarts'

const config: ChartTypeConfig = {
  type: 'bar',
  name: '柱状图',
  isApplicable: (metrics, reports) => metrics.length >= 1 && reports.length >= 1,
  buildOption: (data: SeriesData[], reduction?: ReductionConfig): EChartsOption => {
    const topN = reduction?.topN ?? 50
    const pageSize = reduction?.pageSize ?? 0

    // 收集所有报告名称（优先 report_name 确保唯一性，缺失时回退 entity_name），去重后排序
    const rawNames = [
      ...new Set(
        data
          .flatMap((s) =>
            s.data.map((d) => d.report_name || d.entity_name || '')
          )
          .filter(Boolean)
      ),
    ].sort()

    // 防御性：对重名追加序号区分（如多份报告 entity_name 相同但 report_name 也相同的情况）
    const seen = new Map<string, number>()
    const displayNames = rawNames.slice(0, topN).map((name) => {
      const count = seen.get(name) || 0
      seen.set(name, count + 1)
      return count === 0 ? name : `${name} (${count + 1})`
    })
    const totalItems = displayNames.length

    const yAxisIndices = assignYAxisIndex(data)

    const series = data.map((s, i) => {
      const color = COLORS[i % COLORS.length]
      return {
        name: s.metric_label,
        type: 'bar' as const,
        yAxisIndex: yAxisIndices[i],
        itemStyle: {
          color,
          borderRadius: [4, 4, 0, 0] as [number, number, number, number],
        },
        data: displayNames.map((name, idx) => {
          // 匹配时也用 report_name 优先，与名称收集逻辑一致
          const rawName = rawNames[idx] ?? name
          const point = s.data.find(
            (d) => (d.report_name || d.entity_name) === rawName
          )
          if (!point || point.value == null) return null
          if (point.is_anomaly) {
            const anomalyColor = ANOMALY_COLORS[point.anomaly_direction || ''] || '#FF3B30'
            return {
              value: point.value,
              itemStyle: {
                color: anomalyColor,
                borderRadius: [4, 4, 0, 0] as [number, number, number, number],
              },
              _dp: point,
            }
          }
          return point.value
        }),
      }
    })

    const option: EChartsOption = {
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
      legend: {
        data: data.map((s) => s.metric_label),
        top: 0,
        type: data.length > 5 ? 'scroll' as const : 'plain' as const,
      },
      xAxis: {
        type: 'category' as const,
        data: displayNames.map((n) =>
          n.length > 18 ? n.slice(0, 18) + '...' : n
        ),
        axisLabel: { rotate: 40, fontSize: 10 },
      },
      yAxis: buildYAxis(data),
      series,
      grid: { left: '10%', right: '8%', bottom: '20%', top: '18%' },
    }

    // 仅在无分页（pageSize == 0）时启用 dataZoom 滚动条，
    // 有分页时由 ChartRenderer 的外部翻页控件接管，避免双层交互冲突
    if (pageSize === 0 && totalItems > 15) {
      option.dataZoom = [
        {
          type: 'slider' as const,
          start: 0,
          end: Math.min(15 / totalItems, 1) * 100,
        },
      ]
    }

    return option
  },
  defaultReduction: { defaultTopN: 50, pageSize: 0 },
}

ChartRegistry.register(config)
export default config
