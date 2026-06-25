// frontend/src/components/AIMetricRecommender.tsx
import React, { useState, useRef, useEffect } from 'react'
import {
  Modal, Button, Checkbox, List, Tag, Space, Spin, message,
  Input, Typography, Tooltip, Radio, Select, Progress,
} from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import { RobotOutlined, EditOutlined, FilePdfOutlined } from '@ant-design/icons'
import api from '../services/api'
import { metricService } from '../services/metricService'
import { extractErrorMessage } from '../utils/errorHandler'
import { templateService } from '../services/templateService'
import { batchService } from '../services/batchService'
import { useAuthStore } from '../stores/authStore'
import { useDraggableModal } from '../hooks/useDraggableModal'

const { Text } = Typography

interface RecommendedMetric {
  metric_key: string
  metric_label: string
  expected_type: 'NUMERIC' | 'TEXT'
  prompt_instruction?: string
}

interface AvailableReport {
  id: number
  original_filename: string
  status: string
}

interface BatchOption {
  batch_id: number
  batch_name: string
}

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
  batchId?: number
  /** AI 推荐指标创建成功后，回传新创建的指标 ID 列表给父组件 */
  onApply?: (ids: number[]) => void
  /** 待上传文件列表（上传前场景），传入后优先于 batchId 模式 */
  pendingFiles?: UploadFile[]
  /** 当前已存在的指标键名集合，用于创建前过滤重复 */
  existingMetricKeys?: string[]
}

