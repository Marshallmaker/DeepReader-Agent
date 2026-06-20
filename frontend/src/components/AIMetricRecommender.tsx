// frontend/src/components/AIMetricRecommender.tsx
import React, { useState } from 'react'
import {
  Modal, Button, Checkbox, List, Tag, Space, Spin, message,
  Input, Typography, Tooltip,
} from 'antd'
import { RobotOutlined, EditOutlined } from '@ant-design/icons'
import api from '../services/api'
import { metricService } from '../services/metricService'
import { templateService } from '../services/templateService'
import { extractErrorMessage } from '../utils/errorHandler'

const { Text } = Typography

interface RecommendedMetric {
  metric_key: string
  metric_label: string
  expected_type: 'NUMERIC' | 'TEXT'
  prompt_instruction?: string
}

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
  batchId?: number
}

const AIMetricRecommender: React.FC<Props> = ({ open, onClose, onCreated, batchId }) => {
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState<{
    report_type: string
    recommended_metrics: RecommendedMetric[]
  } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editingPrompt, setEditingPrompt] = useState('')
  const [reportTypeHint, setReportTypeHint] = useState('')
  const [saveAsTemplate, setSaveAsTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')

  const handleRecommend = async () => {
    setLoading(true)
    try {
      const body: Record<string, unknown> = {}
      if (batchId) {
        body.batch_id = batchId
      } else {
        body.report_type_hint = reportTypeHint || undefined
      }
      const res = await api.post('/metrics/ai-recommend', body)
      setResult(res.data)
      // 默认全选所有数值型指标
      const numericKeys = (res.data.recommended_metrics as RecommendedMetric[])
        .filter((m) => m.expected_type === 'NUMERIC')
        .map((m) => m.metric_key)
      setSelected(new Set(numericKeys))
    } catch (err: unknown) {
      message.error(extractErrorMessage(err, 'AI 推荐失败，请稍后重试'))
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!result) return
    const toCreate = result.recommended_metrics.filter((m) => selected.has(m.metric_key))
    if (toCreate.length === 0) {
      message.warning('请至少选择一个指标')
      return
    }

    setCreating(true)
    let created = 0
    let failed = 0
    for (const m of toCreate) {
      try {
        const prompt =
          editingKey === m.metric_key ? editingPrompt : m.prompt_instruction
        await metricService.createMetric({
          metric_key: m.metric_key,
          metric_label: m.metric_label,
          expected_type: m.expected_type,
          prompt_instruction: prompt,
        })
        created++
      } catch (err: unknown) {
        if ((err as { response?: { status?: number } })?.response?.status === 409) {
          // 已存在，不算失败
        } else {
          failed++
        }
      }
    }

    // 如果勾选了保存为模板
    if (saveAsTemplate && templateName.trim()) {
      try {
        await templateService.createTemplate({
          name: templateName.trim(),
          description: `AI 推荐: ${result.report_type}`,
          category: result.report_type,
          metrics: toCreate.map((m) => ({
            metric_key: m.metric_key,
            metric_label: m.metric_label,
            expected_type: m.expected_type,
            prompt_instruction:
              editingKey === m.metric_key ? editingPrompt : m.prompt_instruction,
          })),
        })
        message.success(`模板「${templateName.trim()}」已保存`)
      } catch (err) {
        console.warn('模板保存失败', err)
        message.warning('模板保存失败，但指标创建成功')
      }
    }

    message.success(`成功创建 ${created} 个指标${failed > 0 ? `，${failed} 个失败` : ''}`)
    onCreated()
    handleClose()
  }

  const handleClose = () => {
    setResult(null)
    setSelected(new Set())
    setEditingKey(null)
    setCreating(false)
    setSaveAsTemplate(false)
    setTemplateName('')
    setReportTypeHint('')
    onClose()
  }

  const toggleSelect = (key: string, checked: boolean) => {
    const next = new Set(selected)
    checked ? next.add(key) : next.delete(key)
    setSelected(next)
  }

  return (
    <Modal
      title={
        <Space>
          <RobotOutlined />
          <span>AI 智能推荐指标</span>
        </Space>
      }
      open={open}
      onCancel={handleClose}
      width={700}
      destroyOnClose
      footer={
        result
          ? [
              <Button key="cancel" onClick={handleClose}>
                取消
              </Button>,
              <Button
                key="create"
                type="primary"
                loading={creating}
                onClick={handleCreate}
              >
                一键创建（{selected.size} 个已选）
              </Button>,
            ]
          : [
              <Button key="cancel" onClick={handleClose}>
                取消
              </Button>,
              <Button
                key="recommend"
                type="primary"
                loading={loading}
                onClick={handleRecommend}
              >
                开始推荐
              </Button>,
            ]
      }
    >
      {/* 第一步：输入描述（无 batchId 时显示） */}
      {!result && !batchId && (
        <div style={{ marginBottom: 16 }}>
          <Text>描述你想分析的报告类型（可选）：</Text>
          <Input
            placeholder="例如：A股年报、美股10-K、港股回购报告..."
            value={reportTypeHint}
            onChange={(e) => setReportTypeHint(e.target.value)}
            style={{ marginTop: 8 }}
          />
          <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            留空将进行通用分析；提供类型可获得更精准的推荐
          </Text>
        </div>
      )}

      {/* 加载中 */}
      {loading && (
        <Spin
          tip="AI 正在分析报告内容..."
          style={{ display: 'block', padding: 40 }}
        >
          <div style={{ height: 80 }} />
        </Spin>
      )}

      {/* 推荐结果 */}
      {result && (
        <>
          {/* 报告类型标识 */}
          <div
            style={{
              marginBottom: 16,
              padding: 12,
              background: '#f6ffed',
              borderRadius: 6,
            }}
          >
            <Text strong>识别报告类型：</Text>
            <Tag color="green" style={{ marginLeft: 8 }}>
              {result.report_type}
            </Tag>
            <Text type="secondary" style={{ marginLeft: 8 }}>
              共推荐 {result.recommended_metrics.length} 个指标
            </Text>
          </div>

          {/* 快捷操作 */}
          <Space style={{ marginBottom: 12 }}>
            <Button
              size="small"
              onClick={() =>
                setSelected(
                  new Set(result.recommended_metrics.map((m) => m.metric_key))
                )
              }
            >
              全选
            </Button>
            <Button
              size="small"
              onClick={() =>
                setSelected(
                  new Set(
                    result.recommended_metrics
                      .filter((m) => m.expected_type === 'NUMERIC')
                      .map((m) => m.metric_key)
                  )
                )
              }
            >
              仅选数值型
            </Button>
            <Button size="small" onClick={() => setSelected(new Set())}>
              取消全选
            </Button>
          </Space>

          {/* 指标列表 */}
          <List
            dataSource={result.recommended_metrics}
            style={{ maxHeight: 400, overflow: 'auto' }}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Tooltip title="编辑提示词" key="edit">
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => {
                        setEditingKey(
                          editingKey === item.metric_key ? null : item.metric_key
                        )
                        setEditingPrompt(item.prompt_instruction || '')
                      }}
                    />
                  </Tooltip>,
                ]}
              >
                <Checkbox
                  checked={selected.has(item.metric_key)}
                  onChange={(e) => toggleSelect(item.metric_key, e.target.checked)}
                >
                  <Space>
                    <Tag
                      color={item.expected_type === 'NUMERIC' ? 'blue' : 'orange'}
                    >
                      {item.expected_type}
                    </Tag>
                    <Text strong>{item.metric_label}</Text>
                    <Text code>{item.metric_key}</Text>
                  </Space>
                </Checkbox>
              </List.Item>
            )}
          />

          {/* 提示词编辑区（展开在列表下方） */}
          {editingKey && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                background: '#fafafa',
                borderRadius: 6,
              }}
            >
              <Text strong>
                编辑提示词 —
                <Text code style={{ marginLeft: 4 }}>
                  {editingKey}
                </Text>
              </Text>
              <Input.TextArea
                value={editingPrompt}
                onChange={(e) => setEditingPrompt(e.target.value)}
                rows={3}
                style={{ marginTop: 8 }}
                placeholder="指导 AI 如何从报告中提取该指标..."
              />
            </div>
          )}

          {/* 保存为模板 */}
          <div
            style={{
              marginTop: 16,
              padding: 12,
              border: '1px dashed #d9d9d9',
              borderRadius: 6,
            }}
          >
            <Checkbox
              checked={saveAsTemplate}
              onChange={(e) => setSaveAsTemplate(e.target.checked)}
            >
              同时保存为我的模板
            </Checkbox>
            {saveAsTemplate && (
              <Input
                placeholder="模板名称（如：我的港股回购模板）"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                style={{ marginTop: 8 }}
              />
            )}
          </div>
        </>
      )}
    </Modal>
  )
}

export default AIMetricRecommender
