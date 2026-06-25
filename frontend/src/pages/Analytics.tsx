import { useState, useEffect, useCallback, useRef } from 'react'
import { Button, Select, Switch, Space, Spin, Empty, App, Tag } from 'antd'
import { BarChartOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { batchService, BatchResponse } from '../services/batchService'
import { metricService, MetricDefinition } from '../services/metricService'
import { visualizationService, MultiSeriesTrendResponse, MultiSeriesComparisonResponse, CompatibleCheckResponse } from '../services/visualizationService'
import { extractErrorMessage } from '../utils/errorHandler'
import ChartRenderer from '../components/ChartRenderer'
import type { ChartType } from '../components/charts/ChartRegistry'
import { autoAssign } from '../components/charts/ChartRegistry'
import './Analytics.css'

type ChartData = MultiSeriesTrendResponse | MultiSeriesComparisonResponse

/** 图表类型 → 中文显示名称 */
const CHART_TYPE_LABELS: Record<string, string> = {
  line: '折线图',
  bar: '柱状图',
  pie: '饼图',
  radar: '雷达图',
  heatmap: '热力图',
  gauge: '仪表盘',
}

/** 在自动模式中作为辅助视图追加的图表类型（line/bar 已由单指标卡片覆盖） */
const SUPPLEMENTARY_CHART_TYPES: string[] = ['radar', 'pie', 'heatmap', 'gauge']

const CHART_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'auto', label: '自动选择' },
  { value: 'line', label: '折线图（趋势）' },
  { value: 'bar', label: '柱状图（对比）' },
  { value: 'pie', label: '饼图' },
  { value: 'radar', label: '雷达图' },
  { value: 'heatmap', label: '热力图' },
]