const AIMetricRecommender: React.FC<Props> = ({ open, onClose, onCreated, batchId, onApply, pendingFiles, existingMetricKeys }) => {
  const { modalRender } = useDraggableModal()
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

  // 指标名称（metric_label）编辑
  const [editingLabelKey, setEditingLabelKey] = useState<string | null>(null)
  const [editedLabels, setEditedLabels] = useState<Record<string, string>>({})
  const [saveAsTemplate, setSaveAsTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')

  // 报告选择相关 state
  const [reports, setReports] = useState<AvailableReport[]>([])
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null)

  // 批次自选相关 state（当无外部 batchId 时）
  const [userBatches, setUserBatches] = useState<BatchOption[]>([])
  const [selfSelectedBatchId, setSelfSelectedBatchId] = useState<number | null>(null)

  // 待上传文件选择（上传前场景）
  const [selectedFile, setSelectedFile] = useState<UploadFile | null>(null)

  // 请求取消控制器
  const abortRef = useRef<AbortController | null>(null)

  // 模拟进度条（AI 推荐等待期间）
  const [progress, setProgress] = useState(0)

  // 流式输出：实时显示 AI 生成文本
  const [streamText, setStreamText] = useState('')

  // 当弹窗打开且有外部 batchId 时，加载报告列表
  React.useEffect(() => {
    if (open && batchId) {
      api.get(`/batches/${batchId}/available-reports`)
        .then(res => setReports(res.data.data || []))
        .catch((err) => message.error(extractErrorMessage(err, '加载报告列表失败')))
    } else if (open && !batchId) {
      // 无外部 batchId 时加载用户所有批次供自选
      batchService.getBatches(1, 50).then(res => {
        setUserBatches(res.items.map(b => ({
          batch_id: b.batch_id,
          batch_name: b.batch_name || '未命名批次',
        })))
      }).catch(() => { /* 静默失败 */ })
    }
    if (!open) {
      setReports([])
      setSelectedReportId(null)
      setUserBatches([])
      setSelfSelectedBatchId(null)
    }
  }, [open, batchId])

  // 当用户自选批次后，加载该批次的报告列表
  React.useEffect(() => {
    if (open && selfSelectedBatchId && !batchId) {
      api.get(`/batches/${selfSelectedBatchId}/available-reports`)
        .then(res => setReports(res.data.data || []))
        .catch((err) => message.error(extractErrorMessage(err, '加载报告列表失败')))
    }
  }, [open, selfSelectedBatchId, batchId])

  // 模拟进度条动画：loading 时从 0 增长到 90%，完成后跳到 100%
  useEffect(() => {
    if (!loading) {
      if (progress > 0 && progress < 100) {
        // 请求完成，快速跳到 100% 然后重置
        setProgress(100)
        const timer = setTimeout(() => setProgress(0), 600)
        return () => clearTimeout(timer)
      }
      return
    }
    // loading=true：启动递增定时器
    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev < 70) return prev + 5        // 0→70% 快速增长
        if (prev < 85) return prev + 2        // 70→85% 中速
        if (prev < 90) return prev + 1        // 85→90% 慢速（封顶）
        return prev                             // 停在 90% 等 API
      })
    }, 200)
    return () => clearInterval(timer)
  }, [loading, progress])

  const handleRecommend = async () => {
    // 取消前一个未完成的请求
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setProgress(0)
    try {
      // 优先级 1：上传前文件模式 — 直接从 PDF 文件提取文本进行推荐
      if (selectedFile && selectedFile.originFileObj) {
        const formData = new FormData()
        formData.append('file', selectedFile.originFileObj as File)
        const res = await api.post('/metrics/ai-recommend-from-file', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120000,
          signal: controller.signal,
        })
        setResult(res.data)
        const numericKeys = (res.data.recommended_metrics as RecommendedMetric[])
          .filter((m) => m.expected_type === 'NUMERIC')
          .map((m) => m.metric_key)
        setSelected(new Set(numericKeys))
        return
      }

      // 优先级 2：批次模式 / 文本模式 — SSE 流式接收
      const effectiveBatchId = batchId || selfSelectedBatchId
      const body: Record<string, unknown> = {}
      if (effectiveBatchId) {
        body.batch_id = effectiveBatchId
        if (selectedReportId) body.report_id = selectedReportId
      } else {
        body.report_type_hint = reportTypeHint || undefined
      }
      setStreamText('')
      // 原生 fetch 不会自动携带 axios 拦截器注入的 Bearer token，需手动添加
      const token = useAuthStore.getState().accessToken
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`
      const fetchRes = await fetch(`/api/v1/metrics/ai-recommend/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        credentials: 'include',
      })
      if (!fetchRes.ok) {
        // 尝试解析后端返回的详细错误信息
        let errMsg = ''
        try {
          const errData = await fetchRes.json()
          errMsg = errData.detail || errData.message || ''
        } catch { /* 无法解析则使用状态码 */ }
        throw new Error(errMsg || `请求失败 (${fetchRes.status})，请尝试刷新页面重新登录`)
      }
      const reader = fetchRes.body?.getReader()
      if (!reader) throw new Error('不支持流式响应')
      const decoder = new TextDecoder()
      let buffer = ''
      let fullText = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const payload = JSON.parse(line.slice(6))
            if (payload.error) {
              throw new Error(payload.error)
            }
            if (payload.done) {
              // 流式完成，设置结构化结果
              setResult(payload.result)
              const numericKeys = (payload.result.recommended_metrics as RecommendedMetric[])
                .filter((m: RecommendedMetric) => m.expected_type === 'NUMERIC')
                .map((m: RecommendedMetric) => m.metric_key)
              setSelected(new Set(numericKeys))
              setStreamText('')
              return
            }
            if (payload.chunk) {
              fullText += payload.chunk
              setStreamText(fullText)
            }
          } catch {
            // 跳过非 JSON 行
          }
        }
      }
    } catch (err: unknown) {
      // 取消请求不提示错误
      if (err instanceof Error && (err.name === 'CanceledError' || err.name === 'AbortError')) return
      message.error(extractErrorMessage(err, 'AI 推荐失败，请稍后重试'))
    } finally {
      setLoading(false)
      abortRef.current = null
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

    // 前端预检：过滤已存在的重复指标
    const existingSet = new Set(existingMetricKeys || [])
    const newMetrics = toCreate.filter((m) => !existingSet.has(m.metric_key))
    const preDupCount = toCreate.length - newMetrics.length
    if (preDupCount > 0) {
      message.info(`已跳过 ${preDupCount} 个重复指标（键名已存在）`)
    }
    if (newMetrics.length === 0) {
      message.warning('所选指标均已存在，无需创建')
      setCreating(false)
      return
    }

    let created = 0
    let failed = 0
    const alreadyExists: string[] = []
    const createdIds: number[] = []
    for (const m of newMetrics) {
      try {
        const prompt =
          editingKey === m.metric_key ? editingPrompt : m.prompt_instruction
        const label = editedLabels[m.metric_key] || m.metric_label
        const res = await metricService.createMetric({
          metric_key: m.metric_key,
          metric_label: label,
          expected_type: m.expected_type,
          prompt_instruction: prompt,
        })
        createdIds.push(res.data.id)
        created++
      } catch (err: unknown) {
        if ((err as { response?: { status?: number } })?.response?.status === 409) {
          // 已存在，记录名称告知用户
          alreadyExists.push(m.metric_label)
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
          metrics: newMetrics.map((m) => ({
            metric_key: m.metric_key,
            metric_label: editedLabels[m.metric_key] || m.metric_label,
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
    if (alreadyExists.length > 0) {
      message.info(`以下指标已存在，跳过创建：${alreadyExists.join('、')}`)
    }
    onCreated()
    // 如果有 onApply 回调，回传新创建的指标 ID 列表
    if (onApply && createdIds.length > 0) {
      onApply(createdIds)
    }
    handleClose()
  }

  const handleClose = () => {
    // 取消进行中的 AI 推荐请求
    abortRef.current?.abort()
    abortRef.current = null
    setResult(null)
    setSelected(new Set())
    setEditingKey(null)
    setEditingLabelKey(null)
    setEditedLabels({})
    setCreating(false)
    setSaveAsTemplate(false)
    setTemplateName('')
    setReportTypeHint('')
    setReports([])
    setSelectedReportId(null)
    setUserBatches([])
    setSelfSelectedBatchId(null)
    setSelectedFile(null)
    setProgress(0)
    setStreamText('')
    onClose()
  }

  const toggleSelect = (key: string, checked: boolean) => {
    const next = new Set(selected)
    checked ? next.add(key) : next.delete(key)
    setSelected(next)
  }

  return (
    <Modal
      modalRender={modalRender}
      title={
        <Space>
          <RobotOutlined />
          <span>AI 智能推荐指标</span>
        </Space>
      }
      open={open}
      onCancel={handleClose}
      width={700}
      destroyOnHidden
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
                disabled={pendingFiles && pendingFiles.length > 0 && !selectedFile}
              >
                开始推荐
              </Button>,
            ]
      }
    >
      {/* 待上传文件选择（上传前场景，优先级最高） */}
      {!result && pendingFiles && pendingFiles.length > 0 && (
        <div style={{ marginBottom: 16, padding: 12, background: '#f0f5ff', borderRadius: 6 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            <FilePdfOutlined style={{ marginRight: 6 }} />
            从待上传文件中选一份进行 AI 分析：
          </Text>
          <Radio.Group
            value={selectedFile?.uid ?? null}
            onChange={(e) => {
              const found = pendingFiles.find(f => f.uid === e.target.value)
              setSelectedFile(found || null)
              // 选了文件后清空其他模式的状态
              setSelfSelectedBatchId(null)
              setSelectedReportId(null)
              setReports([])
              setReportTypeHint('')
            }}
            style={{ display: 'block', marginBottom: 8 }}
          >
            {pendingFiles.map((f) => (
              <Radio key={f.uid} value={f.uid} style={{ display: 'block', marginBottom: 4 }}>
                {f.name}
              </Radio>
            ))}
          </Radio.Group>
          <Text type="secondary">
            选择一份 PDF，AI 将直接阅读该报告内容来推荐指标体系
          </Text>
        </div>
      )}

      {/* 第一步：选择批次/报告（推荐前） */}
      {!result && !batchId && (!pendingFiles || pendingFiles.length === 0) && (
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>选择要分析的批次：</Text>
          <Select
            placeholder="选择已有批次（可选）"
            value={selfSelectedBatchId}
            onChange={(val) => {
              setSelfSelectedBatchId(val)
              setSelectedReportId(null)
              setReports([])
            }}
            allowClear
            style={{ width: '100%' }}
            options={userBatches.map(b => ({
              value: b.batch_id,
              label: `${b.batch_name}（#${b.batch_id}）`,
            }))}
            notFoundContent="暂无批次"
          />
          {!selfSelectedBatchId && (
            <>
              <Text style={{ display: 'block', marginTop: 12 }}>或者描述报告类型（可选）：</Text>
              <Input
                placeholder="例如：A股年报、美股10-K、港股回购报告..."
                value={reportTypeHint}
                onChange={(e) => setReportTypeHint(e.target.value)}
                style={{ marginTop: 8 }}
              />
            </>
          )}
        </div>
      )}

      {/* 报告选择（有批次且有可用报告时显示） */}
      {!result && (batchId || selfSelectedBatchId) && reports.length > 0 && (
        <div style={{ marginBottom: 16, padding: 12, background: '#fafafa', borderRadius: 6 }}>
          <Text strong>选择要分析的报告：</Text>
          <Radio.Group
            value={selectedReportId}
            onChange={(e) => setSelectedReportId(e.target.value)}
            style={{ display: 'block', marginTop: 8, marginBottom: 8 }}
          >
            {reports.map((r) => (
              <Radio key={r.id} value={r.id} style={{ display: 'block', marginBottom: 4 }}>
                {r.original_filename}
              </Radio>
            ))}
          </Radio.Group>
          <Text type="secondary">
            未选择时自动分析该批次的第一份报告
          </Text>
        </div>
      )}

      {/* 有批次但无可处理报告时显示提示 */}
      {!result && (batchId || selfSelectedBatchId) && reports.length === 0 && !loading && (
        <div style={{ marginBottom: 16, padding: 12, background: '#fff7e6', borderRadius: 6 }}>
          <Text type="warning">该批次中暂无已完成处理的报告，请等待 PDF 处理完成。</Text>
        </div>
      )}

      {/* 加载中 — 进度条 + 阶段提示 */}
      {loading && (
        <div style={{ padding: '40px 20px', textAlign: 'center' }}>
          <Spin style={{ marginBottom: 20 }}>
            <div style={{ height: 32 }} />
          </Spin>
          <Progress
            percent={progress}
            status="active"
            strokeColor={{ from: '#108ee9', to: '#87d068' }}
            style={{ maxWidth: 400, margin: '0 auto' }}
          />
          <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
            {progress < 30
              ? '正在提取报告内容...'
              : progress < 60
              ? 'AI 正在识别关键指标...'
              : progress < 90
              ? '正在生成指标定义...'
              : '即将完成...'}
          </Text>
          {streamText && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                background: '#f5f5f5',
                borderRadius: 6,
                maxHeight: 200,
                overflowY: 'auto',
                textAlign: 'left',
                whiteSpace: 'pre-wrap',
                fontFamily: 'monospace',
                fontSize: 12,
                color: '#666',
              }}
            >
              {streamText}
            </div>
          )}
        </div>
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
                    {editingLabelKey === item.metric_key ? (
                      <Input
                        size="small"
                        value={editedLabels[item.metric_key] ?? item.metric_label}
                        onChange={(e) =>
                          setEditedLabels((prev) => ({
                            ...prev,
                            [item.metric_key]: e.target.value,
                          }))
                        }
                        onBlur={() => setEditingLabelKey(null)}
                        onPressEnter={() => setEditingLabelKey(null)}
                        autoFocus
                        style={{ width: 160 }}
                      />
                    ) : (
                      <Space size={4}>
                        <Text strong>
                          {editedLabels[item.metric_key] || item.metric_label}
                        </Text>
                        <Tooltip title="编辑指标名称">
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingLabelKey(item.metric_key)
                              if (!editedLabels[item.metric_key]) {
                                setEditedLabels((prev) => ({
                                  ...prev,
                                  [item.metric_key]: item.metric_label,
                                }))
                              }
                            }}
                            style={{ fontSize: 11, color: '#999' }}
                          />
                        </Tooltip>
                      </Space>
                    )}
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
