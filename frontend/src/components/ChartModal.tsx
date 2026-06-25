import { useState, useEffect, useMemo } from 'react'
import { Modal, Button, Select, Switch, Typography, message, Alert } from 'antd'
import { BarChartOutlined, LineChartOutlined, PieChartOutlined, DashboardOutlined, AimOutlined, AppstoreOutlined } from '@ant-design/icons'
import { BatchResponse, MetricTagInfo } from '../services/batchService'
import { visualizationService, MultiSeriesTrendResponse, MultiSeriesComparisonResponse } from '../services/visualizationService'
import * as ChartRegistry from './charts/ChartRegistry'
import type { ChartType, Report } from './charts/ChartRegistry'
import ChartRenderer from './ChartRenderer'
import { useDraggableModal } from '../hooks/useDraggableModal'
import './charts'
import { detectDimensions, evaluateConflict } from '../utils/dimensionDetector'
import type { ConflictResult } from '../utils/dimensionDetector'

const { Text } = Typography

interface ChartModalProps {
  open: boolean
  chartType: ChartType | 'trend' | 'comparison'
  batches: BatchResponse[]
  selectedBatch: number | null
  onClose: () => void
}

/** 计算批次指标签名 — 排序后的 metric_key 列表 */
function getMetricSignature(batch: BatchResponse): string {
  return batch.metric_tags
    .map((t) => t.metric_key)
    .sort()
    .join(',')
}

/** 包含时间信息的指标键名（用于自动模式判断是否请求趋势数据） */
const TIME_RELATED_METRIC_KEYS = new Set(['fiscal_year', 'submission_date', 'repurchase_date'])

