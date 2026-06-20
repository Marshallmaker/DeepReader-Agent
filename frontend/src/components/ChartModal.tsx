import { useState, useEffect } from 'react'
import { Modal, Button, Select, message } from 'antd'
import { BarChartOutlined, LineChartOutlined } from '@ant-design/icons'
import { BatchResponse, MetricTagInfo } from '../services/batchService'
import { visualizationService, MultiSeriesTrendResponse, MultiSeriesComparisonResponse } from '../services/visualizationService'
import ChartRenderer from './ChartRenderer'

interface ChartModalProps {
  open: boolean
  chartType: 'trend' | 'comparison'
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

function ChartModal({ open, chartType: initialType, batches, selectedBatch, onClose }: ChartModalProps) {
  // ── 图表类型 ──────────────────────────────────────────
  const [chartType, setChartType] = useState<'trend' | 'comparison'>(initialType)
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

  const handleGenerate = async () => {
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
      if (chartType === 'trend') {
        result = await visualizationService.getTrendData(selectedBatchIds, selectedMetricKeys)
      } else {
        result = await visualizationService.getComparisonData(selectedBatchIds, selectedMetricKeys)
      }
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
      title={
        <span className="modal-title">
          {chartType === 'trend' ? <LineChartOutlined /> : <BarChartOutlined />}
          {' '}{chartType === 'trend' ? '趋势分析' : '横向对比'}
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
                label: `${m.metric_label} (${m.metric_key})`,
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

      {/* 图表区域 */}
      {chartData && <ChartRenderer chartType={chartType} data={chartData} />}
      {!chartData && (
        <div style={{ textAlign: 'center', padding: 60, color: '#999', border: '1px dashed #d9d9d9', borderRadius: 8 }}>
          请选择批次和指标，然后点击"生成图表"
        </div>
      )}
    </Modal>
  )
}

export default ChartModal
