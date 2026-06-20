/**
 * GaugeCard — 仪表盘
 *
 * 适用条件：数值指标 >= 1 且报告 >= 1
 * 半圆仪表（startAngle: 200, endAngle: -20）
 * 颜色分档：绿/黄/红，最多 6 个指标
 * 异常时指针变红，自动网格布局
 */

import * as ChartRegistry from './ChartRegistry'
import type { ChartTypeConfig, SeriesData, ReductionConfig } from './ChartRegistry'
import type { EChartsOption } from 'echarts'

/** Gauge 颜色分档：[阈值, 颜色] */
type GaugeColorStop = [number, string]

const GAUGE_COLORS: GaugeColorStop[] = [
  [0.3, '#34C759'],
  [0.7, '#FF9500'],
  [1, '#FF3B30'],
]

const config: ChartTypeConfig = {
  type: 'gauge',
  name: '仪表盘',
  isApplicable: (metrics, reports) => metrics.length >= 1 && reports.length >= 1,
  buildOption: (data: SeriesData[], reduction?: ReductionConfig): EChartsOption => {
    const topN = Math.min(reduction?.topN ?? 6, 6)
    const metricCount = Math.min(data.length, topN)

    if (metricCount === 0) {
      return { series: [] }
    }

    // 计算所有数据的全局最大值，用于统一刻度
    let globalMax = 0
    for (let i = 0; i < metricCount; i++) {
      for (const d of data[i].data) {
        if (d.value != null && d.value > globalMax) {
          globalMax = d.value
        }
      }
    }
    const gaugeMax = globalMax * 1.2 || 100

    // 自适应布局：计算列数和每列仪表数量
    const cols = metricCount <= 2 ? metricCount : Math.min(metricCount, 3)
    const rows = Math.ceil(metricCount / cols)

    const gaugeSeries = data.slice(0, metricCount).map((s, i) => {
      const point = s.data[0]
      const value = point?.value ?? 0
      const isAnomaly = point?.is_anomaly ?? false

      // 网格布局定位
      const col = i % cols
      const rowIdx = Math.floor(i / cols)
      const xPct = ((col + 0.5) / cols) * 100
      const yPct =
        rows <= 1 ? 58 : ((rowIdx + 0.7) / rows) * 90 + 5
      const center: [string, string] = [`${xPct}%`, `${yPct}%`]

      // 根据仪表数量自适应半径
      const radius =
        metricCount <= 2 ? '85%' : metricCount <= 4 ? '75%' : '65%'

      return {
        type: 'gauge' as const,
        startAngle: 200,
        endAngle: -20,
        center,
        radius,
        min: 0,
        max: gaugeMax,
        axisLine: {
          lineStyle: {
            width: 15,
            color: GAUGE_COLORS,
          },
        },
        pointer: {
          itemStyle: {
            color: isAnomaly ? '#FF3B30' : 'auto',
          },
        },
        axisTick: {
          distance: -15,
          length: 5,
          lineStyle: { width: 1, color: '#999' },
        },
        splitLine: {
          distance: -20,
          length: 10,
          lineStyle: { width: 2, color: '#999' },
        },
        axisLabel: {
          distance: 25,
          fontSize: 10,
          color: '#999',
        },
        detail: {
          formatter: '{value}',
          fontSize: 14,
          offsetCenter: [0, '60%'],
        },
        title: {
          offsetCenter: [0, '90%'],
          fontSize: 11,
          color: '#333',
        },
        data: [{ value, name: s.metric_label }],
      }
    })

    return { series: gaugeSeries }
  },
  defaultReduction: { defaultTopN: 6, pageSize: 0 },
}

ChartRegistry.register(config)
export default config