function Analytics() {
  const { message } = App.useApp()

  // 数据源
  const [batches, setBatches] = useState<BatchResponse[]>([])
  const [metrics, setMetrics] = useState<MetricDefinition[]>([])
  const [batchesLoading, setBatchesLoading] = useState(false)
  const [metricsLoading, setMetricsLoading] = useState(false)

  // 选择状态
  const [selectedBatchIds, setSelectedBatchIds] = useState<number[]>([])
  const [selectedMetricKeys, setSelectedMetricKeys] = useState<string[]>([])
  const [chartMode, setChartMode] = useState<string>('auto')
  const [autoMode, setAutoMode] = useState(true)

  // 生成状态
  const [generating, setGenerating] = useState(false)
  const [charts, setCharts] = useState<Array<{
    key: string
    chartType: string
    data: ChartData
    metricLabel: string
  }>>([])
  const [compatibility, setCompatibility] = useState<CompatibleCheckResponse | null>(null)
  const handleGenerateRef = useRef<() => Promise<void>>(async () => {})

  // 加载批次列表
  const loadBatches = useCallback(async () => {
    setBatchesLoading(true)
    try {
      const data = await batchService.getBatches(1, 100)
      setBatches(data.items)
    } catch (err) {
      message.error(extractErrorMessage(err, '加载批次列表失败'))
    } finally {
      setBatchesLoading(false)
    }
  }, [])

  // 加载指标定义
  const loadMetrics = useCallback(async () => {
    setMetricsLoading(true)
    try {
      const data = await metricService.getMetricDefinitions()
      setMetrics(data.data || [])
    } catch (err) {
      message.error(extractErrorMessage(err, '加载指标列表失败'))
    } finally {
      setMetricsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadBatches()
    loadMetrics()
  }, [loadBatches, loadMetrics])

  // 当选中的批次变化时，检查兼容性
  useEffect(() => {
    if (selectedBatchIds.length < 2) {
      setCompatibility(null)
      return
    }
    const check = async () => {
      try {
        const result = await visualizationService.checkCompatibility(selectedBatchIds)
        setCompatibility(result)
      } catch {
        setCompatibility(null)
      }
    }
    check()
  }, [selectedBatchIds])

  // 过滤只显示已完成的批次
  const completedBatches = batches.filter((b) => b.status === 'completed' || b.status === 'partial')

  // 从兼容性信息中获取可用的指标（仅数值型，文本指标无法用于图表）
  const availableMetrics = (compatibility
    ? metrics.filter((m) =>
        compatibility.common_metrics.some((cm) => cm.metric_key === m.metric_key)
      )
    : metrics).filter((m) => m.expected_type === 'NUMERIC')

  // 已选中的指标标签
  const selectedMetricLabels = selectedMetricKeys
    .map((key) => metrics.find((m) => m.metric_key === key)?.metric_label || key)
    .join(', ')

  // 生成图表
  const handleGenerate = async () => {
    if (selectedBatchIds.length === 0) {
      message.warning('请至少选择 1 个批次')
      return
    }
    if (selectedMetricKeys.length === 0) {
      message.warning('请至少选择 1 个指标')
      return
    }

    setGenerating(true)
    setCharts([])

    try {
      // 自动模式：每个数值指标生成一张独立图表 + 辅助视图
      if (autoMode) {
        const numericKeys = selectedMetricKeys
        const generated: typeof charts = []
        let trendData: MultiSeriesTrendResponse | null = null

        // ── 1. 获取趋势数据（一次性获取所有数值指标）─────────
        if (numericKeys.length > 0) {
          try {
            trendData = await visualizationService.getTrendData(selectedBatchIds, numericKeys)

            // 为每个指标生成独立折线图卡片
            for (const key of numericKeys) {
              const metricLabel = metrics.find((m) => m.metric_key === key)?.metric_label || key
              const filteredSeries = trendData.series.filter(
                (s) => s.metric_key === key
              )
              if (filteredSeries.length > 0) {
                generated.push({
                  key: `trend-${key}`,
                  chartType: 'line',
                  data: { ...trendData, series: filteredSeries },
                  metricLabel,
                })
              }
            }
          } catch (err) {
            message.error(`趋势图获取失败: ${extractErrorMessage(err)}`)
          }
        }

        // ── 2. 多批次时追加柱状对比图 ────────────────────────
        if (numericKeys.length > 0 && selectedBatchIds.length >= 2) {
          try {
            const compData = await visualizationService.getComparisonData(selectedBatchIds, numericKeys)
            generated.push({
              key: 'comp-bar',
              chartType: 'bar',
              data: compData,
              metricLabel: '多批次对比',
            })
          } catch (err) {
            message.error(`对比图获取失败: ${extractErrorMessage(err)}`)
          }
        }

        // ── 3. 辅助视图：调用 autoAssign 添加雷达/饼/热力/仪表 ──
        if (trendData && numericKeys.length > 0) {
          // 从趋势数据中提取报告列表（供 autoAssign 使用）
          const reportsMap = new Map<string, { id: number; report_name: string; entity_name?: string; batch_id: number }>()
          for (const s of trendData.series) {
            for (const dp of s.data) {
              const rkey = dp.report_name || dp.entity_name || ''
              if (rkey && !reportsMap.has(rkey)) {
                reportsMap.set(rkey, {
                  id: dp.batch_id ?? selectedBatchIds[0],
                  report_name: dp.report_name || '',
                  entity_name: dp.entity_name || undefined,
                  batch_id: dp.batch_id ?? selectedBatchIds[0],
                })
              }
            }
          }
          const reports = Array.from(reportsMap.values())
          const numericMetrics = numericKeys
            .map((k) => metrics.find((m) => m.metric_key === k))
            .filter(Boolean) as MetricDefinition[]

          const assignments = autoAssign(numericMetrics, reports)
          for (const config of assignments) {
            // 跳过已由单指标卡片覆盖的 line / bar
            if (!SUPPLEMENTARY_CHART_TYPES.includes(config.type)) continue
            generated.push({
              key: `auto-${config.type}`,
              chartType: config.type,
              data: trendData,
              metricLabel: config.name,
            })
          }
        }

        setCharts(generated)
        if (generated.length === 0) {
          message.info('未能生成任何图表，请检查所选指标的数据可用性')
        } else {
          message.success(`已生成 ${generated.length} 张图表`)
        }
      } else {
        // 手动模式：按选定的图表类型
        const mks = selectedMetricKeys
        let chartType = chartMode === 'auto' ? 'line' : chartMode
        let data: ChartData

        if (chartType === 'line' || chartType === 'auto') {
          data = await visualizationService.getTrendData(selectedBatchIds, mks)
          chartType = 'line'
        } else if (chartType === 'bar') {
          data = await visualizationService.getComparisonData(selectedBatchIds, mks)
        } else {
          // 对于 pie/radar/heatmap，先获取趋势数据
          data = await visualizationService.getTrendData(selectedBatchIds, mks)
        }

        setCharts([{
          key: `manual-${chartType}`,
          chartType,
          data,
          metricLabel: selectedMetricLabels,
        }])
        message.success('图表已生成')
      }
    } catch (err) {
      message.error(extractErrorMessage(err, '图表生成失败'))
    } finally {
      setGenerating(false)
    }
  }
  handleGenerateRef.current = handleGenerate

  // 统计
  const totalBatches = batches.length
  const completedCount = completedBatches.length
  const numericMetricCount = metrics.filter((m) => m.expected_type === 'NUMERIC').length

  return (
    <div className="analytics-page">
      {/* 页头 */}
      <div className="page-header">
        <div>
          <h1 className="page-title">数据分析中心</h1>
          <p className="page-subtitle">选择批次与指标，生成趋势图、对比图等多维度可视化分析</p>
        </div>
        <Space>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={handleGenerate}
            loading={generating}
          >
            生成图表
          </Button>
        </Space>
      </div>

      {/* 统计行 */}
      <div className="stat-cards-row">
        <div className="stat-card">
          <div className="stat-card-label">总批次数</div>
          <div className="stat-card-value">{totalBatches}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">已完成批次</div>
          <div className="stat-card-value">{completedCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">可用指标</div>
          <div className="stat-card-value">{numericMetricCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">已生成图表</div>
          <div className="stat-card-value">{charts.length}</div>
        </div>
      </div>

      {/* 配置面板 */}
      <div className="section-card">
        <div className="analytics-config">
          <div className="config-row">
            <div className="config-item">
              <label className="config-label">选择批次</label>
              <Select
                mode="multiple"
                placeholder="选择要分析的批次（可多选）..."
                loading={batchesLoading}
                value={selectedBatchIds}
                onChange={setSelectedBatchIds}
                style={{ width: '100%', minWidth: 280 }}
                maxTagCount={3}
                options={completedBatches.map((b) => ({
                  value: b.batch_id,
                  label: b.batch_name || `批次 #${b.batch_id}`,
                }))}
                filterOption={(input, option) =>
                  (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                }
              />
            </div>
            <div className="config-item">
              <label className="config-label">选择指标</label>
              <Select
                mode="multiple"
                placeholder="选择要分析的指标（可多选）..."
                loading={metricsLoading}
                value={selectedMetricKeys}
                onChange={setSelectedMetricKeys}
                style={{ width: '100%', minWidth: 280 }}
                maxTagCount={3}
                options={availableMetrics.map((m) => ({
                  value: m.metric_key,
                  label: `${m.metric_label} (${m.expected_type === 'NUMERIC' ? '数值' : '文本'})`,
                }))}
                filterOption={(input, option) =>
                  (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                }
              />
            </div>
          </div>
          <div className="config-row config-row-secondary">
            <div className="config-item">
              <label className="config-label">图表模式</label>
              <Space>
                <Switch
                  checked={autoMode}
                  onChange={setAutoMode}
                  checkedChildren="自动"
                  unCheckedChildren="手动"
                />
                {!autoMode && (
                  <Select
                    value={chartMode}
                    onChange={setChartMode}
                    style={{ width: 170 }}
                    options={CHART_TYPE_OPTIONS}
                  />
                )}
                <span style={{ fontSize: 13, color: '#999' }}>
                  {autoMode
                    ? '自动为每个指标选择最合适的图表类型'
                    : '手动指定图表类型'}
                </span>
              </Space>
            </div>
            <Button
              icon={<ReloadOutlined />}
              loading={batchesLoading || metricsLoading}
              onClick={async () => {
                await Promise.all([loadBatches(), loadMetrics()])
                message.success('数据已刷新')
                // 刷新后若有选中的批次和指标，自动重新生成图表
                if (selectedBatchIds.length > 0 && selectedMetricKeys.length > 0) {
                  handleGenerateRef.current()
                }
              }}
            >
              刷新数据
            </Button>
          </div>

          {/* 兼容性提示 */}
          {compatibility && !compatibility.compatible && (
            <div className="compatibility-warning">
              <span>⚠ 所选批次的指标不完全兼容，只能展示共同指标。</span>
              {compatibility.incompatible_batches.length > 0 && (
                <span>
                  {' '}不兼容批次：{compatibility.incompatible_batches.join(', ')}
                </span>
              )}
            </div>
          )}
          {compatibility && compatibility.compatible && selectedBatchIds.length >= 2 && (
            <div className="compatibility-ok">
              <span>✅ {selectedBatchIds.length} 个批次指标兼容</span>
              {compatibility.common_metrics.length > 0 && (
                <span style={{ marginLeft: 12 }}>
                  共同指标：
                  {compatibility.common_metrics.slice(0, 5).map((m) => (
                    <Tag key={m.metric_key} style={{ marginLeft: 4 }}>{m.metric_label}</Tag>
                  ))}
                  {compatibility.common_metrics.length > 5 && `...等 ${compatibility.common_metrics.length} 项`}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 图表输出区 */}
      <div className="section-card">
        {generating ? (
          <div className="analytics-loading">
            <Spin size="large" />
            <p>正在生成图表...</p>
          </div>
        ) : charts.length === 0 ? (
          <div className="analytics-empty">
            <Empty
              image={<BarChartOutlined style={{ fontSize: 64, color: '#d9d9d9' }} />}
              description={'选择批次和指标后，点击「生成图表」开始分析'}
            />
          </div>
        ) : (
          <div className="analytics-chart-grid">
            {charts.map((chart) => (
              <div key={chart.key} className="analytics-chart-item">
                <div className="chart-item-header">
                  <span className="chart-item-title">
                    {chart.metricLabel}
                  </span>
                  <Tag color="blue">{CHART_TYPE_LABELS[chart.chartType] || chart.chartType}</Tag>
                </div>
                <ChartRenderer
                  chartType={chart.chartType as ChartType}
                  data={chart.data}
                  height={400}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default Analytics
