import { useState } from 'react'
import { Table, Button, Tag, Space, Tooltip, Input, Popconfirm } from 'antd'
import {
  EyeOutlined,
  BarChartOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  DeleteOutlined,
  EditOutlined,
} from '@ant-design/icons'
import { BatchResponse } from '../services/batchService'
import './BatchTable.css'

interface BatchTableProps {
  batches: BatchResponse[]
  loading: boolean
  pagination: { current: number; pageSize: number; total: number }
  onPageChange: (page: number, pageSize: number) => void
  onRefresh: () => void
  onViewComparison: (batchId: number) => void
  onTrendAnalysis: () => void
  onOpenChart: (batchId: number) => void
  onDeleteBatch: (batchId: number) => void
  onRenameBatch: (batchId: number, name: string) => void
  onDeleteAllBatches: () => void
  /** 当前选中的批次 ID，用于高亮行 */
  selectedBatchId?: number | null
  /** 点击行时回调，用于设置选中批次 */
  onSelectBatch?: (batchId: number) => void
}

function renderStatus(status: string) {
  const config: Record<string, { color: string; text: string; icon: any }> = {
    pending: { color: 'processing', text: '等待中', icon: ClockCircleOutlined },
    processing: { color: 'processing', text: '处理中', icon: ReloadOutlined },
    completed: { color: 'success', text: '已完成', icon: CheckCircleOutlined },
    failed: { color: 'error', text: '失败', icon: CloseCircleOutlined },
    partial: { color: 'warning', text: '部分完成', icon: ExclamationCircleOutlined },
  }

  const c = config[status] || config.pending
  const Icon = c.icon
  return (
    <Tag color={c.color} className={`status-tag status-${status}`}>
      <Icon /> {c.text}
    </Tag>
  )
}

