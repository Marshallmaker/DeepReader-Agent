import { Card, Progress, Typography, Badge } from 'antd'
import { SyncOutlined } from '@ant-design/icons'
import { BatchResponse } from '../services/batchService'
import './ProcessingProgressOverlay.css'

const { Text } = Typography

interface Props {
  batches: BatchResponse[]
}

function ProcessingProgressOverlay({ batches }: Props) {
  const activeBatches = batches.filter(
    b => b.status === 'processing' || b.status === 'pending'
  )
  if (activeBatches.length === 0) return null

  return (
    <Card className="processing-overlay-card" bordered={false}>
      <div className="processing-overlay-header">
        <Badge status="processing" />
        <Text strong style={{ fontSize: 18 }}>
          正在处理中（{activeBatches.length} 个批次）
        </Text>
      </div>
      <div className="processing-overlay-list">
        {activeBatches.map(batch => {
          const percent = batch.total_files > 0
            ? Math.round((batch.processed_files / batch.total_files) * 100)
            : 0
          return (
            <div key={batch.batch_id} className="processing-overlay-item">
              <div className="processing-overlay-item-header">
                <SyncOutlined spin style={{ color: '#1677ff' }} />
                <Text strong>{batch.batch_name || '未命名批次'}</Text>
                <Text type="secondary">#{batch.batch_id}</Text>
              </div>
              <Progress
                percent={percent}
                strokeColor={{
                  '0%': '#108ee9',
                  '100%': '#87d068',
                }}
                format={() => `${batch.processed_files}/${batch.total_files}`}
                className="processing-overlay-progress"
              />
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export default ProcessingProgressOverlay
