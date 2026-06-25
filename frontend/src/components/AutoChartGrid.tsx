/**
 * AutoChartGrid — 自动图表网格组件
 *
 * 根据批次数据自动生成图表矩阵：
 * 1. 从 batchService 获取批次绑定的指标定义
 * 2. 过滤数值型指标，按指标逐个获取对比数据
 * 3. 每个指标一张独立折线图卡片，右上角可切换为柱状图
 * 4. 辅助视图（仪表盘/雷达图/热力图）在条件满足时附加展示
 */

import React, { useEffect, useState } from 'react'
import { Spin, Empty, Typography, Tooltip, Button, Select, message } from 'antd'
import { BarChartOutlined, LineChartOutlined } from '@ant-design/icons'
import ChartRenderer from './ChartRenderer'
import { autoAssign, type ChartType, type SeriesData } from './charts/ChartRegistry'
import './charts'  // 触发自注册
import { visualizationService } from '../services/visualizationService'
import { batchService } from '../services/batchService'
import type { MetricDefinition } from '../services/metricService'

const { Text, Title } = Typography

/** 单指标卡片可切换的图表变体 */
type ChartVariant = 'line' | 'bar'

interface Props {
  batchId: number
}

interface ChartAssignment {
  chartType: ChartType
  chartName: string
  metricKeys: string[]
  data: unknown // SeriesData[]
  /** 单指标卡片专用：当前选中的图表变体 */
  variant?: ChartVariant
}

const AutoChartGrid: React.FC<Props> = ({ batchId }) => {
  const [loading, setLoading] = useState(true)
  const [chartAssignments, setChartAssignments] = useState<ChartAssignment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [fullSeriesData, setFullSeriesData] = useState<SeriesData[]>([])
  const [allNumericMetrics, setAllNumericMetrics] = useState<MetricDefinition[]>([])

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
        setFullSeriesData([])
        setAllNumericMetrics([])
        setLoading(false)
        return
      }

      // 2. 获取趋势数据（含 fiscal_year，折线图可正确展示时间序列）
      const comparisonResult = await visualizationService.getTrendData([batchId], allMetricKeys)

      // 保存完整数据供雷达图指标重筛选
      setFullSeriesData(comparisonResult.series as SeriesData[])
      setAllNumericMetrics(numericMetrics)

      // 提取报告列表（用于 autoAssign），从数据点中提取完整的报告信息
      const reportsMap = new Map<string, { id: number; report_name: string; entity_name?: string; batch_id: number }>()
      for (const s of comparisonResult.series) {
        for (const dp of s.data) {
          const key = dp.report_name || dp.entity_name || ''
          if (key && !reportsMap.has(key)) {
            reportsMap.set(key, {
              id: dp.batch_id ?? batchId,
              report_name: dp.report_name || '',
              entity_name: dp.entity_name || undefined,
              batch_id: dp.batch_id ?? batchId,
            })
          }
        }
      }
      const reports = Array.from(reportsMap.values())

      // 3. 单指标卡片：每个数值指标一张独立折线图
      const metricCards: ChartAssignment[] = numericMetrics.map((metric) => ({
        chartType: 'line',
        chartName: metric.metric_label,
        metricKeys: [metric.metric_key],
        data: comparisonResult.series.filter(
          (s) => s.metric_key === metric.metric_key
        ) as SeriesData[],
        variant: 'line' as ChartVariant,
      }))

      // 4. 辅助视图：保留雷达图/饼图（排除 line/bar，已被单指标卡片替代）
      const SUPPLEMENTARY_TYPES: ChartType[] = ['radar', 'pie']
      const autoMatched = autoAssign(numericMetrics, reports)
      const supplementary: ChartAssignment[] = autoMatched
        .filter((config) => SUPPLEMENTARY_TYPES.includes(config.type))
        .map((config) => {
          let selectedKeys: string[] = allMetricKeys
          if (config.type === 'pie') {
            selectedKeys = allMetricKeys.slice(0, 1)
          }
          // 雷达图不再预截断，由 RadarChart 内部 Top-N 控件控制
          return {
            chartType: config.type,
            chartName: config.name,
            metricKeys: selectedKeys,
            data: comparisonResult.series.filter(
              (s) => selectedKeys.includes(s.metric_key)
            ) as SeriesData[],
          }
        })

      setChartAssignments([...metricCards, ...supplementary])
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

  /** 雷达图指标选择变更 */
  const handleRadarMetricChange = (idx: number, selectedKeys: string[]) => {
    if (selectedKeys.length < 3) {
      message.warning('雷达图至少需要选择3个指标')
      return
    }
    setChartAssignments((prev) =>
      prev.map((a, i) => {
        if (i !== idx || a.chartType !== 'radar') return a
        return {
          ...a,
          metricKeys: selectedKeys,
          data: fullSeriesData.filter((s) =>
            selectedKeys.includes(s.metric_key)
          ) as SeriesData[],
        }
      })
    )
  }

  /** 切换单指标卡片的图表类型（折线 ⇄ 柱状） */
  const toggleVariant = (idx: number) => {
    setChartAssignments((prev) =>
      prev.map((a, i) =>
        i === idx
          ? { ...a, variant: (a.variant === 'line' ? 'bar' : 'line') as ChartVariant }
          : a
      )
    )
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
        <Text type="secondary" style={{ fontSize: 12 }}>
          共 {chartAssignments.length} 张图表
        </Text>
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
            {assignment.variant ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text strong>{assignment.chartName}</Text>
                <Tooltip title={assignment.variant === 'line' ? '切换为柱状图' : '切换为折线图'}>
                  <Button
                    type="text"
                    size="small"
                    icon={assignment.variant === 'line' ? <BarChartOutlined /> : <LineChartOutlined />}
                    onClick={() => toggleVariant(idx)}
                  />
                </Tooltip>
              </div>
            ) : assignment.chartType === 'radar' ? (
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text strong>{assignment.chartName}</Text>
                <Select
                  mode="multiple"
                  size="small"
                  style={{ minWidth: 200, maxWidth: 360, flex: 1 }}
                  value={assignment.metricKeys}
                  onChange={(keys) => handleRadarMetricChange(idx, keys)}
                  options={allNumericMetrics.map((m) => ({
                    value: m.metric_key,
                    label: m.metric_label,
                  }))}
                  maxTagCount={2}
                  placeholder="选择雷达图指标"
                />
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {assignment.metricKeys.length}个指标
                </Text>
              </div>
            ) : (
              <Text strong style={{ marginBottom: 8, display: 'block' }}>
                {assignment.chartName}
              </Text>
            )}
            <ChartRenderer
              chartType={assignment.variant || assignment.chartType}
              data={assignment.data as SeriesData[]}
              height={300}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default AutoChartGrid
