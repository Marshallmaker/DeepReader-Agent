import { useState, useEffect } from 'react'
import { Modal, Button, Select, message } from 'antd'
import { metricService, CreateMetricRequest, MetricDefinition, UpdateMetricRequest } from '../services/metricService'
import { extractErrorMessage } from '../utils/errorHandler'

const { Option } = Select

interface AddMetricModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
  /** 模式：创建或编辑（默认 create） */
  mode?: 'create' | 'edit'
  /** 编辑模式下要编辑的指标对象 */
  editTarget?: MetricDefinition | null
}

function AddMetricModal({ open, onClose, onCreated, mode = 'create', editTarget = null }: AddMetricModalProps) {
  const isEdit = mode === 'edit'

  const [form, setForm] = useState<CreateMetricRequest>({
    metric_key: '', metric_label: '', expected_type: 'NUMERIC',
  })

  // 编辑模式下，当 editTarget 变化或弹窗打开时回填数据
  useEffect(() => {
    if (isEdit && editTarget && open) {
      setForm({
        metric_key: editTarget.metric_key,
        metric_label: editTarget.metric_label,
        expected_type: editTarget.expected_type,
        prompt_instruction: editTarget.prompt_instruction || '',
      })
    } else if (!isEdit) {
      setForm({ metric_key: '', metric_label: '', expected_type: 'NUMERIC' })
    }
  }, [isEdit, editTarget, open])

  const buildUpdatePayload = (): UpdateMetricRequest => {
    const payload: UpdateMetricRequest = {}
    if (form.metric_label) payload.metric_label = form.metric_label
    if (form.expected_type) payload.expected_type = form.expected_type
    if (form.prompt_instruction !== undefined) payload.prompt_instruction = form.prompt_instruction
    return payload
  }

  const handleSubmit = async () => {
    if (!form.metric_key || !form.metric_label) {
      message.warning('请填写指标键和显示名称')
      return
    }
    try {
      if (isEdit && editTarget) {
        await metricService.updateMetric(editTarget.id, buildUpdatePayload())
        message.success('指标更新成功')
      } else {
        await metricService.createMetric(form)
        message.success('指标创建成功')
      }
      setForm({ metric_key: '', metric_label: '', expected_type: 'NUMERIC' })
      onClose()
      onCreated()
    } catch (error) {
      message.error(extractErrorMessage(error, isEdit ? '更新失败' : '创建失败'))
    }
  }

  return (
    <Modal
      title={isEdit ? '编辑指标' : '添加自定义指标'}
      open={open} onCancel={onClose} width={500} className="add-metric-modal"
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="confirm" type="primary" onClick={handleSubmit}>
          {isEdit ? '保存' : '创建'}
        </Button>,
      ]}
    >
      <div className="form-item">
        <label>指标键名 *</label>
        <input type="text" value={form.metric_key}
          onChange={(e) => setForm({ ...form, metric_key: e.target.value })}
          placeholder="如: net_profit" className="form-input"
          disabled={isEdit} />
      </div>
      <div className="form-item">
        <label>显示名称 *</label>
        <input type="text" value={form.metric_label}
          onChange={(e) => setForm({ ...form, metric_label: e.target.value })}
          placeholder="如: 净利润" className="form-input" />
      </div>
      <div className="form-item">
        <label>数据类型</label>
        <Select value={form.expected_type}
          onChange={(value) => setForm({ ...form, expected_type: value as 'NUMERIC' | 'TEXT' })}
          className="form-select">
          <Option value="NUMERIC">数值型</Option>
          <Option value="TEXT">文本型</Option>
        </Select>
      </div>
      <div className="form-item">
        <label>提取提示词（可选）</label>
        <textarea value={form.prompt_instruction}
          onChange={(e) => setForm({ ...form, prompt_instruction: e.target.value })}
          placeholder="指导AI如何提取该指标..." className="form-textarea" rows={3} />
      </div>
    </Modal>
  )
}

export default AddMetricModal
