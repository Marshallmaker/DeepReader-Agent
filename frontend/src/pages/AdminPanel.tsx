import { useState, useEffect } from 'react'
import { Table, Card, Button, Tag, Space, Input, Select, Modal, message, Collapse, Tabs, Switch, Form } from 'antd'
import { SearchOutlined, HistoryOutlined, EyeOutlined, FileTextOutlined, UserOutlined, PlusOutlined, EditOutlined, DeleteOutlined, CheckCircleOutlined, StopOutlined } from '@ant-design/icons'
import api from '../services/api'
import { metricService, MetricDefinition } from '../services/metricService'
import { templateService, TemplateResponse, MetricItem } from '../services/templateService'
import { useDraggableModal } from '../hooks/useDraggableModal'
import '../styles/components.css'
import './AdminPanel.css'

interface UserItem {
  id: number
  email: string
  nickname: string | null
  is_active: boolean
  is_admin: boolean
  created_at: string
  batch_count: number
}

interface BatchItem {
  batch_id: number
  batch_name: string | null
  status: string
  total_files: number
  created_at: string
}

interface ReportItem {
  report_id: number
  filename: string
  status: string
  created_at: string
}

interface ReportDetail {
  report_id: number
  batch_id: number
  filename: string
  status: string
  raw_markdown: string | null
  error_message: string | null
  created_at: string
  metrics: {
    company_name: string | null
    stock_code: string | null
    raw_json: string | null
  }
}

