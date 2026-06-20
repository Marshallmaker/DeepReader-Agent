import { useState, useEffect } from 'react'
import { Table, Card, Button, Tag, Space, Input, Select, Modal, message, Collapse } from 'antd'
import { SearchOutlined, HistoryOutlined, EyeOutlined, FileTextOutlined, UserOutlined } from '@ant-design/icons'
import api from '../services/api'
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
  const [users, setUsers] = useState<UserItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<boolean | null>(null)
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

  useEffect(() => { loadUsers(1, 10) }, [])

  const loadUsers = async (page: number, pageSize: number) => {
    setLoading(true)
    try {
      const params: any = { page, page_size: pageSize }
      if (searchKeyword) params.search_keyword = searchKeyword
      if (statusFilter !== null) params.is_active = statusFilter
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

  const userColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '邮箱', dataIndex: 'email', key: 'email', width: 200 },
    { title: '昵称', dataIndex: 'nickname', key: 'nickname',
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
    { title: '批次名称', dataIndex: 'batch_name', key: 'batch_name',
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
    { title: '文件名', dataIndex: 'filename', key: 'filename' },
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

  return (
    <div className="admin-panel">
      {/* 页头 */}
      <div className="page-header">
        <div>
          <h1 className="page-header-title">
            <UserOutlined style={{ marginRight: 8 }} />管理面板
          </h1>
          <p className="page-header-subtitle">用户管理、批次审计与报告审核</p>
        </div>
      </div>

      {/* 搜索卡片 */}
      <Card className="admin-search-card">
        <div className="admin-filters">
          <Input
            placeholder="搜索邮箱或昵称"
            prefix={<SearchOutlined />}
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 240 }}
            allowClear
          />
          <Select
            placeholder="状态筛选"
            allowClear
            value={statusFilter}
            onChange={(value) => setStatusFilter(value)}
            style={{ width: 120 }}
            options={[
              { label: '活跃', value: true },
              { label: '禁用', value: false },
            ]}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
            搜索
          </Button>
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

      {/* 用户批次 Modal */}
      <Modal
        title={`用户 #${selectedUser} 的批次列表`}
        open={userBatchesModal}
        onCancel={() => setUserBatchesModal(false)}
        width={900}
        footer={[<Button key="close" onClick={() => setUserBatchesModal(false)}>关闭</Button>]}
      >
        <Table columns={batchColumns} dataSource={userBatches} rowKey="batch_id" pagination={false} />
      </Modal>

      {/* 报告列表 Modal */}
      <Modal
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

      {/* 报告详情 Modal */}
      <Modal
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
    </div>
  )
}

export default AdminPanel
