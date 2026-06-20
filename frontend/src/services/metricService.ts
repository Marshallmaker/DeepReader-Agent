import api from './api'

export interface MetricDefinition {
  id: number
  metric_key: string
  metric_label: string
  expected_type: 'NUMERIC' | 'TEXT'
  prompt_instruction?: string
  is_system: boolean
}

export interface MetricDefinitionResponse {
  status: string
  message: string
  data: MetricDefinition
}

export interface MetricDefinitionListResponse {
  status: string
  data: MetricDefinition[]
}

export interface CreateMetricRequest {
  metric_key: string
  metric_label: string
  expected_type?: 'NUMERIC' | 'TEXT'
  prompt_instruction?: string
}

export const metricService = {
  /**
   * 获取当前用户的所有指标定义列表
   */
  async getMetricDefinitions(): Promise<MetricDefinitionListResponse> {
    const response = await api.get('/metrics/definitions')
    return response.data
  },

  /**
   * 创建新的自定义指标
   */
  async createMetric(data: CreateMetricRequest): Promise<MetricDefinitionResponse> {
    const response = await api.post('/metrics/definitions', data)
    return response.data
  },

  /**
   * 删除指定的指标定义
   */
  async deleteMetric(metricId: number): Promise<{ status: string; message: string }> {
    const response = await api.delete(`/metrics/definitions/${metricId}`)
    return response.data
  }
}