import { useState, useEffect, useCallback } from 'react'
import { Button, Table, Tag, Space, Input, Switch, Popconfirm, App, Typography, Tooltip } from 'antd'
import {
  PlusOutlined, DeleteOutlined, EditOutlined, RobotOutlined,
  SearchOutlined, ReloadOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  metricService,
  MetricDefinition,
} from '../services/metricService'
import { extractErrorMessage } from '../utils/errorHandler'
import AddMetricModal from '../components/AddMetricModal'
import AIMetricRecommender from '../components/AIMetricRecommender'
import TemplateSelector from '../components/TemplateSelector'
import './Metrics.css'

const { Text } = Typography

function Metrics() {
  const { message } = App.useApp()
  const [metrics, setMetrics] = useState<MetricDefinition[]>([])
  const [loading, setLoading] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [showSystem, setShowSystem] = useState(true)
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'NUMERIC' | 'TEXT'>('ALL')
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  // 弹窗状态
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [editingMetric, setEditingMetric] = useState<MetricDefinition | null>(null)
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const loadMetrics = useCallback(async () => {
    setLoading(true)
    try {
      const data = await metricService.getMetricDefinitions()
      setMetrics(data.data || [])
    } catch (err) {
      message.error(extractErrorMessage(err, '加载指标列表失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMetrics()
  }, [loadMetrics])

  // 筛选后的指标列表
  const filteredMetrics = metrics.filter((m) => {
    if (!showSystem && m.is_system) return false
    if (typeFilter !== 'ALL' && m.expected_type !== typeFilter) return false
    if (searchText) {
      const q = searchText.toLowerCase()
      return (
        m.metric_label.toLowerCase().includes(q) ||
        m.metric_key.toLowerCase().includes(q)
      )
    }
    return true
  })

  // 删除单个指标
  const handleDelete = async (id: number) => {
    try {
      await metricService.deleteMetric(id)
      message.success('指标已删除')
      loadMetrics()
    } catch (err) {
      message.error(extractErrorMessage(err, '删除失败'))
    }
  }

  // 批量删除
  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return
    setDeleting(true)
    try {
      await metricService.deleteMetrics(selectedRowKeys as number[])
      message.success(`已删除 ${selectedRowKeys.length} 个指标`)
      setSelectedRowKeys([])
      loadMetrics()
    } catch (err) {
      message.error(extractErrorMessage(err, '批量删除失败'))
    } finally {
      setDeleting(false)
    }
  }

  // 编辑
  const handleEdit = (metric: MetricDefinition) => {
    setEditingMetric(metric)
    setAddModalOpen(true)
  }

  // 统计
  const totalCount = metrics.length
  const numericCount = metrics.filter((m) => m.expected_type === 'NUMERIC').length
  const textCount = metrics.filter((m) => m.expected_type === 'TEXT').length
  const customCount = metrics.filter((m) => !m.is_system).length

  const columns: ColumnsType<MetricDefinition> = [
    {
      title: '指标名称',
      dataIndex: 'metric_label',
      key: 'label',
      width: 200,
      render: (label: string, record) => (
        <Space>
          <span>{label}</span>
          {record.is_system && (
            <Tag color="blue" style={{ fontSize: 11 }}>系统</Tag>
          )}
        </Space>
      ),
    },
    {
      title: '键名',
      dataIndex: 'metric_key',
      key: 'key',
      width: 180,
      render: (key: string) => (
        <Text code style={{ fontSize: 12 }}>{key}</Text>
      ),
    },
    {
      title: '类型',
      dataIndex: 'expected_type',
      key: 'type',
      width: 100,
      render: (type: string) => (
        <Tag color={type === 'NUMERIC' ? 'green' : 'orange'}>
          {type === 'NUMERIC' ? '数值型' : '文本型'}
        </Tag>
      ),
    },
    {
      title: '提示词',
      dataIndex: 'prompt_instruction',
      key: 'prompt',
      ellipsis: true,
      render: (text: string) => (
        <Tooltip title={text || '无'}>
          <span style={{ color: text ? '#333' : '#ccc' }}>
            {text ? (text.length > 50 ? text.slice(0, 50) + '...' : text) : '未设置'}
          </span>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: unknown, record) => (
        <Space size="small">
          <Tooltip title="编辑">
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
              disabled={record.is_system}
            />
          </Tooltip>
          <Popconfirm
            title="确认删除此指标？"
            description="删除后不影响已生成的历史数据"
            onConfirm={() => handleDelete(record.id)}
            okText="确认删除"
            cancelText="取消"
          >
            <Tooltip title={record.is_system ? '系统指标不可删除' : '删除'}>
              <Button
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={record.is_system}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="metrics-page">
      {/* 页头 */}
      <div className="page-header">
        <div>
          <h1 className="page-title">指标库</h1>
          <p className="page-subtitle">管理所有自定义指标定义、AI 推荐指标与模板导入</p>
        </div>
        <Space>
          {/* TemplateSelector 自带 Button，直接渲染即可 */}
          <TemplateSelector onImportComplete={loadMetrics} />
          <Button icon={<RobotOutlined />} onClick={() => setAiModalOpen(true)}>
            AI 推荐
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => {
            setEditingMetric(null)
            setAddModalOpen(true)
          }}>
            新增指标
          </Button>
        </Space>
      </div>

      {/* 统计行 */}
      <div className="stat-cards-row">
        <div className="stat-card">
          <div className="stat-card-label">总指标数</div>
          <div className="stat-card-value">{totalCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">数值型</div>
          <div className="stat-card-value">{numericCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">文本型</div>
          <div className="stat-card-value">{textCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">自定义指标</div>
          <div className="stat-card-value">{customCount}</div>
        </div>
      </div>

      {/* 筛选与操作栏 */}
      <div className="section-card">
        <div className="metrics-toolbar">
          <Space wrap>
            <Input
              placeholder="搜索指标名称或键名..."
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ width: 260 }}
              allowClear
            />
            <Button
              type={typeFilter === 'ALL' ? 'primary' : 'default'}
              size="small"
              onClick={() => setTypeFilter('ALL')}
            >
              全部
            </Button>
            <Button
              type={typeFilter === 'NUMERIC' ? 'primary' : 'default'}
              size="small"
              onClick={() => setTypeFilter('NUMERIC')}
            >
              数值型
            </Button>
            <Button
              type={typeFilter === 'TEXT' ? 'primary' : 'default'}
              size="small"
              onClick={() => setTypeFilter('TEXT')}
            >
              文本型
            </Button>
            <span style={{ marginLeft: 16 }}>
              <Switch
                checked={showSystem}
                onChange={setShowSystem}
                size="small"
              />{' '}
              <span style={{ fontSize: 13, color: '#666' }}>显示系统预设</span>
            </span>
          </Space>
          <Space>
            {selectedRowKeys.length > 0 && (
              <Popconfirm
                title={`确认删除选中的 ${selectedRowKeys.length} 个指标？`}
                onConfirm={handleBatchDelete}
                okText="确认删除"
                cancelText="取消"
              >
                <Button danger icon={<DeleteOutlined />} loading={deleting}>
                  批量删除 ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
            )}
            <Button icon={<ReloadOutlined />} onClick={loadMetrics} loading={loading}>
              刷新
            </Button>
          </Space>
        </div>

        {/* 指标表格 */}
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filteredMetrics}
          loading={loading}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys),
            getCheckboxProps: (record) => ({
              disabled: record.is_system,
            }),
          }}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total, range) => `${range[0]}-${range[1]} / 共 ${total} 条`,
          }}
          size="middle"
          locale={{ emptyText: '暂无指标定义，点击"新增指标"创建第一个' }}
        />
      </div>

      {/* 新增/编辑指标弹窗 */}
      <AddMetricModal
        open={addModalOpen}
        onClose={() => {
          setAddModalOpen(false)
          setEditingMetric(null)
        }}
        onCreated={() => {
          setAddModalOpen(false)
          setEditingMetric(null)
          loadMetrics()
        }}
        mode={editingMetric ? 'edit' : 'create'}
        editTarget={editingMetric}
      />

      {/* AI 推荐指标弹窗 */}
      <AIMetricRecommender
        open={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        onCreated={() => {
          setAiModalOpen(false)
          loadMetrics()
        }}
      />
    </div>
  )
}

export default Metrics
