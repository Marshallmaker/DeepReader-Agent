import { useState, useEffect, useCallback, useMemo } from 'react'
import { message } from 'antd'
import { BarChartOutlined, FileTextOutlined, SyncOutlined } from '@ant-design/icons'
import { batchService, BatchResponse, ReportCompareItem, MetricColumnDef } from '../services/batchService'
import { metricService, MetricDefinition } from '../services/metricService'
import UploadZone from '../components/UploadZone'
import BatchTable from '../components/BatchTable'
import ComparisonModal from '../components/ComparisonModal'
import MetricSettingsModal from '../components/MetricSettingsModal'
import AddMetricModal from '../components/AddMetricModal'
import ChartModal from '../components/ChartModal'
import '../styles/components.css'
import './Dashboard.css'

function Dashboard() {
  // ── 批次列表 ──────────────────────────────────────────
  const [batches, setBatches] = useState<BatchResponse[]>([])
  const [batchLoading, setBatchLoading] = useState(false)
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 })

  // ── 对比矩阵 ──────────────────────────────────────────
  const [selectedBatch, setSelectedBatch] = useState<number | null>(null)
  const [selectedBatchName, setSelectedBatchName] = useState<string | null>(null)
  const [comparisonData, setComparisonData] = useState<ReportCompareItem[]>([])
  const [metricDefinitions, setMetricDefinitions] = useState<MetricColumnDef[]>([])
  const [showComparison, setShowComparison] = useState(false)

  // ── 指标管理 ──────────────────────────────────────────
  const [metrics, setMetrics] = useState<MetricDefinition[]>([])
  const [selectedMetricIds, setSelectedMetricIds] = useState<number[]>([])
  const [showMetricSettings, setShowMetricSettings] = useState(false)
  const [showAddMetric, setShowAddMetric] = useState(false)

  // ── 可视化 ────────────────────────────────────────────
  const [showChart, setShowChart] = useState(false)
  const [chartType, setChartType] = useState<'trend' | 'comparison'>('comparison')

  // ── 数据加载 ──────────────────────────────────────────

  const loadMetrics = useCallback(async () => {
    try {
      const response = await metricService.getMetricDefinitions()
      setMetrics(response.data)
      // 默认选中所有指标（系统预设 + 用户自定义），用户可在指标设置中自由调整
      const allIds = response.data.map((m: MetricDefinition) => m.id)
      setSelectedMetricIds(allIds)
    } catch {
      /* 静默失败 */
    }
  }, [])

  const loadBatches = useCallback(async (page: number, pageSize: number) => {
    setBatchLoading(true)
    try {
      const response = await batchService.getBatches(page, pageSize)
      setBatches(response.items)
      setPagination({
        current: response.page,
        pageSize: response.page_size,
        total: response.total,
      })
    } catch {
      message.error('加载批次列表失败')
    } finally {
      setBatchLoading(false)
    }
  }, [])

  useEffect(() => {
    loadBatches(1, 10)
    loadMetrics()
  }, [loadBatches, loadMetrics])

  // ── 统计数据 ──────────────────────────────────────────
  const stats = useMemo(() => {
    const totalBatches = pagination.total
    const totalReports = batches.reduce((sum, b) => sum + b.total_files, 0)
    const processingCount = batches.filter(
      (b) => b.status === 'processing' || b.status === 'pending'
    ).length
    return { totalBatches, totalReports, processingCount }
  }, [batches, pagination.total])

  // ── 事件处理 ──────────────────────────────────────────

  const handleViewComparison = async (batchId: number) => {
    setBatchLoading(true)
    try {
      const response = await batchService.getBatchComparison(batchId)
      setSelectedBatch(batchId)
      setSelectedBatchName(response.batch_name)
      setComparisonData(response.reports)
      setMetricDefinitions(response.metric_definitions)
      setShowComparison(true)
    } catch {
      message.error('加载对比数据失败')
    } finally {
      setBatchLoading(false)
    }
  }

  const handleOpenChart = (batchId: number) => {
    setSelectedBatch(batchId)
    setChartType('comparison')
    setShowChart(true)
  }

  const handleOpenTrend = () => {
    setChartType('trend')
    setShowChart(true)
  }

  const handleDeleteMetric = async (id: number) => {
    await metricService.deleteMetric(id)
    await loadMetrics()
  }

  const handleDeleteBatch = async (batchId: number) => {
    try {
      await batchService.deleteBatch(batchId)
      message.success('批次已删除')
      loadBatches(pagination.current, pagination.pageSize)
    } catch {
      message.error('删除批次失败')
    }
  }

  const handleDeleteAllBatches = async () => {
    try {
      const result = await batchService.deleteAllBatches()
      message.success(result.message)
      loadBatches(1, 10)
    } catch {
      message.error('删除所有批次失败')
    }
  }

  const handleRenameBatch = async (batchId: number, name: string) => {
    try {
      await batchService.renameBatch(batchId, name)
      message.success('批次已重命名')
      loadBatches(pagination.current, pagination.pageSize)
    } catch {
      message.error('重命名失败')
    }
  }

  // 已选指标的中文标签
  const selectedLabels = metrics
    .filter((m) => selectedMetricIds.includes(m.id))
    .map((m) => m.metric_label)

  return (
    <div className="dashboard-container">
      <div className="dashboard-content">
        {/* 页头 */}
        <div className="page-header">
          <div>
            <h1 className="page-header-title">工作台</h1>
            <p className="page-header-subtitle">管理 PDF 研报的上传、处理与数据对比</p>
          </div>
        </div>

        {/* 统计概览 */}
        <div className="stat-cards-row">
          <div className="stat-card">
            <div className="stat-card-label">总批次数</div>
            <div className="stat-card-value">{stats.totalBatches}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">总报告数</div>
            <div className="stat-card-value">
              <FileTextOutlined style={{ fontSize: 22, marginRight: 8 }} />
              {stats.totalReports}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">处理中</div>
            <div className="stat-card-value">
              <SyncOutlined spin={stats.processingCount > 0} style={{ fontSize: 22, marginRight: 8 }} />
              {stats.processingCount}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">已选指标</div>
            <div className="stat-card-value" style={{ fontSize: 'var(--font-size-xl)' }}>
              <BarChartOutlined style={{ fontSize: 22, marginRight: 8 }} />
              {selectedMetricIds.length} 项
            </div>
          </div>
        </div>

        {/* 主工作区 */}
        <div className="left-workspace">
          <UploadZone
            selectedMetrics={selectedMetricIds}
            metricsLabels={selectedLabels}
            onUploadSuccess={() => loadBatches(1, pagination.pageSize)}
            onOpenMetricSettings={() => setShowMetricSettings(true)}
          />

          <BatchTable
            batches={batches}
            loading={batchLoading}
            pagination={pagination}
            onPageChange={(page, pageSize) => loadBatches(page, pageSize || 10)}
            onRefresh={() => loadBatches(pagination.current, pagination.pageSize)}
            onViewComparison={handleViewComparison}
            onTrendAnalysis={handleOpenTrend}
            onOpenChart={handleOpenChart}
            onDeleteBatch={handleDeleteBatch}
            onRenameBatch={handleRenameBatch}
            onDeleteAllBatches={handleDeleteAllBatches}
          />
        </div>
      </div>

      <ComparisonModal
        open={showComparison}
        batchId={selectedBatch}
        batchName={selectedBatchName}
        data={comparisonData}
        metricDefinitions={metricDefinitions}
        onClose={() => setShowComparison(false)}
      />

      <MetricSettingsModal
        open={showMetricSettings}
        metrics={metrics}
        selectedIds={selectedMetricIds}
        onSelectionChange={setSelectedMetricIds}
        onClose={() => setShowMetricSettings(false)}
        onAddMetric={() => setShowAddMetric(true)}
        onDeleteMetric={handleDeleteMetric}
        onRefresh={loadMetrics}
      />

      <AddMetricModal
        open={showAddMetric}
        onClose={() => setShowAddMetric(false)}
        onCreated={loadMetrics}
      />

      <ChartModal
        open={showChart}
        chartType={chartType}
        batches={batches}
        selectedBatch={selectedBatch}
        onClose={() => setShowChart(false)}
      />
    </div>
  )
}

export default Dashboard
