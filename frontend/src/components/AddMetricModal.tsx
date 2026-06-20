import { useState } from 'react'
import { Modal, Button, Select, message } from 'antd'
import { metricService, CreateMetricRequest } from '../services/metricService'
import { extractErrorMessage } from '../utils/errorHandler'

const { Option } = Select

interface AddMetricModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

function AddMetricModal({ open, onClose, onCreated }: AddMetricModalProps) {
  const [form, setForm] = useState<CreateMetricRequest>({
    metric_key: '', metric_label: '', expected_type: 'NUMERIC',
  })

  const handleCreate = async () => {
    if (!form.metric_key || !form.metric_label) {
      message.warning('请填写指标键和显示名称')
      return
    }
    try {
      await metricService.createMetric(form)
      message.success('指标创建成功')
      setForm({ metric_key: '', metric_label: '', expected_type: 'NUMERIC' })
      onClose()
      onCreated()
    } catch (error) {
      message.error(extractErrorMessage(error, '创建失败'))
    }
  }

  return (
    <Modal
      title="添加自定义指标" open={open} onCancel={onClose} width={500} className="add-metric-modal"
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="confirm" type="primary" onClick={handleCreate}>创建</Button>,
      ]}
    >
      <div className="form-item">
        <label>指标键名 *</label>
        <input type="text" value={form.metric_key}
          onChange={(e) => setForm({ ...form, metric_key: e.target.value })}
          placeholder="如: net_profit" className="form-input" />
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
