/**
 * HeatmapChart — 热力图
 *
 * 适用条件：数值指标 >= 4 或报告 >= 10
 * X 轴：指标，Y 轴：报告名
 * visualMap：浅绿 → 深蓝渐变，支持 dataZoom 分页
 */

import * as ChartRegistry from './ChartRegistry'
import type { ChartTypeConfig, SeriesData, ReductionConfig, DataPoint } from './ChartRegistry'
import { ANOMALY_COLORS, formatAnomalyTooltip } from './ChartRegistry'
import type { EChartsOption } from 'echarts'

const config: ChartTypeConfig = {
  type: 'heatmap',
  name: '热力图',
  isApplicable: (metrics, reports) => metrics.length >= 4 || reports.length >= 10,
  buildOption: (data: SeriesData[], reduction?: ReductionConfig): EChartsOption => {
    const topN = reduction?.topN ?? 20
    const pageSize = reduction?.pageSize ?? 10

    const metrics = data
    const reportNames = [
      ...new Set(
        data
          .flatMap((s) =>
            s.data.map((d) => d.entity_name || d.report_name || '')
          )
          .filter(Boolean)
      ),
    ]
    const displayReports = reportNames.slice(0, topN)

    // 构建热力图数据：异常单元格使用对象格式以支持 itemStyle
    const heatData: Array<{
      value: [number, number, number]
      itemStyle?: Record<string, unknown>
      _dp?: DataPoint
    }> = []
    for (let mi = 0; mi < metrics.length; mi++) {
      for (let ri = 0; ri < displayReports.length; ri++) {
        const point = metrics[mi].data.find(
          (d) =>
            (d.entity_name || d.report_name) === displayReports[ri]
        )
        if (point && point.value != null) {
          const entry: any = { value: [mi, ri, point.value] as [number, number, number] }
          if (point.is_anomaly) {
            const anomalyColor =
              ANOMALY_COLORS[point.anomaly_direction || ''] || '#FF3B30'
            entry.itemStyle = {
              borderColor: anomalyColor,
              borderWidth: 3,
            }
            entry._dp = point
          }
          heatData.push(entry)
        }
      }
    }

    // 提取纯数值用于 visualMap 最大值计算
    const rawValues = heatData.map((d) => d.value[2])
    const dataMax =
      rawValues.length > 0 ? Math.max(...rawValues, 1) : 100

    const totalItems = displayReports.length
    const visibleEnd =
      totalItems > 0 ? Math.min(pageSize / totalItems, 1) * 100 : 100

    const option: EChartsOption = {
      tooltip: {
        position: 'top' as const,
        formatter: (params: any) => {
          const dp: DataPoint | undefined = params.data?._dp
          const val = params.data?.value?.[2] ?? params.value?.[2] ?? params.value
          const mi = params.data?.value?.[0] ?? params.value?.[0]
          const ri = params.data?.value?.[1] ?? params.value?.[1]
          const metricName = metrics[mi]?.metric_label || `指标${mi}`
          const reportName = displayReports[ri] || `报告${ri}`
          let html = `${reportName}<br/>${metricName}: ${val != null ? val : '-'}`
          if (dp) html += formatAnomalyTooltip(dp)
          return html
        },
      },
      grid: { left: '24%', right: '10%', bottom: '20%', top: '5%' },
      xAxis: {
        type: 'category' as const,
        data: metrics.map((s) => s.metric_label),
        axisLabel: {
          rotate: 45,
          fontSize: 11,
          interval: 0,
        },
        splitArea: { show: true },
      },
      yAxis: {
        type: 'category' as const,
        data: displayReports.map((n) =>
          n.length > 15 ? n.slice(0, 15) + '...' : n
        ),
        axisLabel: {
          fontSize: 11,
          overflow: 'truncate',
          width: 140,
        },
        splitArea: { show: true },
      },
      visualMap: {
        min: 0,
        max: dataMax,
        calculable: true,
        orient: 'horizontal' as const,
        left: 'center',
        bottom: 0,
        inRange: {
          color: [
            '#e8f5e9', '#c8e6c9', '#a5d6a7', '#b2dfdb',
            '#80cbc4', '#64b5f6', '#42a5f5', '#1e88e5',
            '#1976d2', '#1565c0',
          ],
        },
      },
      series: [
        {
          type: 'heatmap' as const,
          data: heatData,
          label: { show: false },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0, 0, 0, 0.5)',
            },
          },
        },
      ],
    }

    // 当报告数超过 pageSize 时启用 dataZoom 纵向分页
    if (totalItems > pageSize) {
      option.dataZoom = [
        {
          type: 'slider' as const,
          yAxisIndex: 0,
          start: 0,
          end: visibleEnd,
        },
      ]
    }

    return option
  },
  defaultReduction: { defaultTopN: 20, pageSize: 10 },
}

ChartRegistry.register(config)
export default config