function AdminPanel() {
  const { modalRender } = useDraggableModal()

  // ===== 用户管理状态 =====
  const [users, setUsers] = useState<UserItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<boolean | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [selectedUser, setSelectedUser] = useState<number | null>(null)
  const [userBatches, setUserBatches] = useState<BatchItem[]>([])
  const [userBatchesModal, setUserBatchesModal] = useState(false)
  const [selectedBatch, setSelectedBatch] = useState<number | null>(null)
  const [batchReports, setBatchReports] = useState<ReportItem[]>([])
  const [reportsModal, setReportsModal] = useState(false)
  const [reportDetail, setReportDetail] = useState<ReportDetail | null>(null)
  const [reportDetailModal, setReportDetailModal] = useState(false)

  const [pagination, setPagination] = useState({
    current: 1, pageSize: 10, total: 0,
  })

  // ===== 指标模版管理状态 =====
  const [metrics, setMetrics] = useState<MetricDefinition[]>([])
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [metricsPagination, setMetricsPagination] = useState({
    current: 1, pageSize: 20, total: 0,
  })
  const [showCreateMetric, setShowCreateMetric] = useState(false)
  const [showEditMetric, setShowEditMetric] = useState(false)
  const [editingMetric, setEditingMetric] = useState<MetricDefinition | null>(null)
  const [createForm] = Form.useForm()
  const [editForm] = Form.useForm()

  // ===== 合集模版管理状态 =====
  const [templates, setTemplates] = useState<TemplateResponse[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [templatesPagination, setTemplatesPagination] = useState({
    current: 1, pageSize: 20, total: 0,
  })
  const [tplCategoryFilter, setTplCategoryFilter] = useState<string | null>(null)
  const [tplStatusFilter, setTplStatusFilter] = useState<boolean | null>(null)
  const [showCreateTemplate, setShowCreateTemplate] = useState(false)
  const [showEditTemplate, setShowEditTemplate] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<TemplateResponse | null>(null)
  const [editableMetrics, setEditableMetrics] = useState<MetricItem[]>([])
  const [editInitialMetricCount, setEditInitialMetricCount] = useState(0)  // 编辑弹窗：已有指标数量，用于区分新/旧行
  const [createTemplateForm] = Form.useForm()
  const [editTemplateForm] = Form.useForm()

  useEffect(() => { loadUsers(1, 10) }, [])

  // ==================== 用户管理 ====================

  const loadUsers = async (
    page: number,
    pageSize: number,
    statusOverride?: boolean | null,
    orderOverride?: 'asc' | 'desc'
  ) => {
    setLoading(true)
    try {
      const params: any = { page, page_size: pageSize }
      if (searchKeyword) params.search_keyword = searchKeyword
      const effectiveStatus = statusOverride !== undefined ? statusOverride : statusFilter
      if (effectiveStatus != null) params.is_active = effectiveStatus
      const effectiveOrder = orderOverride || sortOrder
      params.order = effectiveOrder
      const response = await api.get('/admin/users', { params })
      setUsers(response.data.items)
      setPagination({
        current: response.data.page,
        pageSize: response.data.page_size,
        total: response.data.total,
      })
    } catch {
      message.error('加载用户列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleStatus = async (userId: number) => {
    try {
      const response = await api.patch(`/admin/users/${userId}/status`)
      message.success(response.data.message)
      loadUsers(pagination.current, pagination.pageSize)
    } catch (error: any) {
      message.error(error.response?.data?.message || '操作失败')
    }
  }

  const handleViewUserBatches = async (userId: number) => {
    setLoading(true)
    try {
      const response = await api.get(`/admin/users/${userId}/batches`)
      setSelectedUser(userId)
      setUserBatches(response.data.items)
      setUserBatchesModal(true)
    } catch {
      message.error('加载用户批次失败')
    } finally {
      setLoading(false)
    }
  }

  const handleViewBatchReports = async (batchId: number) => {
    setLoading(true)
    try {
      const response = await api.get(`/batches/${batchId}`)
      setSelectedBatch(batchId)
      setBatchReports(response.data.reports.map((r: any) => ({
        report_id: r.report_id, filename: r.filename,
        status: r.status, created_at: r.created_at,
      })))
      setUserBatchesModal(false)
      setReportsModal(true)
    } catch {
      message.error('加载批次报告失败')
    } finally {
      setLoading(false)
    }
  }

  const handleViewReportDetail = async (reportId: number) => {
    setLoading(true)
    try {
      const response = await api.get(`/admin/reports/${reportId}`)
      setReportDetail(response.data)
      setReportsModal(false)
      setReportDetailModal(true)
    } catch {
      message.error('加载报告详情失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => loadUsers(1, pagination.pageSize)

  // ==================== 指标模版管理 ====================

  const loadMetrics = async (page = 1, pageSize = 20) => {
    setMetricsLoading(true)
    try {
      const response = await metricService.getAdminMetrics({ page, page_size: pageSize })
      setMetrics(response.items)
      setMetricsPagination({
        current: response.page,
        pageSize: response.page_size,
        total: response.total,
      })
    } catch {
      message.error('加载系统指标列表失败')
    } finally {
      setMetricsLoading(false)
    }
  }

  const handleToggleMetricActive = async (metricId: number) => {
    try {
      const response = await metricService.toggleSystemMetricActive(metricId)
      message.success(response.message)
      loadMetrics(metricsPagination.current, metricsPagination.pageSize)
    } catch (error: any) {
      if (error.response) {
        message.error((error.response.data?.detail || error.response.data?.message) || '切换状态失败')
      } else if (error.message) {
        message.error(error.message)
      } else {
        message.error('操作失败，请检查网络连接或重新登录')
      }
    }
  }

  const handleCreateMetric = async () => {
    try {
      const values = await createForm.validateFields()
      await metricService.createSystemMetric(values)
      message.success('系统指标模版创建成功')
      setShowCreateMetric(false)
      createForm.resetFields()
      loadMetrics(1, metricsPagination.pageSize)
    } catch (error: any) {
      if (error.response) {
        message.error((error.response.data?.detail || error.response.data?.message) || '创建失败')
      } else if (error.message) {
        message.error(error.message)
      } else {
        message.error('创建指标模版失败，请检查网络连接或重新登录')
      }
    }
  }

  const handleEditMetric = async () => {
    if (!editingMetric) return
    try {
      const values = await editForm.validateFields()
      await metricService.updateSystemMetric(editingMetric.id, values)
      message.success('系统指标模版更新成功')
      setShowEditMetric(false)
      setEditingMetric(null)
      editForm.resetFields()
      loadMetrics(metricsPagination.current, metricsPagination.pageSize)
    } catch (error: any) {
      if (error.response) {
        message.error((error.response.data?.detail || error.response.data?.message) || '更新失败')
      } else if (error.message) {
        message.error(error.message)
      } else {
        message.error('更新指标模版失败，请检查网络连接或重新登录')
      }
    }
  }

  const handleDeleteMetric = (metric: MetricDefinition) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除系统指标模版「${metric.metric_label}」吗？此操作不可撤销，关联的批次指标绑定将被一并删除。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await metricService.deleteSystemMetric(metric.id)
          message.success(`系统指标模版「${metric.metric_label}」已删除`)
          loadMetrics(metricsPagination.current, metricsPagination.pageSize)
        } catch (error: any) {
          if (error.response) {
            message.error((error.response.data?.detail || error.response.data?.message) || '删除失败')
          } else if (error.message) {
            message.error(error.message)
          } else {
            message.error('删除失败，请检查网络连接或重新登录')
          }
        }
      },
    })
  }

  const openEditModal = (metric: MetricDefinition) => {
    setEditingMetric(metric)
    editForm.setFieldsValue({
      metric_label: metric.metric_label,
      expected_type: metric.expected_type,
      prompt_instruction: metric.prompt_instruction || '',
      is_active: metric.is_active,
    })
    setShowEditMetric(true)
  }

  // ==================== 合集模版管理 ====================

  const loadTemplates = async (
    page = 1, pageSize = 20,
    category?: string | null, status?: boolean | null
  ) => {
    setTemplatesLoading(true)
    try {
      const params: any = { page, page_size: pageSize }
      if (category) params.category = category
      if (status != null) params.is_active = status
      const response = await templateService.getAdminTemplates(params)
      setTemplates(response.items)
      setTemplatesPagination({
        current: response.page,
        pageSize: response.page_size,
        total: response.total,
      })
    } catch {
      message.error('加载合集模版列表失败')
    } finally {
      setTemplatesLoading(false)
    }
  }

  const handleToggleTemplateActive = async (templateId: number) => {
    try {
      const response = await templateService.adminToggleTemplateActive(templateId)
      message.success(response.message)
      loadTemplates(templatesPagination.current, templatesPagination.pageSize, tplCategoryFilter, tplStatusFilter)
      // 刷新指标模版列表，反映级联同步结果
      loadMetrics(metricsPagination.current, metricsPagination.pageSize)
    } catch (error: any) {
      if (error.response) {
        message.error((error.response.data?.detail || error.response.data?.message) || '切换状态失败')
      } else if (error.message) {
        message.error(error.message)
      } else {
        message.error('操作失败，请检查网络连接或重新登录')
      }
    }
  }

  const handleBulkToggleAll = async (isActive: boolean) => {
    const action = isActive ? '启用' : '禁用'
    Modal.confirm({
      title: `确认${action}全部系统模版`,
      content: `确定要一键${action}所有系统合集模版吗？此操作将同步${action}所有系统指标定义。`,
      okText: `确认${action}`,
      cancelText: '取消',
      onOk: async () => {
        try {
          const response = await templateService.adminBulkToggleAllSystem(isActive)
          message.success(response.message)
          loadTemplates(templatesPagination.current, templatesPagination.pageSize, tplCategoryFilter, tplStatusFilter)
          // 刷新指标模版列表，反映级联同步结果
          loadMetrics(1, metricsPagination.pageSize)
        } catch (error: any) {
          message.error((error.response?.data?.detail || error.response?.data?.message) || '操作失败')
        }
      },
    })
  }

  const METRIC_KEY_REGEX = /^[a-z_][a-z0-9_]*$/

  const handleCreateTemplate = async () => {
    try {
      const values = await createTemplateForm.validateFields()

      // 前端校验：至少需要一个指标
      const validMetrics = editableMetrics.filter(m => m.metric_key.trim() || m.metric_label.trim())
      if (validMetrics.length === 0) {
        message.error('请至少添加一个指标，并填写指标键和指标名')
        return
      }

      // 前端校验：检查每个指标是否填写完整
      for (let i = 0; i < editableMetrics.length; i++) {
        const m = editableMetrics[i]
        if (!m.metric_key.trim()) {
          message.error(`第 ${i + 1} 个指标的「指标键」不能为空`)
          return
        }
        if (!m.metric_label.trim()) {
          message.error(`第 ${i + 1} 个指标的「指标名」不能为空`)
          return
        }
        if (!METRIC_KEY_REGEX.test(m.metric_key.trim())) {
          message.error(`第 ${i + 1} 个指标的「指标键」格式不正确：仅支持小写字母、数字和下划线，必须以字母或下划线开头`)
          return
        }
      }

      // 前端校验：同一合集中不允许重复的指标键
      const keyMap = new Map<string, number>()
      for (let i = 0; i < editableMetrics.length; i++) {
        const key = editableMetrics[i].metric_key.trim()
        if (!key) continue
        if (keyMap.has(key)) {
          message.error(`第 ${i + 1} 个指标的「指标键」"${key}" 与第 ${keyMap.get(key)! + 1} 个重复，同一合集中不允许相同的指标键`)
          return
        }
        keyMap.set(key, i)
      }

      // 前端校验：同一合集中指标名重复仅警告，不阻止
      const labelMap = new Map<string, number>()
      for (let i = 0; i < editableMetrics.length; i++) {
        const label = editableMetrics[i].metric_label.trim()
        if (!label) continue
        if (labelMap.has(label)) {
          message.warning(`第 ${i + 1} 个指标的「指标名」"${label}" 与第 ${labelMap.get(label)! + 1} 个重复`)
        } else {
          labelMap.set(label, i)
        }
      }

      await templateService.adminCreateTemplate({
        ...values,
        metrics: editableMetrics.map(m => ({ ...m, metric_key: m.metric_key.trim(), metric_label: m.metric_label.trim() })),
      })
      message.success('合集模版创建成功')
      setShowCreateTemplate(false)
      createTemplateForm.resetFields()
      setEditableMetrics([])
      loadTemplates(1, templatesPagination.pageSize)
    } catch (error: any) {
      if (error.response) {
        message.error((error.response.data?.detail || error.response.data?.message) || '创建失败')
      } else if (error.message) {
        message.error(error.message)
      } else {
        message.error('创建合集模版失败，请检查网络连接或重新登录')
      }
    }
  }

  const handleEditTemplate = async () => {
    if (!editingTemplate) return
    try {
      const values = await editTemplateForm.validateFields()

      // 前端校验：逐项检查指标填写完整性
      for (let i = 0; i < editableMetrics.length; i++) {
        const m = editableMetrics[i]
        if (!m.metric_key.trim()) {
          message.error(`第 ${i + 1} 个指标的「指标键」不能为空`)
          return
        }
        if (!m.metric_label.trim()) {
          message.error(`第 ${i + 1} 个指标的「指标名」不能为空`)
          return
        }
        if (!METRIC_KEY_REGEX.test(m.metric_key.trim())) {
          message.error(`第 ${i + 1} 个指标的「指标键」格式不正确：仅支持小写字母、数字和下划线，必须以字母或下划线开头`)
          return
        }
      }

      // 前端校验：同一合集中不允许重复的指标键
      const keyMap = new Map<string, number>()
      for (let i = 0; i < editableMetrics.length; i++) {
        const key = editableMetrics[i].metric_key.trim()
        if (!key) continue
        if (keyMap.has(key)) {
          message.error(`第 ${i + 1} 个指标的「指标键」"${key}" 与第 ${keyMap.get(key)! + 1} 个重复，同一合集中不允许相同的指标键`)
          return
        }
        keyMap.set(key, i)
      }

      // 前端校验：同一合集中指标名重复仅警告，不阻止
      const labelMap = new Map<string, number>()
      for (let i = 0; i < editableMetrics.length; i++) {
        const label = editableMetrics[i].metric_label.trim()
        if (!label) continue
        if (labelMap.has(label)) {
          message.warning(`第 ${i + 1} 个指标的「指标名」"${label}" 与第 ${labelMap.get(label)! + 1} 个重复`)
        } else {
          labelMap.set(label, i)
        }
      }

      await templateService.adminUpdateTemplate(editingTemplate.id, {
        ...values,
        metrics: editableMetrics.map(m => ({
          ...m,
          metric_key: m.metric_key.trim(),
          metric_label: m.metric_label.trim()
        })),
      })
      message.success('合集模版更新成功')
      setShowEditTemplate(false)
      setEditingTemplate(null)
      setEditableMetrics([])
      editTemplateForm.resetFields()
      loadTemplates(templatesPagination.current, templatesPagination.pageSize, tplCategoryFilter, tplStatusFilter)
      // 刷新指标模版列表，反映级联同步结果
      loadMetrics(metricsPagination.current, metricsPagination.pageSize)
    } catch (error: any) {
      if (error.response) {
        message.error((error.response.data?.detail || error.response.data?.message) || '更新失败')
      } else if (error.message) {
        message.error(error.message)
      } else {
        message.error('更新合集模版失败，请检查网络连接或重新登录')
      }
    }
  }

  const handleDeleteTemplate = (template: TemplateResponse) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除合集模版「${template.name}」吗？此操作不可撤销。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await templateService.adminDeleteTemplate(template.id)
          message.success(`合集模版「${template.name}」已删除`)
          loadTemplates(templatesPagination.current, templatesPagination.pageSize, tplCategoryFilter, tplStatusFilter)
        } catch (error: any) {
          if (error.response) {
            message.error((error.response.data?.detail || error.response.data?.message) || '删除失败')
          } else if (error.message) {
            message.error(error.message)
          } else {
            message.error('删除失败，请检查网络连接或重新登录')
          }
        }
      },
    })
  }

  const openCreateTemplateModal = () => {
    createTemplateForm.resetFields()
    setEditableMetrics([
      { metric_key: '', metric_label: '', expected_type: 'NUMERIC', prompt_instruction: '', disabled: false },
    ])
    setShowCreateTemplate(true)
  }

  const openEditTemplateModal = (template: TemplateResponse) => {
    setEditingTemplate(template)
    editTemplateForm.setFieldsValue({
      name: template.name,
      description: template.description || '',
      category: template.category || '',
      is_active: template.is_active,
    })
    const initialMetrics = template.metrics.map(m => ({ ...m, disabled: m.disabled || false }))
    setEditableMetrics(initialMetrics)
    setEditInitialMetricCount(initialMetrics.length)  // 记录已有指标数量，用于区分新/旧行
    setShowEditTemplate(true)
  }

  const addMetricRow = () => {
    setEditableMetrics(prev => [
      ...prev,
      { metric_key: '', metric_label: '', expected_type: 'NUMERIC', prompt_instruction: '', disabled: false },
    ])
  }

  const removeMetricRow = (index: number) => {
    setEditableMetrics(prev => prev.filter((_, i) => i !== index))
  }

  const updateMetricRow = (index: number, field: keyof MetricItem, value: any) => {
    setEditableMetrics(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }

  // ==================== 表格列定义 ====================

  const userColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '邮箱', dataIndex: 'email', key: 'email', width: 200, ellipsis: true },
    { title: '昵称', dataIndex: 'nickname', key: 'nickname', ellipsis: true,
      render: (text: string) => text || <span className="text-tertiary">-</span> },
    {
      title: '状态', dataIndex: 'is_active', key: 'is_active', width: 80,
      render: (active: boolean) => (
        <Tag color={active ? 'success' : 'error'}>{active ? '活跃' : '禁用'}</Tag>
      ),
    },
    {
      title: '角色', dataIndex: 'is_admin', key: 'is_admin', width: 100,
      render: (admin: boolean) => (
        <Tag color={admin ? 'processing' : 'default'}>{admin ? '管理员' : '普通用户'}</Tag>
      ),
    },
    { title: '批次数', dataIndex: 'batch_count', key: 'batch_count', width: 80,
      render: (val: number) => <span style={{ fontWeight: 500 }}>{val}</span> },
    {
      title: '注册时间', dataIndex: 'created_at', key: 'created_at',
      render: (text: string) => new Date(text).toLocaleString('zh-CN'),
    },
    {
      title: '操作', key: 'action', width: 200,
      render: (_: any, record: UserItem) => (
        <Space size="small">
          <Button type="link" icon={<HistoryOutlined />}
            onClick={() => handleViewUserBatches(record.id)}>
            查看批次
          </Button>
          {!record.is_admin && (
            <Button type="link"
              onClick={() => handleToggleStatus(record.id)}>
              {record.is_active ? '禁用' : '启用'}
            </Button>
          )}
        </Space>
      ),
    },
  ]

  const batchColumns = [
    { title: '批次ID', dataIndex: 'batch_id', key: 'batch_id', width: 80 },
    { title: '批次名称', dataIndex: 'batch_name', key: 'batch_name', ellipsis: true,
      render: (text: string) => text || '未命名' },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (status: string) => {
        const cm: Record<string, string> = { pending: 'default', processing: 'processing', completed: 'success', failed: 'error' }
        const lm: Record<string, string> = { pending: '等待中', processing: '处理中', completed: '已完成', failed: '失败' }
        return <Tag color={cm[status] || 'default'}>{lm[status] || status}</Tag>
      },
    },
    { title: '文件数', dataIndex: 'total_files', key: 'total_files', width: 80 },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at',
      render: (text: string) => new Date(text).toLocaleString('zh-CN') },
    {
      title: '操作', key: 'action', width: 100,
      render: (_: any, record: BatchItem) => (
        <Button type="link" icon={<FileTextOutlined />}
          onClick={() => handleViewBatchReports(record.batch_id)}>查看报告</Button>
      ),
    },
  ]

  const reportColumns = [
    { title: '报告ID', dataIndex: 'report_id', key: 'report_id', width: 80 },
    { title: '文件名', dataIndex: 'filename', key: 'filename', ellipsis: true },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (status: string) => {
        const cm: Record<string, string> = { pending: 'default', parsing: 'processing', extracting: 'processing', success: 'success', failed: 'error' }
        return <Tag color={cm[status] || 'default'}>{status}</Tag>
      },
    },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at',
      render: (text: string) => new Date(text).toLocaleString('zh-CN') },
    {
      title: '操作', key: 'action', width: 100,
      render: (_: any, record: ReportItem) => (
        <Button type="link" icon={<EyeOutlined />}
          onClick={() => handleViewReportDetail(record.report_id)}>查看详情</Button>
      ),
    },
  ]

  const metricColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    {
      title: '指标键', dataIndex: 'metric_key', key: 'metric_key', width: 160, ellipsis: true,
      render: (text: string) => <code style={{ fontSize: 12 }}>{text}</code>,
    },
    { title: '指标名称', dataIndex: 'metric_label', key: 'metric_label', width: 140, ellipsis: true },
    {
      title: '类型', dataIndex: 'expected_type', key: 'expected_type', width: 80,
      render: (type: string) => (
        <Tag color={type === 'NUMERIC' ? 'blue' : 'green'}>{type}</Tag>
      ),
    },
    {
      title: '启用状态', dataIndex: 'is_active', key: 'is_active', width: 100,
      render: (active: boolean, record: MetricDefinition) => (
        <Switch
          checked={active}
          onChange={() => handleToggleMetricActive(record.id)}
          checkedChildren="启用"
          unCheckedChildren="禁用"
        />
      ),
    },
    {
      title: '提取提示词', dataIndex: 'prompt_instruction', key: 'prompt_instruction', width: 200, ellipsis: true,
      render: (text: string) => text || <span className="text-tertiary">-</span>,
    },
    {
      title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 170,
      render: (text: string) => text ? new Date(text).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作', key: 'action', width: 160,
      render: (_: any, record: MetricDefinition) => (
        <Space size="small">
          <Button type="link" icon={<EditOutlined />}
            onClick={() => openEditModal(record)}>编辑</Button>
          <Button type="link" danger icon={<DeleteOutlined />}
            onClick={() => handleDeleteMetric(record)}>删除</Button>
        </Space>
      ),
    },
  ]

  // ==================== 合集模版表格列 ====================

  const templateColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '名称', dataIndex: 'name', key: 'name', width: 160, ellipsis: true },
    {
      title: '描述', dataIndex: 'description', key: 'description', width: 200, ellipsis: true,
      render: (text: string) => text || <span className="text-tertiary">-</span>,
    },
    {
      title: '分类', dataIndex: 'category', key: 'category', width: 100,
      render: (cat: string) => cat ? <Tag color="purple">{cat}</Tag> : <span className="text-tertiary">-</span>,
    },
    {
      title: '类型', dataIndex: 'is_system', key: 'is_system', width: 80,
      render: (sys: boolean) => (
        <Tag color={sys ? 'blue' : 'green'}>{sys ? '系统' : '用户'}</Tag>
      ),
    },
    { title: '指标数', dataIndex: 'metric_count', key: 'metric_count', width: 70,
      render: (val: number) => <span style={{ fontWeight: 500 }}>{val}</span> },
    {
      title: '启用状态', dataIndex: 'is_active', key: 'is_active', width: 100,
      render: (active: boolean, record: TemplateResponse) => (
        <Switch
          checked={active}
          onChange={() => handleToggleTemplateActive(record.id)}
          checkedChildren="启用"
          unCheckedChildren="禁用"
        />
      ),
    },
    {
      title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 170,
      render: (text: string) => text ? new Date(text).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作', key: 'action', width: 160,
      render: (_: any, record: TemplateResponse) => (
        <Space size="small">
          <Button type="link" icon={<EditOutlined />}
            onClick={() => openEditTemplateModal(record)}>编辑</Button>
          <Button type="link" danger icon={<DeleteOutlined />}
            onClick={() => handleDeleteTemplate(record)}>删除</Button>
        </Space>
      ),
    },
  ]

  // ==================== 用户管理 Tab 内容 ====================

  const userManagementTab = (
    <>
      {/* 搜索卡片 */}
      <Card className="admin-search-card">
        <div className="admin-filters">
          <div className="admin-search-group">
            <Input
              placeholder="搜索邮箱或昵称"
              prefix={<SearchOutlined />}
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              onPressEnter={handleSearch}
              className="admin-search-input"
              allowClear
            />
            <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} className="admin-search-btn">
              搜索
            </Button>
          </div>
          <Select
            placeholder="状态筛选"
            value={statusFilter}
            onChange={(value) => { setStatusFilter(value); loadUsers(1, pagination.pageSize, value) }}
            style={{ width: 120 }}
            allowClear
            options={[
              { label: '全部', value: null },
              { label: '活跃', value: true },
              { label: '禁用', value: false },
            ]}
          />
          <Space.Compact>
            <Button
              type={sortOrder === 'desc' ? 'primary' : 'default'}
              onClick={() => { setSortOrder('desc'); loadUsers(1, pagination.pageSize, undefined, 'desc') }}
            >最新优先</Button>
            <Button
              type={sortOrder === 'asc' ? 'primary' : 'default'}
              onClick={() => { setSortOrder('asc'); loadUsers(1, pagination.pageSize, undefined, 'asc') }}
            >最早优先</Button>
          </Space.Compact>
        </div>
      </Card>

      {/* 用户表格 */}
      <Card className="admin-table-card">
        <Table
          columns={userColumns}
          dataSource={users}
          rowKey="id"
          loading={loading}
          pagination={{
            ...pagination,
            onChange: (page, pageSize) => loadUsers(page, pageSize),
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 位用户`,
          }}
        />
      </Card>
    </>
  )

  // ==================== 指标模版管理 Tab 内容 ====================

  const metricManagementTab = (
    <>
      {/* 操作栏 */}
      <Card className="admin-search-card">
        <div className="admin-filters">
          <Button type="primary" icon={<PlusOutlined />}
            onClick={() => { createForm.resetFields(); setShowCreateMetric(true) }}>
            新增系统指标
          </Button>
          <span className="text-secondary" style={{ marginLeft: 12 }}>
            共 {metricsPagination.total} 个系统指标模版
          </span>
        </div>
      </Card>

      {/* 指标表格 */}
      <Card className="admin-table-card">
        <Table
          columns={metricColumns}
          dataSource={metrics}
          rowKey="id"
          loading={metricsLoading}
          rowClassName={(record) => record.is_active ? '' : 'metric-row-inactive'}
          pagination={{
            ...metricsPagination,
            onChange: (page, pageSize) => loadMetrics(page, pageSize),
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 个指标模版`,
          }}
        />
      </Card>
    </>
  )

  // ==================== 合集模版管理 Tab 内容 ====================

  const templateManagementTab = (
    <>
      {/* 操作栏 */}
      <Card className="admin-search-card">
        <div className="admin-filters">
          <Button type="primary" icon={<PlusOutlined />}
            onClick={openCreateTemplateModal}>
            新增合集模版
          </Button>
          <Button
            onClick={() => handleBulkToggleAll(true)}
            icon={<CheckCircleOutlined />}>
            全部启用
          </Button>
          <Button
            danger
            onClick={() => handleBulkToggleAll(false)}
            icon={<StopOutlined />}>
            全部禁用
          </Button>
          <Select
            placeholder="分类筛选"
            value={tplCategoryFilter}
            onChange={(value) => { setTplCategoryFilter(value); loadTemplates(1, 20, value, tplStatusFilter) }}
            style={{ width: 120 }}
            allowClear
            options={[
              { label: '全部分类', value: null },
              ...['港股', 'A股', '通用'].map(c => ({ label: c, value: c })),
            ]}
          />
          <Select
            placeholder="状态筛选"
            value={tplStatusFilter}
            onChange={(value) => { setTplStatusFilter(value); loadTemplates(1, 20, tplCategoryFilter, value) }}
            style={{ width: 120 }}
            allowClear
            options={[
              { label: '全部状态', value: null },
              { label: '启用', value: true },
              { label: '禁用', value: false },
            ]}
          />
          <span className="text-secondary" style={{ marginLeft: 12 }}>
            共 {templatesPagination.total} 个合集模版
          </span>
        </div>
      </Card>

      {/* 模版表格 */}
      <Card className="admin-table-card">
        <Table
          columns={templateColumns}
          dataSource={templates}
          rowKey="id"
          loading={templatesLoading}
          rowClassName={(record) => record.is_active ? '' : 'metric-row-inactive'}
          pagination={{
            ...templatesPagination,
            onChange: (page, pageSize) => loadTemplates(page, pageSize, tplCategoryFilter, tplStatusFilter),
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 个合集模版`,
          }}
        />
      </Card>
    </>
  )

  // ==================== 主渲染 ====================

  return (
    <div className="admin-panel">
      {/* 页头 */}
      <div className="page-header">
        <div>
          <h1 className="page-header-title">
            <UserOutlined style={{ marginRight: 8 }} />管理面板
          </h1>
          <p className="page-header-subtitle">用户管理、批次审计、报告审核与系统指标模版配置</p>
        </div>
      </div>

      <Tabs
        defaultActiveKey="users"
        onChange={(key) => {
          if (key === 'metrics' && metrics.length === 0) {
            loadMetrics()
          }
          if (key === 'templates' && templates.length === 0) {
            loadTemplates()
          }
        }}
        items={[
          {
            key: 'users',
            label: '用户管理',
            children: userManagementTab,
          },
          {
            key: 'metrics',
            label: '指标模版管理',
            children: metricManagementTab,
          },
          {
            key: 'templates',
            label: '合集模版管理',
            children: templateManagementTab,
          },
        ]}
      />

      {/* ════ 用户批次 Modal ════ */}
      <Modal
        modalRender={modalRender}
        title={`用户 #${selectedUser} 的批次列表`}
        open={userBatchesModal}
        onCancel={() => setUserBatchesModal(false)}
        width={900}
        footer={[<Button key="close" onClick={() => setUserBatchesModal(false)}>关闭</Button>]}
      >
        <Table columns={batchColumns} dataSource={userBatches} rowKey="batch_id" pagination={false} />
      </Modal>

      {/* ════ 报告列表 Modal ════ */}
      <Modal
        modalRender={modalRender}
        title={`批次 #${selectedBatch} 的报告列表`}
        open={reportsModal}
        onCancel={() => setReportsModal(false)}
        width={900}
        footer={[
          <Button key="back" onClick={() => { setReportsModal(false); setUserBatchesModal(true) }}>返回</Button>,
          <Button key="close" onClick={() => setReportsModal(false)}>关闭</Button>,
        ]}
      >
        <Table columns={reportColumns} dataSource={batchReports} rowKey="report_id" pagination={false} />
      </Modal>

      {/* ════ 报告详情 Modal ════ */}
      <Modal
        modalRender={modalRender}
        title={`报告 #${reportDetail?.report_id} — ${reportDetail?.filename}`}
        open={reportDetailModal}
        onCancel={() => setReportDetailModal(false)}
        width={900}
        footer={[
          <Button key="back" onClick={() => { setReportDetailModal(false); setReportsModal(true) }}>返回</Button>,
          <Button key="close" onClick={() => setReportDetailModal(false)}>关闭</Button>,
        ]}
      >
        {reportDetail && (
          <div>
            <p><strong>批次ID：</strong>{reportDetail.batch_id}</p>
            <p><strong>状态：</strong>
              <Tag color={reportDetail.status === 'success' ? 'success' : reportDetail.status === 'failed' ? 'error' : 'processing'}>
                {reportDetail.status}
              </Tag>
            </p>
            {reportDetail.error_message && <p><strong>错误信息：</strong>{reportDetail.error_message}</p>}
            <Collapse defaultActiveKey={['1']} style={{ marginTop: 16 }}>
              <Collapse.Panel header="原始 Markdown" key="1">
                <pre className="audit-code-block">
                  {reportDetail.raw_markdown || '暂无数据'}
                </pre>
              </Collapse.Panel>
              <Collapse.Panel header="提取的原始 JSON" key="2">
                <pre className="audit-code-block">
                  {reportDetail.metrics?.raw_json || '暂无数据'}
                </pre>
              </Collapse.Panel>
            </Collapse>
          </div>
        )}
      </Modal>

      {/* ════ 创建系统指标 Modal ════ */}
      <Modal
        modalRender={modalRender}
        title="新增系统指标模版"
        open={showCreateMetric}
        onCancel={() => setShowCreateMetric(false)}
        onOk={handleCreateMetric}
        okText="创建"
        cancelText="取消"
        width={560}
      >
        <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="metric_key"
            label="指标键 (metric_key)"
            rules={[
              { required: true, message: '请输入指标键' },
              { max: 100, message: '最多 100 个字符' },
              { pattern: /^[a-z_][a-z0-9_]*$/, message: '仅支持小写字母、数字和下划线，必须以字母或下划线开头' },
            ]}
          >
            <Input placeholder="例如：net_profit" />
          </Form.Item>
          <Form.Item
            name="metric_label"
            label="指标名称 (metric_label)"
            rules={[{ required: true, message: '请输入指标名称' }, { max: 100, message: '最多 100 个字符' }]}
          >
            <Input placeholder="例如：净利润" />
          </Form.Item>
          <Form.Item
            name="expected_type"
            label="期望类型"
            initialValue="NUMERIC"
            rules={[{ required: true, message: '请选择期望类型' }]}
          >
            <Select
              options={[
                { label: 'NUMERIC — 数值型', value: 'NUMERIC' },
                { label: 'TEXT — 文本型', value: 'TEXT' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="prompt_instruction"
            label="AI 提取提示词"
            rules={[{ max: 500, message: '最多 500 个字符' }]}
          >
            <Input.TextArea rows={3} placeholder="指导 AI 如何提取该指标的提示词（可选）" />
          </Form.Item>
          <Form.Item
            name="is_active"
            label="默认启用"
            valuePropName="checked"
            initialValue={true}
          >
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ════ 编辑系统指标 Modal ════ */}
      <Modal
        modalRender={modalRender}
        title={`编辑系统指标模版 — ${editingMetric?.metric_label || ''}`}
        open={showEditMetric}
        onCancel={() => { setShowEditMetric(false); setEditingMetric(null) }}
        onOk={handleEditMetric}
        okText="保存"
        cancelText="取消"
        width={560}
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="指标键 (metric_key)">
            <Input value={editingMetric?.metric_key || ''} disabled />
          </Form.Item>
          <Form.Item
            name="metric_label"
            label="指标名称 (metric_label)"
            rules={[{ required: true, message: '请输入指标名称' }, { max: 100, message: '最多 100 个字符' }]}
          >
            <Input placeholder="例如：净利润" />
          </Form.Item>
          <Form.Item
            name="expected_type"
            label="期望类型"
            rules={[{ required: true, message: '请选择期望类型' }]}
          >
            <Select
              options={[
                { label: 'NUMERIC — 数值型', value: 'NUMERIC' },
                { label: 'TEXT — 文本型', value: 'TEXT' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="prompt_instruction"
            label="AI 提取提示词"
            rules={[{ max: 500, message: '最多 500 个字符' }]}
          >
            <Input.TextArea rows={3} placeholder="指导 AI 如何提取该指标的提示词（可选）" />
          </Form.Item>
          <Form.Item
            name="is_active"
            label="启用状态"
            valuePropName="checked"
          >
            <Switch
              checkedChildren="启用"
              unCheckedChildren="禁用"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* ════ 创建合集模版 Modal ════ */}
      <Modal
        modalRender={modalRender}
        title="新增合集模版"
        open={showCreateTemplate}
        onCancel={() => { setShowCreateTemplate(false); setEditableMetrics([]) }}
        onOk={handleCreateTemplate}
        okText="创建"
        cancelText="取消"
        width={800}
      >
        <Form form={createTemplateForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="模版名称" rules={[{ required: true, message: '请输入模版名称' }, { max: 100 }]}>
            <Input placeholder="例如：港股回购报告" />
          </Form.Item>
          <Form.Item name="description" label="描述" rules={[{ max: 500 }]}>
            <Input.TextArea rows={2} placeholder="模版描述（可选）" />
          </Form.Item>
          <Form.Item name="category" label="分类" rules={[{ max: 50 }]}>
            <Input placeholder="例如：港股 / A股 / 通用" />
          </Form.Item>
          <Space>
            <Form.Item name="is_system" label="系统模版" valuePropName="checked" initialValue={true}>
              <Switch checkedChildren="是" unCheckedChildren="否" />
            </Form.Item>
            <Form.Item name="is_active" label="默认启用" valuePropName="checked" initialValue={true}>
              <Switch checkedChildren="启用" unCheckedChildren="禁用" />
            </Form.Item>
          </Space>

          {/* 内嵌指标编辑表格 */}
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong>指标列表</strong>
              <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addMetricRow}>
                添加指标
              </Button>
            </div>
            <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#fafafa' }}>
                    <th style={{ padding: '8px 6px', fontSize: 12, textAlign: 'left' }}>指标键</th>
                    <th style={{ padding: '8px 6px', fontSize: 12, textAlign: 'left' }}>指标名</th>
                    <th style={{ padding: '8px 6px', fontSize: 12, textAlign: 'left' }}>类型</th>
                    <th style={{ padding: '8px 6px', fontSize: 12, textAlign: 'left' }}>提示词</th>
                    <th style={{ padding: '8px 6px', fontSize: 12, textAlign: 'center', width: 60 }}>启用</th>
                    <th style={{ padding: '8px 6px', fontSize: 12, textAlign: 'center', width: 50 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {editableMetrics.map((m, idx) => (
                    <tr key={idx}>
                      <td style={{ padding: '4px 6px' }}>
                        <Input size="small" value={m.metric_key} maxLength={100}
                          onChange={(e) => updateMetricRow(idx, 'metric_key', e.target.value)}
                          placeholder="如 net_profit" />
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        <Input size="small" value={m.metric_label} maxLength={100}
                          onChange={(e) => updateMetricRow(idx, 'metric_label', e.target.value)}
                          placeholder="如 净利润" />
                      </td>
                      <td style={{ padding: '4px 6px', width: 100 }}>
                        <Select size="small" value={m.expected_type}
                          onChange={(value) => updateMetricRow(idx, 'expected_type', value)}
                          options={[
                            { label: 'NUMERIC', value: 'NUMERIC' },
                            { label: 'TEXT', value: 'TEXT' },
                          ]}
                          style={{ width: '100%' }} />
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        <Input size="small" value={m.prompt_instruction || ''} maxLength={500}
                          onChange={(e) => updateMetricRow(idx, 'prompt_instruction', e.target.value)}
                          placeholder="AI提取提示（可选）" />
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                        <Switch size="small" checked={!m.disabled}
                          onChange={(checked) => updateMetricRow(idx, 'disabled', !checked)} />
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                        <Button type="text" danger size="small" icon={<DeleteOutlined />}
                          onClick={() => removeMetricRow(idx)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Form>
      </Modal>

      {/* ════ 编辑合集模版 Modal ════ */}
      <Modal
        modalRender={modalRender}
        title={`编辑合集模版 — ${editingTemplate?.name || ''}`}
        open={showEditTemplate}
        onCancel={() => { setShowEditTemplate(false); setEditingTemplate(null); setEditableMetrics([]) }}
        onOk={handleEditTemplate}
        okText="保存"
        cancelText="取消"
        width={800}
      >
        <Form form={editTemplateForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="模版名称" rules={[{ required: true, message: '请输入模版名称' }, { max: 100 }]}>
            <Input placeholder="例如：港股回购报告" />
          </Form.Item>
          <Form.Item name="description" label="描述" rules={[{ max: 500 }]}>
            <Input.TextArea rows={2} placeholder="模版描述（可选）" />
          </Form.Item>
          <Form.Item name="category" label="分类" rules={[{ max: 50 }]}>
            <Input placeholder="例如：港股 / A股 / 通用" />
          </Form.Item>
          <Form.Item name="is_active" label="启用状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>

          {/* 内嵌指标编辑表格 */}
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong>指标列表</strong>
              <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addMetricRow}>
                添加指标
              </Button>
            </div>
            <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#fafafa' }}>
                    <th style={{ padding: '8px 6px', fontSize: 12, textAlign: 'left' }}>指标键</th>
                    <th style={{ padding: '8px 6px', fontSize: 12, textAlign: 'left' }}>指标名</th>
                    <th style={{ padding: '8px 6px', fontSize: 12, textAlign: 'left' }}>类型</th>
                    <th style={{ padding: '8px 6px', fontSize: 12, textAlign: 'left' }}>提示词</th>
                    <th style={{ padding: '8px 6px', fontSize: 12, textAlign: 'center', width: 60 }}>启用</th>
                    <th style={{ padding: '8px 6px', fontSize: 12, textAlign: 'center', width: 50 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {editableMetrics.map((m, idx) => (
                    <tr key={idx}>
                      <td style={{ padding: '4px 6px' }}>
                        <Input
                          size="small"
                          value={m.metric_key}
                          disabled={idx < editInitialMetricCount}
                          onChange={(e) => updateMetricRow(idx, 'metric_key', e.target.value)}
                          placeholder="如 net_profit"
                          style={idx < editInitialMetricCount ? { color: '#999' } : undefined}
                        />
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        <Input size="small" value={m.metric_label}
                          onChange={(e) => updateMetricRow(idx, 'metric_label', e.target.value)}
                          placeholder="如 净利润" />
                      </td>
                      <td style={{ padding: '4px 6px', width: 100 }}>
                        <Select size="small" value={m.expected_type}
                          onChange={(value) => updateMetricRow(idx, 'expected_type', value)}
                          options={[
                            { label: 'NUMERIC', value: 'NUMERIC' },
                            { label: 'TEXT', value: 'TEXT' },
                          ]}
                          style={{ width: '100%' }} />
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        <Input size="small" value={m.prompt_instruction || ''}
                          onChange={(e) => updateMetricRow(idx, 'prompt_instruction', e.target.value)}
                          placeholder="AI提取提示（可选）" />
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                        <Switch size="small" checked={!m.disabled}
                          onChange={(checked) => updateMetricRow(idx, 'disabled', !checked)} />
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                        <Button type="text" danger size="small" icon={<DeleteOutlined />}
                          onClick={() => removeMetricRow(idx)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Form>
      </Modal>
    </div>
  )
}

export default AdminPanel
