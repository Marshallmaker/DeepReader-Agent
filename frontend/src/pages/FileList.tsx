import { useState, useEffect, useCallback } from 'react'
import { Table, Select, Input, Tag, Space, message, Modal, Button } from 'antd'
import { FileTextOutlined, ClockCircleOutlined, CheckCircleOutlined, CloseCircleOutlined, ReloadOutlined, EyeOutlined } from '@ant-design/icons'
import { fileService, FileListItem, ReportContentResponse } from '../services/fileService'
import { batchService, BatchResponse } from '../services/batchService'
import { useDraggableModal } from '../hooks/useDraggableModal'
import './FileList.css'

const STATUS_CONFIG: Record<string, { color: string; text: string; icon: any }> = {
  pending: { color: 'processing', text: '等待中', icon: ClockCircleOutlined },
  parsing: { color: 'processing', text: '解析中', icon: ReloadOutlined },
  extracting: { color: 'processing', text: '提取中', icon: ReloadOutlined },
  success: { color: 'success', text: '已完成', icon: CheckCircleOutlined },
  failed: { color: 'error', text: '失败', icon: CloseCircleOutlined },
}

function formatFileSize(bytes: number): string {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileList() {
  const { modalRender } = useDraggableModal()
  const [files, setFiles] = useState<FileListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [batchFilter, setBatchFilter] = useState<number | undefined>()
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [filenameFilter, setFilenameFilter] = useState('')
  const [searchInputValue, setSearchInputValue] = useState('')  // 输入框受控值（与筛选状态解耦）
  const [batches, setBatches] = useState<BatchResponse[]>([])

  // ── 报告内容查看 ──────────────────────────────────────
  const [contentModal, setContentModal] = useState(false)
  const [contentLoading, setContentLoading] = useState(false)
  const [reportContent, setReportContent] = useState<ReportContentResponse | null>(null)

  const loadBatches = useCallback(async () => {
    try {
      const resp = await batchService.getBatches(1, 100)  // 后端最大 page_size=100
      setBatches(resp.items)
    } catch {
      message.error('加载批次列表失败，批次筛选不可用')
    }
  }, [])

  const loadFiles = useCallback(async (page: number, pageSize: number) => {
    setLoading(true)
    try {
      const resp = await fileService.getFiles({
        page,
        page_size: pageSize,
        batch_id: batchFilter,
        status: statusFilter,
        filename: filenameFilter || undefined,
      })
      setFiles(resp.items)
      setPagination({ current: resp.page, pageSize: resp.page_size, total: resp.total })
    } catch {
      message.error('加载文件列表失败')
    } finally {
      setLoading(false)
    }
  }, [batchFilter, statusFilter, filenameFilter])

  useEffect(() => {
    loadBatches()
  }, [loadBatches])

  useEffect(() => {
    loadFiles(1, pagination.pageSize)
  }, [loadFiles])

  const handleViewContent = async (reportId: number) => {
    setContentLoading(true)
    setContentModal(true)
    try {
      const resp = await fileService.getReportContent(reportId)
      setReportContent(resp)
    } catch {
      message.error('加载报告内容失败')
      setContentModal(false)
    } finally {
      setContentLoading(false)
    }
  }

  const columns = [
    {
      title: '文件名', dataIndex: 'original_filename', key: 'filename',
      render: (text: string) => (
        <Space>
          <FileTextOutlined />
          <span>{text}</span>
        </Space>
      ),
    },
    {
      title: '所属批次', dataIndex: 'batch_name', key: 'batch',
      render: (text: string, record: FileListItem) => text || `批次${record.batch_id}`,
    },
    {
      title: '公司名称', dataIndex: 'entity_name', key: 'entity',
      render: (text: string | null) => text || <span style={{ color: '#ccc' }}>—</span>,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (status: string) => {
        const c = STATUS_CONFIG[status] || STATUS_CONFIG.pending
        const Icon = c.icon
        return <Tag color={c.color}><Icon /> {c.text}</Tag>
      },
    },
    {
      title: '大小', dataIndex: 'file_size', key: 'size', width: 100,
      render: (size: number) => formatFileSize(size),
    },
    {
      title: '上传时间', dataIndex: 'created_at', key: 'created_at', width: 170,
      render: (text: string) => new Date(text).toLocaleString('zh-CN'),
    },
    {
      title: '操作', key: 'action', width: 80,
      render: (_: any, record: FileListItem) => (
        <Button
          type="text"
          icon={<EyeOutlined />}
          disabled={record.status !== 'success'}
          onClick={() => handleViewContent(record.report_id)}
        >
          查看
        </Button>
      ),
    },
  ]

  return (
    <div className="filelist-page">
      <div className="page-header">
        <div>
          <h1 className="page-header-title">全部文件</h1>
          <p className="page-header-subtitle">跨批次统一查看所有已上传的 PDF 报告文件</p>
        </div>
      </div>

      <div className="section-card">
        <div className="card-header">
          <h3 className="card-title"><FileTextOutlined /> 文件列表</h3>
          <Space>
            <Input.Search
              placeholder="搜索文件名（按回车搜索）"
              allowClear
              style={{ width: 240 }}
              value={searchInputValue}
              onChange={(e) => {
                setSearchInputValue(e.target.value)
                // 清除按钮（allowClear）触发时立即重置筛选
                if (!e.target.value && filenameFilter) {
                  setFilenameFilter('')
                  setPagination((p) => ({ ...p, current: 1 }))
                }
              }}
              onSearch={(value) => {
                const trimmed = value.trim()
                setFilenameFilter(trimmed)
                setSearchInputValue(trimmed)
                setPagination((p) => ({ ...p, current: 1 }))
              }}
            />
            <Select
              placeholder="按批次筛选"
              allowClear
              style={{ width: 200 }}
              value={batchFilter}
              onChange={(v) => { setBatchFilter(v); setPagination((p) => ({ ...p, current: 1 })) }}
              options={batches.map((b) => ({
                value: b.batch_id,
                label: b.batch_name || `批次${b.batch_id}`,
              }))}
            />
            <Select
              placeholder="按状态筛选"
              allowClear
              style={{ width: 140 }}
              value={statusFilter}
              onChange={(v) => { setStatusFilter(v); setPagination((p) => ({ ...p, current: 1 })) }}
              options={[
                { value: 'success', label: '已完成' },
                { value: 'failed', label: '失败' },
                { value: 'pending', label: '等待中' },
                { value: 'parsing', label: '解析中' },
                { value: 'extracting', label: '提取中' },
              ]}
            />
          </Space>
        </div>
        <Table
          columns={columns}
          dataSource={files}
          rowKey="report_id"
          loading={loading}
          pagination={{
            ...pagination,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
            onChange: (page, pageSize) => loadFiles(page, pageSize),
          }}
          className="batch-table"
        />
      </div>

      {/* 报告内容查看 Modal */}
      <Modal
        modalRender={modalRender}
        title={reportContent ? `报告内容 — ${reportContent.filename}` : '加载中...'}
        open={contentModal}
        onCancel={() => { setContentModal(false); setReportContent(null) }}
        footer={<Button onClick={() => { setContentModal(false); setReportContent(null) }}>关闭</Button>}
        width={900}
        destroyOnHidden
      >
        {contentLoading && !reportContent ? (
          <div style={{ textAlign: 'center', padding: 40 }}>加载中...</div>
        ) : reportContent ? (
          <div>
            <div style={{ display: 'flex', gap: 24, marginBottom: 16, fontSize: 13, color: '#666', flexWrap: 'wrap' }}>
              <span>公司：<strong>{reportContent.entity_name || '—'}</strong></span>
              <span>批次：<strong>{reportContent.batch_name || `#${reportContent.batch_id}`}</strong></span>
              <span>大小：<strong>{formatFileSize(reportContent.file_size)}</strong></span>
              <span>提取指标：<strong>{reportContent.metrics_count} 项</strong></span>
              <Tag color={reportContent.status === 'success' ? 'success' : 'error'}>{reportContent.status}</Tag>
            </div>
            {reportContent.pdf_exists ? (
              <iframe
                src={fileService.getReportPdfUrl(reportContent.report_id)}
                style={{
                  width: '100%',
                  height: '70vh',
                  border: 'none',
                  borderRadius: 8,
                }}
                title={reportContent.filename}
                onError={() => {
                  // iframe 加载失败时切换为提示状态
                  const el = document.getElementById(`pdf-iframe-${reportContent.report_id}`)
                  if (el) el.style.display = 'none'
                  const fallback = document.getElementById(`pdf-fallback-${reportContent.report_id}`)
                  if (fallback) fallback.style.display = 'flex'
                }}
                id={`pdf-iframe-${reportContent.report_id}`}
              />
            ) : null}
            <div
              id={`pdf-fallback-${reportContent.report_id}`}
              style={{
                display: reportContent.pdf_exists ? 'none' : 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '40vh',
                background: '#fafafa',
                border: '1px dashed #d9d9d9',
                borderRadius: 8,
                color: '#999',
                gap: 12,
              }}
            >
              <FileTextOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />
              <span style={{ fontSize: 15 }}>PDF 文件已从磁盘丢失</span>
              <span style={{ fontSize: 13, color: '#bbb' }}>报告元数据和提取指标仍可正常查看</span>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

export default FileList
