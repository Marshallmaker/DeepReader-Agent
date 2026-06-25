import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
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
import AutoChartGrid from '../components/AutoChartGrid'
import ProcessingProgressOverlay from '../components/ProcessingProgressOverlay'
import '../styles/components.css'
import './Dashboard.css'

const SELECTED_METRICS_KEY = 'deepreader_selected_metric_ids'

/**
 * 从 localStorage 恢复用户勾选的指标 ID 列表
 */
function loadSavedMetricIds(): number[] {
  try {
    const stored = localStorage.getItem(SELECTED_METRICS_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

/**
 * 将用户勾选的指标 ID 列表持久化到 localStorage
 */
function saveMetricIds(ids: number[]) {
  try {
    localStorage.setItem(SELECTED_METRICS_KEY, JSON.stringify(ids))
  } catch { /* 静默失败 */ }
}

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
  const [selectedMetricIds, setSelectedMetricIds] = useState<number[]>(loadSavedMetricIds)
  const [showMetricSettings, setShowMetricSettings] = useState(false)
  const [showAddMetric, setShowAddMetric] = useState(false)
  const [editingMetric, setEditingMetric] = useState<MetricDefinition | null>(null)
  // 标记是否已完成首次指标加载（用于判断是否需要默认全选）
  const metricsInitialized = useRef(false)

  // ── 可视化 ────────────────────────────────────────────
  const [showChart, setShowChart] = useState(false)
  const [chartType, setChartType] = useState<'trend' | 'comparison'>('comparison')

  // ── 数据加载 ──────────────────────────────────────────

  const loadMetrics = useCallback(async () => {
    try {
      const response = await metricService.getMetricDefinitions()
      setMetrics(response.data)
      // 仅首次加载且无历史记录时，默认全选；同时剔除 localStorage 中已失效的 ID
      if (!metricsInitialized.current) {
        metricsInitialized.current = true
        const savedIds = loadSavedMetricIds()
        if (savedIds.length === 0) {
          const allIds = response.data.map((m: MetricDefinition) => m.id)
          setSelectedMetricIds(allIds)
          saveMetricIds(allIds)
        } else {
          // 验证缓存的 ID 是否仍然有效，过滤掉已被删除的指标
          const validIds = new Set(response.data.map((m: MetricDefinition) => m.id))
          const cleaned = savedIds.filter((id: number) => validIds.has(id))
          if (cleaned.length !== savedIds.length) {
            const removed = savedIds.filter((id: number) => !validIds.has(id))
            console.warn(`[Dashboard] 已自动清除失效指标 ID: ${removed.join(', ')}（可能已被删除）`)
            setSelectedMetricIds(cleaned)
            saveMetricIds(cleaned)
          }
        }
      }
    } catch {
      message.error('加载指标定义失败，请刷新页面重试')
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

  // 每次 selectedMetricIds 变化时持久化到 localStorage
  useEffect(() => {
    saveMetricIds(selectedMetricIds)
  }, [selectedMetricIds])

  // 批次处理中时自动轮询刷新进度（每 3 秒）
  useEffect(() => {
    const hasActive = batches.some(
      b => b.status === 'processing' || b.status === 'pending'
    )
    if (!hasActive) return

    const timer = setInterval(() => {
      loadBatches(pagination.current, pagination.pageSize)
    }, 3000)

    return () => clearInterval(timer)
  }, [batches, pagination.current, pagination.pageSize, loadBatches])

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
          <ProcessingProgressOverlay batches={batches} />
          <UploadZone
            selectedMetrics={selectedMetricIds}
            metricsLabels={selectedLabels}
            onUploadSuccess={(newBatchId) => {
              loadBatches(1, pagination.pageSize)
              if (newBatchId) setSelectedBatch(newBatchId)
            }}
            onOpenMetricSettings={() => setShowMetricSettings(true)}
            onMetricsChange={(newIds) => {
              setSelectedMetricIds(newIds)
              loadMetrics()
            }}
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
            selectedBatchId={selectedBatch}
            onSelectBatch={setSelectedBatch}
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

      {selectedBatch && (
        <AutoChartGrid batchId={selectedBatch} />
      )}

      <MetricSettingsModal
        open={showMetricSettings}
        metrics={metrics}
        selectedIds={selectedMetricIds}
        onSelectionChange={setSelectedMetricIds}
        onClose={() => setShowMetricSettings(false)}
        onAddMetric={() => { setEditingMetric(null); setShowAddMetric(true) }}
        onDeleteMetric={handleDeleteMetric}
        onRefresh={loadMetrics}
        onEditMetric={(metric) => { setEditingMetric(metric); setShowAddMetric(true) }}
        batchId={selectedBatch ?? undefined}
      />

      <AddMetricModal
        open={showAddMetric}
        onClose={() => { setShowAddMetric(false); setEditingMetric(null) }}
        onCreated={loadMetrics}
        mode={editingMetric ? 'edit' : 'create'}
        editTarget={editingMetric}
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
