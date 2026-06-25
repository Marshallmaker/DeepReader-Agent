import api from './api'

export interface MetricTagInfo {
  metric_key: string
  metric_label: string
  expected_type: 'NUMERIC' | 'TEXT'
}

export interface BatchResponse {
  batch_id: number
  batch_name: string | null
  status: string
  total_files: number
  processed_files: number
  created_at: string
  metric_tags: MetricTagInfo[]
}

export interface BatchListResponse {
  total: number
  page: number
  page_size: number
  items: BatchResponse[]
}

export interface MetricColumnDef {
  metric_key: string
  metric_label: string
  expected_type: 'NUMERIC' | 'TEXT'
}

export interface ReportCompareItem {
  report_id: number
  filename: string
  entity_name: string | null
  metrics: Record<string, any>
  anomalies: Record<string, string>
  anomaly_details?: Record<string, { direction: string; deviation: number; method: string; threshold: number }>
}

export interface MetricMatrixResponse {
  batch_id: number
  batch_name: string | null
  total_reports: number
  metric_definitions: MetricColumnDef[]
  reports: ReportCompareItem[]
}

export const batchService = {
  async getBatches(page: number = 1, pageSize: number = 10): Promise<BatchListResponse> {
    const response = await api.get('/batches', {
      params: { page, page_size: pageSize }
    })
    return response.data
  },
  
  async getBatchDetail(batchId: number): Promise<any> {
    const response = await api.get(`/batches/${batchId}`)
    return response.data
  },
  
  async getBatchComparison(batchId: number): Promise<MetricMatrixResponse> {
    const response = await api.get(`/batches/${batchId}/compare`)
    return response.data
  },

  async deleteBatch(batchId: number): Promise<{ message: string }> {
    const response = await api.delete(`/batches/${batchId}`)
    return response.data
  },

  async deleteAllBatches(): Promise<{ message: string; deleted_count: number }> {
    const response = await api.delete('/batches')
    return response.data
  },

  async renameBatch(batchId: number, batchName: string): Promise<{ message: string }> {
    const response = await api.put(`/batches/${batchId}`, { batch_name: batchName })
    return response.data
  },

  async deleteReport(reportId: number): Promise<{ message: string }> {
    const response = await api.delete(`/files/reports/${reportId}`)
    return response.data
  },

  async renameReport(reportId: number, originalFilename: string): Promise<{ message: string }> {
    const response = await api.put(`/files/reports/${reportId}`, { original_filename: originalFilename })
    return response.data
  },

  async updateBatchMetrics(batchId: number, metricIds: number[]): Promise<{ message: string; batch_id: number; metric_count: number }> {
    const response = await api.put(`/batches/${batchId}/metrics`, { metric_ids: metricIds })
    return response.data
  },
}