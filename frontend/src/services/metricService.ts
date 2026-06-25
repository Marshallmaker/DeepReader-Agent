import api from './api'

export interface MetricDefinition {
  id: number
  metric_key: string
  metric_label: string
  expected_type: 'NUMERIC' | 'TEXT'
  prompt_instruction?: string
  is_system: boolean
  is_active: boolean
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

export interface UpdateMetricRequest {
  metric_label?: string
  expected_type?: 'NUMERIC' | 'TEXT'
  prompt_instruction?: string
}

/** 批量删除响应 */
export interface BatchDeleteResponse {
  status: string
  message: string
  deleted_count: number
  skipped_count: number
  skipped_labels: string[]
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
   * 更新指定的指标定义
   */
  async updateMetric(id: number, data: UpdateMetricRequest): Promise<MetricDefinitionResponse> {
    const response = await api.put(`/metrics/definitions/${id}`, data)
    return response.data
  },

  /**
   * 删除指定的指标定义
   */
  async deleteMetric(metricId: number): Promise<{ status: string; message: string }> {
    const response = await api.delete(`/metrics/definitions/${metricId}`)
    return response.data
  },

  /**
   * 批量删除指标定义
   */
  async deleteMetrics(ids: number[]): Promise<BatchDeleteResponse> {
    const response = await api.delete('/metrics/definitions/batch', { data: { ids } })
    return response.data
  },

  // ========== 管理员系统指标管理 ==========

  /**
   * 获取所有系统指标（管理员专用，含已禁用的指标）
   */
  async getAdminMetrics(params?: { page?: number; page_size?: number }): Promise<AdminMetricsListResponse> {
    const response = await api.get('/admin/metrics', { params })
    return response.data
  },

  /**
   * 创建新的系统指标（管理员专用）
   */
  async createSystemMetric(data: AdminMetricCreateRequest): Promise<MetricDefinitionResponse> {
    const response = await api.post('/admin/metrics', data)
    return response.data
  },

  /**
   * 更新系统指标（管理员专用，含 is_active 切换）
   */
  async updateSystemMetric(id: number, data: AdminMetricUpdateRequest): Promise<MetricDefinitionResponse> {
    const response = await api.put(`/admin/metrics/${id}`, data)
    return response.data
  },

  /**
   * 删除系统指标（管理员专用）
   */
  async deleteSystemMetric(id: number): Promise<{ status: string; message: string }> {
    const response = await api.delete(`/admin/metrics/${id}`)
    return response.data
  },

  /**
   * 快速切换系统指标的启用/禁用状态（管理员专用）
   */
  async toggleSystemMetricActive(id: number): Promise<{ status: string; message: string; is_active: boolean }> {
    const response = await api.patch(`/admin/metrics/${id}/active`)
    return response.data
  }
}

/** 管理员指标列表响应 */
export interface AdminMetricsListResponse {
  total: number
  page: number
  page_size: number
  items: MetricDefinition[]
}

/** 管理员创建系统指标请求 */
export interface AdminMetricCreateRequest {
  metric_key: string
  metric_label: string
  expected_type?: 'NUMERIC' | 'TEXT'
  prompt_instruction?: string
  is_active?: boolean
}

/** 管理员更新系统指标请求 */
export interface AdminMetricUpdateRequest {
  metric_label?: string
  expected_type?: 'NUMERIC' | 'TEXT'
  prompt_instruction?: string
  is_active?: boolean
}