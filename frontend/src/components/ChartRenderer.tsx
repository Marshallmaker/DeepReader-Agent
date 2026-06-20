import ReactECharts from 'echarts-for-react'
import type { MultiSeriesTrendResponse, MultiSeriesComparisonResponse } from '../services/visualizationService'

interface Props {
  chartType: 'trend' | 'comparison'
  data: MultiSeriesTrendResponse | MultiSeriesComparisonResponse
}

/** 10 色调色板（Apple 系统色） */
const SERIES_COLORS = [
  '#007AFF', '#FF9500', '#34C759', '#FF3B30', '#AF52DE',
  '#5856D6', '#00C7BE', '#FF2D55', '#8E8E93', '#007AFF',
]

// Y 轴标签颜色
const AXIS_COLORS = ['#007AFF', '#FF3B30', '#34C759']

/** 量级聚类：将数值范围差异过大的系列分到不同 Y 轴组 */
function clusterByMagnitude(seriesList: { name: string; values: number[] }[]): number[][] {
  if (seriesList.length <= 1) return [seriesList.map((_, i) => i)]

  // 计算每个系列的最大值
  const withMax = seriesList.map((s, i) => ({
    index: i,
    maxVal: Math.max(...s.values.filter((v) => v != null && v > 0), 0),
  }))
  // 按最大值降序排列
  withMax.sort((a, b) => b.maxVal - a.maxVal)

  const groups: number[][] = [[withMax[0].index]]
  let groupMax = withMax[0].maxVal

  for (let i = 1; i < withMax.length; i++) {
    const { index, maxVal } = withMax[i]
    // 若当前系列的最大值不到当前组最大值的 1/50，则分到新组
    if (groupMax > 0 && maxVal > 0 && maxVal / groupMax < 0.02) {
      groups.push([index])
    } else {
      groups[groups.length - 1].push(index)
    }
    groupMax = Math.max(groupMax, maxVal)
  }

  // 最多 2 个 Y 轴，超过则合并
  if (groups.length > 2) {
    const last = groups.pop()!
    groups[groups.length - 1].push(...last)
  }

  return groups
}

/** 基于 ECharts 的多系列图表渲染组件（支持动态双 Y 轴） */
function ChartRenderer({ chartType, data }: Props) {
  if (!data || !data.series || data.series.length === 0 || data.series.every((s) => s.data.length === 0)) {
    return <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无数据</div>
  }

  // ── 量级聚类，决定 Y 轴分组 ──────────────────────────
  const axisGroups = clusterByMagnitude(
    data.series.map((s) => ({
      name: s.metric_label,
      values: s.data.map((d: any) => d.value as number),
    }))
  )
  const needsDualAxis = axisGroups.length === 2

  // 构建每个 series 对应的 yAxisIndex
  const yAxisIndexMap: number[] = new Array(data.series.length).fill(0)
  axisGroups.forEach((indices, groupIdx) => {
    indices.forEach((si) => { yAxisIndexMap[si] = groupIdx })
  })

  // ── 公共 tooltip 与 legend ────────────────────────────
  const legend = {
    data: data.series.map((s) => s.metric_label),
    top: 0,
  }

  // ── 趋势图（折线） ────────────────────────────────────
  if (chartType === 'trend') {
    const trend = data as MultiSeriesTrendResponse
    const allYears = [...new Set(trend.series.flatMap((s) => s.data.map((d) => d.fiscal_year).filter(Boolean)))]
    allYears.sort()

    const option = {
      tooltip: { trigger: 'axis' as const },
      legend,
      xAxis: {
        type: 'category' as const,
        data: allYears,
        axisLabel: { rotate: 30 },
      },
      yAxis: needsDualAxis
        ? [
            {
              type: 'value' as const,
              name: '左轴',
              nameTextStyle: { color: AXIS_COLORS[0] },
              axisLabel: { color: AXIS_COLORS[0] },
            },
            {
              type: 'value' as const,
              name: '右轴',
              nameTextStyle: { color: AXIS_COLORS[1] },
              axisLabel: { color: AXIS_COLORS[1] },
            },
          ]
        : [{ type: 'value' as const }],
      series: trend.series.map((s, i) => {
        const axisIdx = yAxisIndexMap[i]
        return {
          name: s.metric_label,
          type: 'line' as const,
          yAxisIndex: axisIdx,
          data: allYears.map((year) => {
            const point = s.data.find((d) => d.fiscal_year === year)
            return point ? point.value : null
          }),
          smooth: true,
          lineStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length], width: 2 },
          itemStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length] },
          symbolSize: 6,
        }
      }),
      grid: { left: '10%', right: needsDualAxis ? '12%' : '8%', bottom: '15%', top: '12%' },
    }
    return <ReactECharts option={option} style={{ height: 400 }} notMerge />
  }

  // ── 柱状图（对比） ────────────────────────────────────
  const comp = data as MultiSeriesComparisonResponse
  const allNames = comp.series.flatMap((s) => s.data.map((d) => d.report_name || ''))
  const uniqueNames = [...new Set(allNames)]

  const option = {
    tooltip: { trigger: 'axis' as const },
    legend,
    xAxis: {
      type: 'category' as const,
      data: uniqueNames.map((n) => (n.length > 18 ? n.slice(0, 18) + '...' : n)),
      axisLabel: { rotate: 45, fontSize: 11 },
    },
    yAxis: needsDualAxis
      ? [
          {
            type: 'value' as const,
            name: '左轴',
            nameTextStyle: { color: AXIS_COLORS[0] },
            axisLabel: { color: AXIS_COLORS[0] },
          },
          {
            type: 'value' as const,
            name: '右轴',
            nameTextStyle: { color: AXIS_COLORS[1] },
            axisLabel: { color: AXIS_COLORS[1] },
          },
        ]
      : [{ type: 'value' as const }],
    series: comp.series.map((s, i) => {
      const axisIdx = yAxisIndexMap[i]
      return {
        name: s.metric_label,
        type: 'bar' as const,
        yAxisIndex: axisIdx,
        data: uniqueNames.map((name) => {
          const point = s.data.find((d) => d.report_name === name)
          return point ? point.value : null
        }),
        itemStyle: {
          color: SERIES_COLORS[i % SERIES_COLORS.length],
          borderRadius: [4, 4, 0, 0],
        },
      }
    }),
    grid: { left: '10%', right: needsDualAxis ? '12%' : '8%', bottom: '20%', top: '12%' },
  }
  return <ReactECharts option={option} style={{ height: 400 }} notMerge />
}

export default ChartRenderer
