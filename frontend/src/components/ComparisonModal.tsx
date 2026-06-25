import { useMemo } from 'react'
import { Modal, Table, Button, Tag, Tooltip, message } from 'antd'
import { DownloadOutlined, BarChartOutlined, MessageOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { MetricColumnDef, ReportCompareItem } from '../services/batchService'
import { useChatStore } from '../stores/chatStore'
import { useDraggableModal } from '../hooks/useDraggableModal'
import './ComparisonModal.css'

interface ComparisonModalProps {
  open: boolean
  batchId: number | null
  batchName: string | null
  data: ReportCompareItem[]
  metricDefinitions: MetricColumnDef[]
  onClose: () => void
}

// 格式化数值显示
function formatMetricValue(value: any): string {
  if (value === null || value === undefined) return '-'
  const num = Number(value)
  if (isNaN(num)) return String(value)
  if (num >= 1_000_000) return num.toLocaleString()
  if (num % 1 !== 0) return num.toFixed(4)
  return num.toLocaleString()
}

/** 根据异常详情生成人类可读的 tooltip 文本 */
function buildAnomalyTooltip(
  detail?: {
    direction: string
    deviation: number
    method: string
    threshold: number
  },
  fallbackDirection?: string,
  fallbackValue?: any,
): string {
  const dirStr = detail?.direction || fallbackDirection || ''
  const dirLabel = dirStr === 'high' ? '显著偏高' : dirStr === 'low' ? '显著偏低' : '异常'

  const methodLabels: Record<string, string> = {
    median_deviation: '中位数偏离法',
    iqr: '四分位距法（IQR）',
    zscore: 'Z-Score 法',
  }

  let text = `⚠️ ${dirLabel}`

  // 显示具体数值（如果有）
  if (fallbackValue !== null && fallbackValue !== undefined) {
    text += `\n当前值: ${formatMetricValue(fallbackValue)}`
  }

  // 有详细数据时，给出检测方法特有的解释
  if (detail && detail.method) {
    if (detail.method === 'median_deviation') {
      const devPct = (detail.deviation * 100).toFixed(1)
      const thrPct = detail.threshold != null ? (detail.threshold * 100).toFixed(1) : '?'
      text += `\n偏离中位数 ${devPct}%（阈值 ${thrPct}%）`
    } else if (detail.method === 'iqr') {
      const boundary = detail.direction === 'high' ? '上界' : '下界'
      const thrStr = detail.threshold != null ? detail.threshold.toFixed(1) : '?'
      text += `\n超出${boundary} ${detail.deviation.toFixed(1)} 倍 IQR（阈值 ${thrStr} 倍）`
    } else if (detail.method === 'zscore') {
      const thrStr = detail.threshold != null ? `${detail.threshold.toFixed(1)}σ` : '?σ'
      text += `\n偏离均值 ${detail.deviation.toFixed(1)} 个标准差（阈值 ${thrStr}）`
    } else {
      text += `\n偏离度: ${detail.deviation.toFixed(2)}`
    }
    const methodLabel = methodLabels[detail.method] || detail.method
    text += `\n检测方法: ${methodLabel}`
  } else if (!detail) {
    // 无详情时的回退说明
    text += `\n该数值在同类报告中${dirStr === 'high' ? '偏高' : '偏低'}异常`
    text += `\n（详细检测数据暂不可用）`
  }

  return text
}

function ComparisonModal({ open, batchId, batchName, data, metricDefinitions, onClose }: ComparisonModalProps) {
  const { modalRender } = useDraggableModal()
  const { setReportId } = useChatStore()

  // ── 动态表格列 ──────────────────────────────────────────
  const columns = useMemo(() => {
    // 固定左列：文件名
    const fixedLeft: any = {
      title: '文件名', dataIndex: 'filename', key: 'filename',
      width: 200, fixed: 'left' as const, className: 'table-header',
      render: (_: any, record: ReportCompareItem) => (
        <div>
          <div style={{ fontWeight: 500 }}>{record.filename}</div>
          {record.entity_name && (
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
              {record.entity_name}
            </div>
          )}
        </div>
      ),
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
        const detail = record.anomaly_details?.[def.metric_key]

        if (value === null || value === undefined) {
          return <span className="anomaly-cell">-</span>
        }

        // 动态异常样式 — 基于方向
        let anomalyClass = ''
        let tooltip = ''
        if (anomaly) {
          if (anomaly === 'high') {
            anomalyClass = 'anomaly-danger'
          } else if (anomaly === 'low') {
            anomalyClass = 'anomaly-low'
          } else {
            anomalyClass = 'anomaly-warning'
          }
          tooltip = buildAnomalyTooltip(detail, anomaly, value)
        }

        const display = formatMetricValue(value)

        if (anomaly) {
          return (
            <Tooltip title={<div style={{ whiteSpace: 'pre-line' }}>{tooltip}</div>}>
              <span className={`anomaly-cell ${anomalyClass}`}>
                {display}
                <ExclamationCircleOutlined className="anomaly-icon" />
              </span>
            </Tooltip>
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
      const headers = ['文件名', '公司名称', ...metricDefinitions.map((d) => d.metric_label)]

      // 动态数据行
      const rows = data.map((item) => {
        return [
          item.filename || '',
          item.entity_name || '',
          ...metricDefinitions.map((def) => {
            const value = item.metrics[def.metric_key]
            if (value === null || value === undefined) return ''
            if (def.expected_type === 'NUMERIC') {
              const num = Number(value)
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
        { wch: 25 },
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
      modalRender={modalRender}
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
        <Tag color="red" className="legend-tag"><ExclamationCircleOutlined /> 红色：数值显著偏高</Tag>
        <Tag color="orange" className="legend-tag"><ExclamationCircleOutlined /> 琥珀色：数值显著偏低</Tag>
        <span style={{ fontSize: 12, color: '#999' }}>悬停图标查看具体偏离幅度与检测方法</span>
      </div>
    </Modal>
  )
}

export default ComparisonModal
