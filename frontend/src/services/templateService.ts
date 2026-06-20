import api from './api'

/** 模板中包含的单个指标项 */
export interface MetricItem {
  metric_key: string
  metric_label: string
  expected_type: 'NUMERIC' | 'TEXT'
  prompt_instruction?: string
}

/** 单个模板的完整响应 */
export interface TemplateResponse {
  id: number
  name: string
  description?: string
  category?: string
  is_system: boolean
  user_id?: number
  metrics: MetricItem[]
  metric_count: number
  created_at: string
  updated_at?: string
}

/** 模板列表响应 */
export interface TemplateListResponse {
  status: string
  data: TemplateResponse[]
}

/** 模板导入响应 */
export interface TemplateImportResponse {
  status: string
  message: string
  created_count: number
  skipped_count: number
}

/** 创建模板请求 */
export interface CreateTemplateRequest {
  name: string
  description?: string
  category?: string
  metrics: MetricItem[]
}

/** 更新模板请求（全部字段可选） */
export interface UpdateTemplateRequest {
  name?: string
  description?: string
  category?: string
  metrics?: MetricItem[]
}

export const templateService = {
  /**
   * 获取当前用户可见的指标模板列表
   * @param category 可选分类筛选
   */
  async getTemplates(category?: string): Promise<TemplateListResponse> {
    const params: Record<string, string> = {}
    if (category) params.category = category
    const response = await api.get('/metrics/templates', { params })
    return response.data
  },

  /**
   * 创建用户自定义指标模板
   */
  async createTemplate(data: CreateTemplateRequest): Promise<{ status: string; data: TemplateResponse }> {
    const response = await api.post('/metrics/templates', data)
    return response.data
  },

  /**
   * 更新用户自定义指标模板
   */
  async updateTemplate(id: number, data: UpdateTemplateRequest): Promise<{ status: string; data: TemplateResponse }> {
    const response = await api.put(`/metrics/templates/${id}`, data)
    return response.data
  },

  /**
   * 删除用户自定义指标模板
   */
  async deleteTemplate(id: number): Promise<{ status: string; message: string }> {
    const response = await api.delete(`/metrics/templates/${id}`)
    return response.data
  },

  /**
   * 将模板中的指标定义导入到当前用户
   */
  async importTemplate(id: number): Promise<TemplateImportResponse> {
    const response = await api.post(`/metrics/templates/${id}/import`)
    return response.data
  },
}
