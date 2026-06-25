import { useState } from 'react'
import { Modal, Button, Checkbox, Tag, message, Space, Tooltip } from 'antd'
import { SettingOutlined, PlusOutlined, DeleteOutlined, EditOutlined, BulbOutlined } from '@ant-design/icons'
import { MetricDefinition, metricService } from '../services/metricService'
import { extractErrorMessage } from '../utils/errorHandler'
import { useDraggableModal } from '../hooks/useDraggableModal'
import TemplateSelector from './TemplateSelector'
import AIMetricRecommender from './AIMetricRecommender'

interface MetricSettingsModalProps {
  open: boolean
  metrics: MetricDefinition[]
  selectedIds: number[]
  onSelectionChange: (ids: number[]) => void
  onClose: () => void
  onAddMetric: () => void
  onDeleteMetric: (id: number) => Promise<void>
  /** 模板导入完成后触发，用于刷新父组件中的指标列表 */
  onRefresh: () => void
  /** 编辑自定义指标回调 */
  onEditMetric?: (metric: MetricDefinition) => void
  /** 当前选中的批次 ID，传入后 AI 推荐将分析该批次的 PDF 内容 */
  batchId?: number
}

function MetricSettingsModal({
  open, metrics, selectedIds, onSelectionChange,
  onClose, onAddMetric, onDeleteMetric, onRefresh, onEditMetric,
  batchId,
}: MetricSettingsModalProps) {
  const { modalRender } = useDraggableModal()
  const [showAIRecommender, setShowAIRecommender] = useState(false)

  const handleSelectAll = (checked: boolean) => {
    onSelectionChange(checked ? metrics.map(m => m.id) : [])
  }

  const handleToggle = (id: number) => {
    onSelectionChange(
      selectedIds.includes(id) ? selectedIds.filter(i => i !== id) : [...selectedIds, id]
    )
  }

  const handleDelete = async (id: number) => {
    try {
      await onDeleteMetric(id)
      message.success('指标删除成功')
    } catch (error) {
      message.error(extractErrorMessage(error, '删除失败'))
    }
  }

  /** 仅勾选非系统预置的自定义指标 */
  const handleSelectCustomOnly = () => {
    const customIds = metrics.filter(m => !m.is_system).map(m => m.id)
    onSelectionChange(customIds)
  }

  /** 批量删除选中的指标 */
  const handleBatchDelete = () => {
    if (selectedIds.length === 0) {
      message.warning('请先勾选要删除的指标')
      return
    }
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedIds.length} 个指标吗？系统预置指标将被自动跳过，此操作不可撤销。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const result = await metricService.deleteMetrics(selectedIds)
          const parts: string[] = [`成功删除 ${result.deleted_count} 个指标`]
          if (result.skipped_count > 0) {
            parts.push(`跳过 ${result.skipped_count} 个（系统预置或无权操作）`)
          }
          message.success(parts.join('，'))
          onSelectionChange([])
          onRefresh()
        } catch (error) {
          message.error(extractErrorMessage(error, '批量删除失败'))
        }
      },
    })
  }

  /** 当前选中的指标数量 */
  const selectedCount = selectedIds.length

  return (
    <Modal
      modalRender={modalRender}
      title={<span className="modal-title"><SettingOutlined /> 指标勾选矩阵</span>}
      open={open} onCancel={onClose} width={700} className="metric-modal"
      footer={[<Button key="close" onClick={onClose}>关闭</Button>]}
    >
      <div className="metric-matrix">
        <div className="select-all-row">
          <Checkbox
            checked={selectedIds.length === metrics.length && metrics.length > 0}
            indeterminate={selectedIds.length > 0 && selectedIds.length < metrics.length}
            onChange={(e) => handleSelectAll(e.target.checked)}
          >
            全选 ({metrics.length}个)
          </Checkbox>
          <Space>
            <Tooltip title="仅勾选非系统预置的指标">
              <Button size="small" onClick={handleSelectCustomOnly}>仅选自定</Button>
            </Tooltip>
            <Button
              size="small"
              danger
              disabled={selectedCount === 0}
              icon={<DeleteOutlined />}
              onClick={handleBatchDelete}
            >
              批量删除{selectedCount > 0 ? ` (${selectedCount})` : ''}
            </Button>
            <TemplateSelector onImportComplete={onRefresh} />
            <Button icon={<PlusOutlined />} onClick={onAddMetric} className="add-metric-btn">添加指标</Button>
            <Button
              icon={<BulbOutlined />}
              onClick={() => setShowAIRecommender(true)}
              className="ai-recommend-btn"
            >
              AI 推荐指标
            </Button>
          </Space>
        </div>

        <div className="metric-list">
          {metrics.map(metric => (
            <div key={metric.id} className="metric-item">
              <Checkbox
                checked={selectedIds.includes(metric.id)}
                onChange={() => handleToggle(metric.id)}
              >
                <span className="metric-label">{metric.metric_label}</span>
                {metric.is_system && <Tag color="blue">系统预置</Tag>}
              </Checkbox>
              <span className="metric-key">{metric.metric_key}</span>
              <span className="metric-type">{metric.expected_type}</span>
              {!metric.is_system && (
                <>
                  <Button type="text" onClick={() => onEditMetric?.(metric)} className="edit-metric-btn">
                    <EditOutlined />
                  </Button>
                  <Button type="text" danger onClick={() => handleDelete(metric.id)} className="delete-metric-btn">
                    <DeleteOutlined />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
      <AIMetricRecommender
        open={showAIRecommender}
        onClose={() => setShowAIRecommender(false)}
        onCreated={onRefresh}
        batchId={batchId}
        existingMetricKeys={metrics.map(m => m.metric_key)}
      />
    </Modal>
  )
}

export default MetricSettingsModal