function BatchTable({
  batches, loading, pagination,
  onPageChange, onRefresh, onViewComparison, onTrendAnalysis, onOpenChart,
  onDeleteBatch, onRenameBatch, onDeleteAllBatches,
  selectedBatchId, onSelectBatch,
}: BatchTableProps) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [expandedMetrics, setExpandedMetrics] = useState<Set<number>>(new Set())

  const startRename = (batchId: number, currentName: string) => {
    setEditingId(batchId)
    setEditingName(currentName || '未命名批次')
  }

  const confirmRename = (batchId: number) => {
    if (editingName.trim()) {
      onRenameBatch(batchId, editingName.trim())
    }
    setEditingId(null)
  }

  const columns = [
    {
      title: '批次名称', dataIndex: 'batch_name', key: 'batch_name',
      render: (text: string, record: BatchResponse) => {
        if (editingId === record.batch_id) {
          return (
            <Input
              size="small"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onPressEnter={() => confirmRename(record.batch_id)}
              onBlur={() => confirmRename(record.batch_id)}
              autoFocus
              style={{ width: 180 }}
            />
          )
        }
        return (
          <span
            className="batch-name-cell"
            onDoubleClick={() => startRename(record.batch_id, text)}
            title="双击编辑名称"
          >
            {text || '未命名批次'}
          </span>
        )
      },
      className: 'table-header',
    },
    { title: '状态', dataIndex: 'status', key: 'status', width: 120, render: renderStatus, className: 'table-header' },
    {
      title: '进度', key: 'progress', width: 120, className: 'table-header',
      render: (_: any, record: BatchResponse) => (
        <span style={{ color: '#666' }}>{record.processed_files}/{record.total_files}</span>
      ),
    },
    {
      title: '指标', key: 'metrics', width: 220, className: 'table-header',
      render: (_: any, record: BatchResponse) => {
        const tags = record.metric_tags || []
        if (tags.length === 0) return <span style={{ color: '#999' }}>—</span>

        const isExpanded = expandedMetrics.has(record.batch_id)
        const visible = isExpanded ? tags : tags.slice(0, 2)
        const hiddenCount = tags.length - 2

        const tooltipContent = (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 260 }}>
            {tags.map((tag) => (
              <Tag key={tag.metric_key} color={tag.expected_type === 'NUMERIC' ? 'purple' : 'blue'} style={{ opacity: 0.75 }}>
                {tag.metric_label}
              </Tag>
            ))}
          </div>
        )

        const toggleExpand = (e: React.MouseEvent) => {
          e.preventDefault()
          e.stopPropagation()
          setExpandedMetrics((prev) => {
            const next = new Set(prev)
            if (next.has(record.batch_id)) {
              next.delete(record.batch_id)
            } else {
              next.add(record.batch_id)
            }
            return next
          })
        }

        return (
          <Tooltip
            title={isExpanded ? null : tooltipContent}
            color="rgba(0, 0, 0, 0.5)"
            styles={{ body: { padding: 8, backdropFilter: 'blur(4px)' } }}
          >
            <Space size={[2, 2]} wrap>
              {visible.map((tag) => (
                <Tag key={tag.metric_key} color={tag.expected_type === 'NUMERIC' ? 'purple' : 'blue'} style={{ margin: 0 }}>
                  {tag.metric_label}
                </Tag>
              ))}
              {hiddenCount > 0 && !isExpanded && (
                <Tag
                  style={{ margin: 0, background: '#f0f0f0', border: '1px dashed #d9d9d9', cursor: 'pointer' }}
                  onClick={toggleExpand}
                >
                  +{hiddenCount}
                </Tag>
              )}
              {isExpanded && tags.length > 2 && (
                <Tag
                  style={{ margin: 0, background: '#f0f0f0', border: '1px dashed #d9d9d9', cursor: 'pointer' }}
                  onClick={toggleExpand}
                >
                  收起
                </Tag>
              )}
            </Space>
          </Tooltip>
        )
      },
    },
    {
      title: '创建时间', dataIndex: 'created_at', key: 'created_at',
      render: (text: string) => new Date(text).toLocaleString('zh-CN'), className: 'table-header',
    },
    {
      title: '操作', key: 'action', width: 260, className: 'table-header',
      render: (_: any, record: BatchResponse) => (
        <Space className="action-buttons" size={4}>
          <Tooltip title="查看矩阵">
            <Button type="text" icon={<EyeOutlined />}
              onClick={() => onViewComparison(record.batch_id)}
              disabled={record.status !== 'completed'} className="action-btn view-btn" />
          </Tooltip>
          <Tooltip title="可视化分析">
            <Button type="text" icon={<BarChartOutlined />}
              onClick={() => onOpenChart(record.batch_id)}
              disabled={record.status !== 'completed'} className="action-btn chart-btn" />
          </Tooltip>
          <Tooltip title="重命名">
            <Button type="text" icon={<EditOutlined />}
              onClick={() => startRename(record.batch_id, record.batch_name || '')}
              className="action-btn edit-btn" />
          </Tooltip>
          <Popconfirm
            title="确定要删除此批次吗？"
            description="所有关联报告和指标数据将被永久删除"
            onConfirm={() => onDeleteBatch(record.batch_id)}
            okText="确定删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Tooltip title="删除">
              <Button type="text" danger icon={<DeleteOutlined />}
                className="action-btn delete-btn" />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="section-card batch-card">
      <div className="card-header">
        <h3 className="card-title"><ClockCircleOutlined /> 处理批次列表</h3>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={onRefresh} className="refresh-btn">刷新</Button>
          <Button icon={<BarChartOutlined />} onClick={onTrendAnalysis} className="chart-header-btn">趋势分析</Button>
          {batches.length > 0 && (
            <Popconfirm
              title="确定要删除所有批次吗？"
              description="所有关联报告和指标数据将被永久删除，此操作不可撤销"
              onConfirm={onDeleteAllBatches}
              okText="全部删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button danger icon={<DeleteOutlined />} className="chart-header-btn">删除全部</Button>
            </Popconfirm>
          )}
        </Space>
      </div>
      <Table
        columns={columns} dataSource={batches} rowKey="batch_id" loading={loading}
        pagination={{ ...pagination, onChange: onPageChange }}
        className="batch-table"
        rowClassName={(record) => {
          const base = 'batch-row'
          if (record.batch_id === selectedBatchId) return `${base} batch-row-selected`
          return base
        }}
        onRow={(record) => ({
          onClick: () => onSelectBatch?.(record.batch_id),
          style: { cursor: 'pointer' },
        })}
      />
    </div>
  )
}

export default BatchTable
