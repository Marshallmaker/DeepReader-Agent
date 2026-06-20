import api from './api'
import { useAuthStore } from '../stores/authStore'

export interface UploadResponse {
  batch_id: number
  status: string
  processed_files: number
  total_files: number
  message: string
}

export const fileService = {
  /**
   * 批量上传文件
   * @param files - 文件列表
   * @param batchName - 批次名称
   * @param metricIds - 选中的指标ID列表
   */
  async uploadFiles(files: File[], batchName?: string, metricIds?: number[]): Promise<UploadResponse> {
    const formData = new FormData()
    
    files.forEach((file) => {
      formData.append('files', file, file.name)
    })
    
    if (batchName) {
      formData.append('batch_name', batchName)
    } else {
      formData.append('batch_name', `批次_${Date.now()}`)
    }
    
    // 按需求文档 §3.6.2：多个同名 FormData 字段逐个追加
    if (metricIds && metricIds.length > 0) {
      metricIds.forEach(id => formData.append('metric_ids', String(id)))
    }
    
    const response = await api.post('/files/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      timeout: 120000
    })

    return response.data
  },

  /** 获取跨批次文件列表 */
  async getFiles(params?: {
    page?: number
    pageSize?: number
    batchId?: number
    status?: string
  }): Promise<FileListResponse> {
    const response = await api.get('/files', { params })
    return response.data
  },

  /** 查看报告内容（AI 提取的 Markdown） */
  async getReportContent(reportId: number): Promise<ReportContentResponse> {
    const response = await api.get(`/files/reports/${reportId}`)
    return response.data
  },

  /** 获取原始 PDF 文件的访问 URL（携带 token 用于 iframe 内嵌预览） */
  getReportPdfUrl(reportId: number): string {
    const token = useAuthStore.getState().accessToken
    const params = token ? `?token=${encodeURIComponent(token)}` : ''
    return `/api/v1/files/reports/${reportId}/pdf${params}`
  },
}

export interface FileListItem {
  report_id: number
  original_filename: string
  batch_id: number
  batch_name: string | null
  entity_name: string | null
  status: string
  file_size: number
  created_at: string
}

export interface FileListResponse {
  total: number
  page: number
  page_size: number
  items: FileListItem[]
}

export interface ReportContentResponse {
  report_id: number
  filename: string
  batch_id: number
  batch_name: string | null
  entity_name: string | null
  status: string
  file_size: number
  raw_markdown: string | null
  metrics_count: number
  created_at: string
}