function ChartModal({ open, chartType: initialType, batches, selectedBatch, onClose }: ChartModalProps) {
  const { modalRender } = useDraggableModal()
  // ── 图表类型（支持新旧两种命名）──────────────────────
  const [chartType, setChartType] = useState<string>(initialType)
  useEffect(() => { setChartType(initialType) }, [initialType])

  // ── 批次多选 ──────────────────────────────────────────
  const [selectedBatchIds, setSelectedBatchIds] = useState<number[]>([])
  // 可用批次列表：与已选第一个批次指标签名相同的批次
  const [compatibleBatchIds, setCompatibleBatchIds] = useState<number[]>([])

  useEffect(() => {
    if (selectedBatch) {
      setSelectedBatchIds([selectedBatch])
    }
  }, [selectedBatch])

  // 当选中批次变化时，计算兼容批次列表
  useEffect(() => {
    if (selectedBatchIds.length > 0) {
      const firstId = selectedBatchIds[0]
      const firstBatch = batches.find((b) => b.batch_id === firstId)
      if (firstBatch) {
        const sig = getMetricSignature(firstBatch)
        setCompatibleBatchIds(
          batches
            .filter((b) => b.status === 'completed' && getMetricSignature(b) === sig)
            .map((b) => b.batch_id)
        )
      }
    } else {
      setCompatibleBatchIds(batches.filter((b) => b.status === 'completed').map((b) => b.batch_id))
    }
  }, [selectedBatchIds, batches])

  // ── 可用指标 ──────────────────────────────────────────
  const [availableMetrics, setAvailableMetrics] = useState<MetricTagInfo[]>([])
  const [selectedMetricKeys, setSelectedMetricKeys] = useState<string[]>([])

  useEffect(() => {
    if (selectedBatchIds.length > 0) {
      const firstBatch = batches.find((b) => b.batch_id === selectedBatchIds[0])
      if (firstBatch) {
        const metrics = firstBatch.metric_tags.filter((t) => t.expected_type === 'NUMERIC')
        setAvailableMetrics(metrics)
        setSelectedMetricKeys(metrics.map((m) => m.metric_key))
      }
    } else {
      setAvailableMetrics([])
      setSelectedMetricKeys([])
    }
  }, [selectedBatchIds, batches])

  // ── 图表数据与加载 ────────────────────────────────────
  const [chartData, setChartData] = useState<MultiSeriesTrendResponse | MultiSeriesComparisonResponse | null>(null)
  const [loading, setLoading] = useState(false)

  // ── 自动模式开关（默认开启） ──────────────────────────
  const [autoMode, setAutoMode] = useState(true)

  // ── 量纲冲突检测（仅手动模式生效）──────────────────────
  const dimensionConflict: ConflictResult | null = useMemo(() => {
    if (autoMode || selectedMetricKeys.length < 2) return null
    const selectedMetrics = availableMetrics.filter((m) => selectedMetricKeys.includes(m.metric_key))
    if (selectedMetrics.length < 2) return null
    const dimMap = detectDimensions(
      selectedMetrics.map((m) => ({ metric_key: m.metric_key, metric_label: m.metric_label }))
    )
    const dimensions = selectedMetrics.map((m) => dimMap.get(m.metric_key) || 'unknown')
    return evaluateConflict(dimensions)
  }, [autoMode, selectedMetricKeys, availableMetrics])

  const handleGenerate = async () => {
    if (autoMode) {
      if (selectedBatchIds.length === 0) {
        message.warning('请至少选择一个批次')
        return
      }

      const batchId = selectedBatchIds[0]
      const firstBatch = batches.find((b) => b.batch_id === batchId)
      if (!firstBatch) {
        message.warning('未找到批次信息')
        return
      }

      const numericMetrics = firstBatch.metric_tags.filter((t) => t.expected_type === 'NUMERIC')
      const metricKeys = numericMetrics.map((m) => m.metric_key)

      if (metricKeys.length === 0) {
        message.warning('该批次没有数值型指标，无法生成图表')
        return
      }

      setLoading(true)
      try {
        // 根据批次特征自动选择数据端点：
        // - 包含时间类指标 + 报告数 ≥2 → 优先趋势端点（可展示时间序列）
        // - 其他情况 → 对比端点
        const hasTimeMetric = numericMetrics.some(
          (m) => TIME_RELATED_METRIC_KEYS.has(m.metric_key)
        )
        const useTrendEndpoint = hasTimeMetric && firstBatch.total_files >= 2

        const result = useTrendEndpoint
          ? await visualizationService.getTrendData([batchId], metricKeys)
          : await visualizationService.getComparisonData([batchId], metricKeys)

        // 标注量纲维度
        const dimMap = detectDimensions(
          numericMetrics.map((m) => ({ metric_key: m.metric_key, metric_label: m.metric_label }))
        )
        result.series.forEach((s: any) => {
          s.dimension = dimMap.get(s.metric_key) || 'unknown'
        })

        // 从数据中提取报告信息用于 ChartRegistry.autoAssign
        const reportsMap = new Map<string, Report>()
        if (result.series) {
          for (const s of result.series) {
            for (const dp of s.data) {
              const key = dp.report_name || dp.entity_name || ''
              if (key && !reportsMap.has(key)) {
                reportsMap.set(key, {
                  id: dp.batch_id ?? batchId,
                  report_name: dp.report_name || '',
                  entity_name: dp.entity_name,
                  batch_id: dp.batch_id ?? batchId,
                })
              }
            }
          }
        }
        const reports = Array.from(reportsMap.values())

        const assignments = ChartRegistry.autoAssign(numericMetrics, reports)

        if (assignments.length === 0) {
          message.warning('没有适合当前数据的图表类型')
          setChartData(null)
          setLoading(false)
          return
        }

        // 将 ChartRegistry 的新图表类型映射为旧类型或直接使用新类型
        const typeMap: Record<string, string> = {
          line: 'trend',
          bar: 'comparison',
          pie: 'pie',
          radar: 'radar',
          gauge: 'gauge',
          heatmap: 'heatmap',
        }
        setChartType(typeMap[assignments[0].type] || (useTrendEndpoint ? 'trend' : 'comparison'))
        setChartData(result)
      } catch (error: any) {
        const msg = error?.response?.data?.detail || '自动生成图表失败'
        message.error(msg)
      } finally {
        setLoading(false)
      }
      return
    }

    // ── 手动模式逻辑（保持原有行为） ────────────────────
    if (selectedBatchIds.length === 0) {
      message.warning('请至少选择一个批次')
      return
    }
    if (selectedMetricKeys.length === 0) {
      message.warning('请至少选择一个指标')
      return
    }

    // 前端兼容性校验
    const firstSig = getMetricSignature(
      batches.find((b) => b.batch_id === selectedBatchIds[0])!
    )
    const incompatible = selectedBatchIds.filter((id) => {
      const b = batches.find((b) => b.batch_id === id)
      return !b || getMetricSignature(b) !== firstSig
    })
    if (incompatible.length > 0) {
      message.error('所选批次的指标集不一致，无法进行数据分析')
      return
    }

    setLoading(true)
    try {
      let result: MultiSeriesTrendResponse | MultiSeriesComparisonResponse
      if (chartType === 'trend' || chartType === 'line') {
        result = await visualizationService.getTrendData(selectedBatchIds, selectedMetricKeys)
      } else {
        result = await visualizationService.getComparisonData(selectedBatchIds, selectedMetricKeys)
      }
      // 为每个 series 标注量纲维度（用于双轴分组和颜色绑定）
      const dimMap = detectDimensions(
        selectedMetricKeys.map((key) => {
          const m = availableMetrics.find((a) => a.metric_key === key)
          return { metric_key: key, metric_label: m?.metric_label || key }
        })
      )
      result.series.forEach((s: any) => {
        s.dimension = dimMap.get(s.metric_key) || 'unknown'
      })
      setChartData(result)
    } catch (error: any) {
      const msg = error?.response?.data?.detail || '获取图表数据失败'
      message.error(msg)
    } finally {
      setLoading(false)
    }
  }

  // ── 重置 ──────────────────────────────────────────────
  const handleClose = () => {
    setChartData(null)
    setSelectedBatchIds(selectedBatch ? [selectedBatch] : [])
    setAutoMode(true)
    setSelectedMetricKeys([])
    onClose()
  }

  // ── 批次选项 ──────────────────────────────────────────
  const batchOptions = batches
    .filter((b) => b.status === 'completed')
    .map((b) => {
      const isCompatible = compatibleBatchIds.includes(b.batch_id)
      return {
        value: b.batch_id,
        label: `${b.batch_name || `批次${b.batch_id}`}${isCompatible ? '' : ' ⚠指标不同'}`,
        disabled: !isCompatible && selectedBatchIds.length > 0,
      }
    })

  return (
    <Modal
      modalRender={modalRender}
      title={
        <span className="modal-title">
          {chartType === 'trend' || chartType === 'line' ? <LineChartOutlined /> :
           chartType === 'pie' ? <PieChartOutlined /> :
           chartType === 'radar' ? <AimOutlined /> :
           chartType === 'gauge' ? <DashboardOutlined /> :
           chartType === 'heatmap' ? <AppstoreOutlined /> :
           <BarChartOutlined />}
          {' '}{chartType === 'trend' || chartType === 'line' ? '趋势分析' :
               chartType === 'pie' ? '饼图分析' :
               chartType === 'radar' ? '雷达图分析' :
               chartType === 'gauge' ? '仪表盘' :
               chartType === 'heatmap' ? '热力图分析' :
               '横向对比'}
        </span>
      }
      open={open}
      onCancel={handleClose}
      width={900}
      className="chart-modal"
      footer={[
        <Button key="close" onClick={handleClose}>关闭</Button>,
        <Button key="generate" type="primary" loading={loading} onClick={handleGenerate}>生成图表</Button>,
      ]}
    >
      {/* 自动模式开关 */}
      <div style={{ marginBottom: 16 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Text>自动模式</Text>
          <Switch
            checked={autoMode}
            onChange={(checked) => {
              setAutoMode(checked)
              if (checked) {
                setChartData(null)
              }
            }}
          />
          <Text type="secondary">
            {autoMode ? '系统自动选择图表类型和指标' : '手动配置图表参数'}
          </Text>
        </span>
      </div>

      {/* 手动模式配置区 */}
      {!autoMode && (
        <div style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {/* 图表类型 */}
          <div style={{ flex: '0 0 140px' }}>
            <div style={{ marginBottom: 4, fontWeight: 500, fontSize: 13 }}>图表类型</div>
            <Select
              value={chartType}
              onChange={(v) => { setChartType(v); setChartData(null) }}
              style={{ width: '100%' }}
              options={[
                { value: 'trend', label: '折线图（趋势）' },
                { value: 'comparison', label: '柱状图（对比）' },
                { value: 'pie', label: '饼图（环形图）' },
                { value: 'radar', label: '雷达图' },
                { value: 'gauge', label: '仪表盘' },
                { value: 'heatmap', label: '热力图' },
              ]}
            />
          </div>

          {/* 批次多选 */}
          <div style={{ flex: 1, minWidth: 300 }}>
            <div style={{ marginBottom: 4, fontWeight: 500, fontSize: 13 }}>
              选择批次（仅显示指标相同的批次）
            </div>
            <Select
              mode="multiple"
              value={selectedBatchIds}
              onChange={(ids) => {
                // 如果清空，重置
                if (ids.length === 0) {
                  setSelectedBatchIds([])
                  return
                }
                // 校验一致性
                const firstSig = getMetricSignature(batches.find((b) => b.batch_id === ids[0])!)
                const ok = ids.every((id) => {
                  const b = batches.find((b) => b.batch_id === id)
                  return b && getMetricSignature(b) === firstSig
                })
                if (!ok) {
                  message.warning('指标不同无法数据分析，请选择具有相同指标的批次')
                  return
                }
                setSelectedBatchIds(ids)
                setChartData(null)
              }}
              style={{ width: '100%' }}
              options={batchOptions}
              placeholder="请选择已完成处理的批次"
              maxTagCount={3}
            />
          </div>

          {/* 指标多选 */}
          <div style={{ flex: '0 0 250px' }}>
            <div style={{ marginBottom: 4, fontWeight: 500, fontSize: 13 }}>
              选择指标（{selectedMetricKeys.length}/{availableMetrics.length}）
            </div>
            <Select
              mode="multiple"
              value={selectedMetricKeys}
              onChange={(keys) => { setSelectedMetricKeys(keys); setChartData(null) }}
              style={{ width: '100%' }}
              placeholder="请选择指标"
              maxTagCount={3}
              options={[
                { value: '__ALL__', label: `全选 (${availableMetrics.length}个)` },
                ...availableMetrics.map((m) => ({
                  value: m.metric_key,
                  label: m.metric_label,
                })),
              ]}
              onSelect={(val) => {
                if (val === '__ALL__') {
                  setSelectedMetricKeys(availableMetrics.map((m) => m.metric_key))
                }
              }}
              onDeselect={(val) => {
                if (val === '__ALL__') {
                  setSelectedMetricKeys([])
                }
              }}
            />
          </div>
        </div>
      )}

      {/* 量纲冲突提示（非阻断） */}
      {dimensionConflict && dimensionConflict.level !== 'none' && (
        <Alert
          type={dimensionConflict.level === 'high' ? 'warning' : 'info'}
          message={dimensionConflict.level === 'high' ? '量纲差异较大' : '量纲提示'}
          description={dimensionConflict.message}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 图表区域 */}
      {chartData && <ChartRenderer chartType={chartType as ChartType | 'trend' | 'comparison'} data={chartData} />}
      {!chartData && (
        <div style={{ textAlign: 'center', padding: 60, color: '#999', border: '1px dashed #d9d9d9', borderRadius: 8 }}>
          {autoMode ? '请选择批次，然后点击"生成图表"' : '请选择批次和指标，然后点击"生成图表"'}
        </div>
      )}
    </Modal>
  )
}

export default ChartModal
