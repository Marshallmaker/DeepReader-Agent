import { useState } from 'react'
import { Upload, Button, Input, message } from 'antd'
import { UploadOutlined, CloudUploadOutlined, DeleteOutlined, SettingOutlined, TagOutlined, DownOutlined, UpOutlined, BulbOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd/es/upload/interface'
import { fileService } from '../services/fileService'
import { extractErrorMessage } from '../utils/errorHandler'
import AIMetricRecommender from './AIMetricRecommender'
import './UploadZone.css'

const { Dragger } = Upload

const MAX_VISIBLE_METRICS = 5

interface UploadZoneProps {
  selectedMetrics: number[]
  metricsLabels: string[]
  onUploadSuccess: (newBatchId?: number) => void
  onOpenMetricSettings: () => void
  /** AI 推荐指标后，回传新指标 ID 追加到已选列表 */
  onMetricsChange?: (ids: number[]) => void
}

function UploadZone({ selectedMetrics, metricsLabels, onUploadSuccess, onOpenMetricSettings, onMetricsChange }: UploadZoneProps) {
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [oversizedFiles, setOversizedFiles] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [batchName, setBatchName] = useState('')
  const [showAllMetrics, setShowAllMetrics] = useState(false)
  const [showAIRecommender, setShowAIRecommender] = useState(false)

  const handleFileChange = ({ fileList: newFileList }: { fileList: UploadFile[] }) => {
    const maxSize = 20 * 1024 * 1024
    const oversized = newFileList
      .filter(file => file.size && file.size > maxSize)
      .map(file => file.name)

    setOversizedFiles(oversized)
    setFileList(newFileList)
  }

  const handleUpload = async () => {
    if (fileList.length === 0) {
      message.warning('请选择要上传的PDF文件')
      return
    }
    if (fileList.length > 10) {
      message.error('单次最多上传10个文件')
      return
    }
    if (oversizedFiles.length > 0) {
      message.error(`以下文件超过20MB限制: ${oversizedFiles.join(', ')}`)
      return
    }
    if (selectedMetrics.length === 0) {
      message.warning('请至少选择一个要提取的指标')
      return
    }

    setUploading(true)
    try {
      const files = fileList.map(f => f.originFileObj as File)
      const name = batchName.trim() || undefined
      const response = await fileService.uploadFiles(files, name, selectedMetrics)
      message.success(response.message)
      setFileList([])
      setOversizedFiles([])
      setBatchName('')
      onUploadSuccess(response.batch_id)
    } catch (error) {
      message.error(extractErrorMessage(error, '上传失败'))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="section-card upload-card">
      <div className="card-header">
        <h3 className="card-title">
          <CloudUploadOutlined /> 批量上传PDF研报
        </h3>
        <Button
          icon={<SettingOutlined />}
          onClick={onOpenMetricSettings}
          className="metric-settings-btn"
        >
          指标设置
        </Button>
      </div>

      <div
        className={`upload-zone ${isDragging ? 'dragging' : ''}`}
        onDragEnter={() => setIsDragging(true)}
        onDragLeave={() => setIsDragging(false)}
      >
        <Dragger
          fileList={fileList}
          onChange={handleFileChange}
          beforeUpload={() => false}
          accept=".pdf"
          multiple
          className="custom-dragger"
        >
          <div className="upload-inner">
            <div className={`upload-icon-wrapper ${isDragging ? 'dragging-icon' : ''}`}>
              <UploadOutlined className="upload-icon" />
            </div>
            <p className="upload-text">
              {isDragging ? '松开鼠标开始上传' : '点击或拖拽文件到此区域上传'}
            </p>
            <p className="upload-hint">
              支持单次最多10个PDF文件，单个文件不超过20MB
            </p>
            {fileList.length > 0 && (
              <p className="file-count">已选择 {fileList.length} 个文件</p>
            )}
          </div>
        </Dragger>
      </div>

      <div className="upload-actions">
        <Button
          type="primary"
          onClick={handleUpload}
          loading={uploading}
          icon={<CloudUploadOutlined />}
          className="upload-btn"
          disabled={fileList.length === 0 || oversizedFiles.length > 0}
        >
          开始上传
        </Button>
        <Button
          icon={<BulbOutlined />}
          onClick={() => setShowAIRecommender(true)}
          className="ai-recommend-upload-btn"
        >
          AI 推荐指标
        </Button>
        {fileList.length > 0 && (
          <Button
            onClick={() => { setFileList([]); setOversizedFiles([]); setBatchName('') }}
            icon={<DeleteOutlined />}
          >
            清空
          </Button>
        )}
      </div>

      <div className="batch-name-input">
        <Input
          prefix={<TagOutlined />}
          placeholder="批次名称（可选，默认自动生成）"
          value={batchName}
          onChange={(e) => setBatchName(e.target.value)}
          maxLength={255}
          className="custom-input"
        />
      </div>

      <div className="selected-metrics-hint">
        <span className="hint-label">已选指标 ({selectedMetrics.length}个):</span>
        <span className="hint-value">
          {metricsLabels.length === 0
            ? '未选择'
            : showAllMetrics || metricsLabels.length <= MAX_VISIBLE_METRICS
              ? metricsLabels.join(', ')
              : metricsLabels.slice(0, MAX_VISIBLE_METRICS).join(', ') + '…'}
        </span>
        {metricsLabels.length > MAX_VISIBLE_METRICS && (
          <span
            className="hint-toggle"
            onClick={() => setShowAllMetrics(!showAllMetrics)}
          >
            {showAllMetrics ? <><UpOutlined /> 收起</> : <><DownOutlined /> 等 {metricsLabels.length} 个</>}
          </span>
        )}
      </div>

      <AIMetricRecommender
        open={showAIRecommender}
        onClose={() => setShowAIRecommender(false)}
        onCreated={() => {}}
        pendingFiles={fileList.length > 0 ? fileList : undefined}
        onApply={(ids) => {
          if (onMetricsChange) {
            const uniqueIds = [...new Set([...selectedMetrics, ...ids])]
            onMetricsChange(uniqueIds)
          }
        }}
      />
    </div>
  )
}

export default UploadZone
