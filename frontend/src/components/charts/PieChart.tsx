/**
 * PieChart — 环形图（Donut）
 *
 * 适用条件：数值指标 == 1 且报告 >= 2
 * 半径 [40%, 70%]，中心显示总计
 * Top 8 + "其他"合并，异常扇区红色边框
 */

import * as ChartRegistry from './ChartRegistry'
import type { ChartTypeConfig, SeriesData, ReductionConfig, DataPoint } from './ChartRegistry'
import { ANOMALY_COLORS, formatAnomalyTooltip } from './ChartRegistry'
import type { EChartsOption } from 'echarts'

const SECTOR_COLORS = [
  '#007AFF', '#FF9500', '#34C759', '#AF52DE', '#5856D6',
  '#00C7BE', '#FF2D55', '#8E8E93', '#FF3B30', '#007AFF',
]

const config: ChartTypeConfig = {
  type: 'pie',
  name: '环形图',
  isApplicable: (metrics, _reports) => metrics.length === 1 && _reports.length >= 2,
  buildOption: (data: SeriesData[], reduction?: ReductionConfig): EChartsOption => {
    const topN = reduction?.topN ?? 8
    const firstSeries = data[0]
    if (!firstSeries || firstSeries.data.length === 0) {
      // 返回空环形图 + 居中提示文字，比纯白圆环更友好
      return {
        series: [{ type: 'pie', data: [], radius: ['40%', '65%'] }],
        graphic: {
          type: 'text',
          left: 'center',
          top: 'center',
          style: { text: '暂无数据', fontSize: 16, fill: '#999' },
        } as any,
      }
    }

    // 按 value 降序排列（过滤 null）
    const points = [...firstSeries.data]
      .filter((d) => d.value != null)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

    // 计算总计
    const total = points.reduce((sum, d) => sum + (d.value ?? 0), 0)

    const topItems = points.slice(0, topN)
    const otherItems = points.slice(topN)
    const otherSum = otherItems.reduce((sum, d) => sum + (d.value ?? 0), 0)

    const pieData: Array<{
      value: number
      name: string
      itemStyle: Record<string, unknown>
      _dp?: DataPoint
    }> = topItems.map((d, idx) => {
      const anomalyColor = d.is_anomaly
        ? (ANOMALY_COLORS[d.anomaly_direction || ''] || '#FF3B30')
        : '#fff'
      return {
        value: d.value as number,
        name: d.report_name || d.entity_name || `项目${idx + 1}`,
        itemStyle: d.is_anomaly
          ? { borderColor: anomalyColor, borderWidth: 3 }
          : { borderColor: '#fff', borderWidth: 2 },
        _dp: d.is_anomaly ? d : undefined,
      }
    })

    if (otherItems.length > 0) {
      pieData.push({
        value: otherSum,
        name: '其他',
        itemStyle: { color: '#C8C8C8', borderColor: '#fff', borderWidth: 2 },
      })
    }

    const option: EChartsOption = {
      tooltip: {
        trigger: 'item' as const,
        formatter: (params: any) => {
          const dp: DataPoint | undefined = params.data?._dp
          let html = `${params.marker} ${params.name}: ${params.value} (${params.percent}%)`
          if (dp) html += formatAnomalyTooltip(dp)
          return html
        },
      },
      legend: { top: 0 },
      color: SECTOR_COLORS,
      series: [
        {
          type: 'pie',
          radius: ['40%', '70%'],
          center: ['50%', '55%'],
          label: { show: true, formatter: '{b}: {d}%' },
          emphasis: {
            label: { fontSize: 16, fontWeight: 'bold' as const },
          },
          data: pieData,
        },
      ],
    }

    // 中心显示总计
    if (total > 0) {
      option.graphic = [
        {
          type: 'text' as const,
          left: 'center',
          top: '45%',
          style: {
            text: `总计\n${total.toLocaleString()}`,
            textAlign: 'center' as const,
            fill: '#333',
            fontSize: 14,
            fontWeight: 'bold' as const,
          },
        } as unknown as EChartsOption['graphic'],
      ] as EChartsOption['graphic']
    }

    return option
  },
  defaultReduction: { defaultTopN: 8, pageSize: 0 },
}

ChartRegistry.register(config)
export default config
