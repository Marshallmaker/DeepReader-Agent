import { useMemo } from 'react'
import { Modal, Table, Button, Tag, Tooltip, message } from 'antd'
import { DownloadOutlined, BarChartOutlined, MessageOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { MetricColumnDef, ReportCompareItem } from '../services/batchService'
import { useChatStore } from '../stores/chatStore'
import './ComparisonModal.css'

interface ComparisonModalProps {
  open: boolean
  batchId: number | null
  batchName: string | null
  data: ReportCompareItem[]
  metricDefinitions: MetricColumnDef[]
  onClose: () => void
}

// 已知异常分类（港股回购标准指标）—— 用于样式映射
const PRICE_ANOMALY_KEYS = new Set(['highest_price_paid', 'lowest_price_paid'])
const VOLUME_ANOMALY_KEYS = new Set(['shares_repurchased', 'total_consideration'])

// 格式化数值显示
function formatMetricValue(value: any, metricKey: string): string {
  if (value === null || value === undefined) return '-'
  const num = Number(value)
  if (isNaN(num)) return String(value)
  if (PRICE_ANOMALY_KEYS.has(metricKey)) return num.toFixed(4)
  if (num >= 1_000_000) return num.toLocaleString()
  if (num % 1 !== 0) return num.toFixed(4)
  return num.toLocaleString()
}

function ComparisonModal({ open, batchId, batchName, data, metricDefinitions, onClose }: ComparisonModalProps) {
  const { setReportId } = useChatStore()

  // ── 动态表格列 ──────────────────────────────────────────
  const columns = useMemo(() => {
    // 固定左列：文件名
    const fixedLeft: any = {
      title: '文件名', dataIndex: 'filename', key: 'filename',
      width: 200, fixed: 'left' as const, className: 'table-header',
      render: (_: any, record: ReportCompareItem) => record.filename,
    }

    // 动态列：每个指标定义一列
    const dynamicCols: any[] = metricDefinitions.map((def) => ({
      title: def.metric_label,
      dataIndex: def.metric_key,
      key: def.metric_key,
      width: 150,
      className: 'table-header',
      render: (_: any, record: ReportCompareItem) => {
        const value = record.metrics[def.metric_key]
        const anomaly = record.anomalies[def.metric_key]

        if (value === null || value === undefined) {
          return <span className="anomaly-cell">-</span>
        }

        // 异常样式
        let anomalyClass = ''
        let tooltip = ''
        if (anomaly) {
          if (PRICE_ANOMALY_KEYS.has(def.metric_key)) {
            anomalyClass = 'anomaly-danger'
            tooltip = '价格偏离中位数±5%以上'
          } else if (VOLUME_ANOMALY_KEYS.has(def.metric_key)) {
            anomalyClass = 'anomaly-warning'
            tooltip = '数量/总额超过均值200%'
          } else {
            anomalyClass = 'anomaly-warning'
            tooltip = `异常: ${anomaly}`
          }
        }

        const display = formatMetricValue(value, def.metric_key)

        if (anomaly) {
          return (
            <span className={`anomaly-cell ${anomalyClass}`}>
              {display}
              <Tooltip title={tooltip}><ExclamationCircleOutlined className="anomaly-icon" /></Tooltip>
            </span>
          )
        }
        return <span className="anomaly-cell">{display}</span>
      },
    }))

    // 固定右列：AI分析
    const fixedRight: any = {
      title: 'AI分析', key: 'ai_analysis', width: 120,
      fixed: 'right' as const, className: 'table-header',
      render: (_: any, record: ReportCompareItem) => (
        <Button type="primary" ghost icon={<MessageOutlined />} size="small"
          onClick={() => {
            setReportId(record.report_id, record.filename || '')
            message.success(`已将报告 "${record.filename}" 绑定到AI助手`)
          }}
          className="ai-analysis-btn">AI分析</Button>
      ),
    }

    return [fixedLeft, ...dynamicCols, fixedRight]
  }, [metricDefinitions, setReportId])

  // ── Excel 导出 ──────────────────────────────────────────
  const handleExportExcel = () => {
    if (!batchId || data.length === 0) {
      message.warning('没有可导出的数据')
      return
    }

    import('xlsx').then((XLSX) => {
      // 动态表头
      const headers = ['文件名', ...metricDefinitions.map((d) => d.metric_label)]

      // 动态数据行
      const rows = data.map((item) => {
        return [
          item.filename || '',
          ...metricDefinitions.map((def) => {
            const value = item.metrics[def.metric_key]
            if (value === null || value === undefined) return ''
            if (def.expected_type === 'NUMERIC') {
              const num = Number(value)
              if (PRICE_ANOMALY_KEYS.has(def.metric_key)) return num.toFixed(4)
              if (num >= 1_000_000) return num.toString()
              return num
            }
            return String(value)
          }),
        ]
      })

      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])

      // 动态列宽
      ws['!cols'] = [
        { wch: 30 },
        ...metricDefinitions.map((def) => {
          if (def.expected_type === 'NUMERIC') return { wch: 18 }
          return { wch: 15 }
        }),
      ]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '对比数据')
      const filename = batchName
        ? `${batchName}_对比数据.xlsx`
        : `批次${batchId}_对比数据.xlsx`
      XLSX.writeFile(wb, filename)
      message.success('导出成功')
    }).catch(() => message.error('导出Excel失败'))
  }

  // ── 动态滚动宽度 ──────────────────────────────────────
  const scrollX = 200 + metricDefinitions.length * 150 + 120

  return (
    <Modal
      title={<span className="modal-title"><BarChartOutlined /> {batchName || `批次 ${batchId}`} - 对比矩阵</span>}
      open={open} onCancel={onClose} width={1300} className="comparison-modal"
      footer={[
        <Button key="close" onClick={onClose}>关闭</Button>,
        <Button key="export" type="primary" icon={<DownloadOutlined />} onClick={handleExportExcel}>导出Excel</Button>,
      ]}
    >
      <Table
        columns={columns}
        dataSource={data}
        rowKey="report_id"
        scroll={{ x: scrollX }}
        pagination={false}
        className="metric-table"
      />
      <div className="anomaly-legend">
        <Tag color="orange" className="legend-tag"><ExclamationCircleOutlined /> 淡橘色：价格偏离中位数±5%以上</Tag>
        <Tag color="red" className="legend-tag"><ExclamationCircleOutlined /> 淡红色：数量/总额超过均值200%</Tag>
      </div>
    </Modal>
  )
}

export default ComparisonModal
