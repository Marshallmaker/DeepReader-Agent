/**
 * AutoChartGrid — 自动图表网格组件
 *
 * 根据批次数据自动生成图表矩阵：
 * 1. 从 batchService 获取批次绑定的指标定义
 * 2. 过滤数值型指标，调用 visualizationService 获取对比数据
 * 3. 通过 ChartRegistry.autoAssign 自动分配图表类型
 * 4. 以响应式网格渲染所有匹配的图表
 */

import React, { useEffect, useState } from 'react'
import { Spin, Empty, Switch, Space, Typography } from 'antd'
import ChartRenderer from './ChartRenderer'
import { autoAssign, type ChartType } from './charts/ChartRegistry'
import './charts'  // 触发自注册
import { visualizationService } from '../services/visualizationService'
import { batchService } from '../services/batchService'
import type { MetricDefinition } from '../services/metricService'

const { Text, Title } = Typography

interface Props {
  batchId: number
}

interface ChartAssignment {
  chartType: ChartType
  chartName: string
  metricKeys: string[]
  data: unknown // SeriesData[]
}

const AutoChartGrid: React.FC<Props> = ({ batchId }) => {
  const [loading, setLoading] = useState(true)
  const [chartAssignments, setChartAssignments] = useState<ChartAssignment[]>([])
  const [showAnomalyOnly, setShowAnomalyOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    generateCharts()
  }, [batchId])

  const generateCharts = async () => {
    setLoading(true)
    setError(null)
    try {
      // 1. 获取批次绑定的指标
      const batchDetail = await batchService.getBatchDetail(batchId)
      const allMetrics: MetricDefinition[] = batchDetail.metric_tags || []
      const numericMetrics = allMetrics.filter((m: MetricDefinition) => m.expected_type === 'NUMERIC')
      const allMetricKeys = numericMetrics.map((m: MetricDefinition) => m.metric_key)

      if (allMetricKeys.length === 0) {
        setChartAssignments([])
        setLoading(false)
        return
      }

      // 2. 获取对比数据（柱状图等）
      const comparisonResult = await visualizationService.getComparisonData([batchId], allMetricKeys)
      // 也获取趋势数据（折线图）
      const trendResult = await visualizationService.getTrendData([batchId], allMetricKeys)

      // 3. 自动分配图表
      const reports = Array.from(
        new Set(
          comparisonResult.series.flatMap(
            (s: { data: Array<{ report_name?: string }> }) =>
              s.data.map((d) => d.report_name).filter(Boolean)
          )
        )
      ).map((name: unknown) => ({ report_name: name }))
      const assignments = autoAssign(numericMetrics as never, reports as never)

      // 4. 构建图表任务
      const tasks: ChartAssignment[] = assignments.map((config) => {
        // 选择适合此图表类型的指标子集
        let selectedKeys: string[] = []
        if (config.type === 'pie') {
          // 饼图只用第一个指标
          selectedKeys = allMetricKeys.slice(0, 1)
        } else if (config.type === 'radar') {
          selectedKeys = allMetricKeys.slice(0, 10)
        } else {
          selectedKeys = allMetricKeys
        }

        // 根据图表类型选择正确的数据源
        const isTrendType = config.type === 'line'
        const sourceResult = isTrendType ? trendResult : comparisonResult

        const filteredSeries = sourceResult.series.filter(
          (s: { metric_key: string }) => selectedKeys.includes(s.metric_key)
        )
        return {
          chartType: config.type,
          chartName: config.name,
          metricKeys: selectedKeys,
          data: filteredSeries,
        }
      })

      setChartAssignments(tasks)
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
            '加载图表数据失败'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  if (loading)
    return <Spin tip="正在生成智能分析图表..." style={{ display: 'block', padding: 40 }} />
  if (error) return <Text type="danger">{error}</Text>
  if (chartAssignments.length === 0)
    return <Empty description="该批次没有可用的数值型指标" />

  return (
    <div style={{ marginTop: 24 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          自动分析看板
        </Title>
        <Space>
          <Text type="secondary">仅显示异常</Text>
          <Switch size="small" checked={showAnomalyOnly} onChange={setShowAnomalyOnly} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            共 {chartAssignments.length} 张图表
          </Text>
        </Space>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(500px, 1fr))',
          gap: 16,
        }}
      >
        {chartAssignments.map((assignment, idx) => (
          <div
            key={idx}
            style={{
              border: '1px solid #f0f0f0',
              borderRadius: 8,
              padding: 12,
              background: '#fff',
            }}
          >
            <Text strong style={{ marginBottom: 8, display: 'block' }}>
              {assignment.chartName}
            </Text>
            <ChartRenderer
              chartType={assignment.chartType}
              data={assignment.data as never}
              height={300}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default AutoChartGrid
