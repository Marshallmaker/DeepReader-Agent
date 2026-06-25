import api from './api'

/** 模板中包含的单个指标项 */
export interface MetricItem {
  metric_key: string
  metric_label: string
  expected_type: 'NUMERIC' | 'TEXT'
  prompt_instruction?: string
  disabled?: boolean
}

/** 单个模板的完整响应 */
export interface TemplateResponse {
  id: number
  name: string
  description?: string
  category?: string
  is_system: boolean
  is_active: boolean
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

  // ========== 管理员合集模版管理 ==========

  /**
   * 获取所有合集模版（管理员专用，含已禁用的）
   */
  async getAdminTemplates(params?: {
    page?: number; page_size?: number; category?: string; is_active?: boolean; is_system?: boolean
  }): Promise<AdminTemplateListResponse> {
    const response = await api.get('/admin/templates', { params })
    return response.data
  },

  /**
   * 创建合集模版（管理员专用）
   */
  async adminCreateTemplate(data: AdminCreateTemplateRequest): Promise<{ status: string; message: string; data: any }> {
    const response = await api.post('/admin/templates', data)
    return response.data
  },

  /**
   * 更新合集模版（管理员专用，含 metrics 完整替换）
   */
  async adminUpdateTemplate(id: number, data: AdminUpdateTemplateRequest): Promise<{ status: string; message: string; data: any }> {
    const response = await api.put(`/admin/templates/${id}`, data)
    return response.data
  },

  /**
   * 删除合集模版（管理员专用）
   */
  async adminDeleteTemplate(id: number): Promise<{ status: string; message: string }> {
    const response = await api.delete(`/admin/templates/${id}`)
    return response.data
  },

  /**
   * 切换合集模版启用/禁用（管理员专用）
   */
  async adminToggleTemplateActive(id: number): Promise<{ status: string; message: string; is_active: boolean }> {
    const response = await api.patch(`/admin/templates/${id}/active`)
    return response.data
  },

  /**
   * 一键启用/禁用所有系统合集模版（管理员专用）
   */
  async adminBulkToggleAllSystem(isActive: boolean): Promise<{ status: string; message: string; affected: number }> {
    const response = await api.patch('/admin/templates/toggle-all', { is_active: isActive })
    return response.data
  }
}

/** 管理员模版列表响应 */
export interface AdminTemplateListResponse {
  total: number
  page: number
  page_size: number
  items: TemplateResponse[]
}

/** 管理员创建合集模版请求 */
export interface AdminCreateTemplateRequest {
  name: string
  description?: string
  category?: string
  is_system: boolean
  is_active: boolean
  metrics: MetricItem[]
}

/** 管理员更新合集模版请求 */
export interface AdminUpdateTemplateRequest {
  name?: string
  description?: string
  category?: string
  is_active?: boolean
  metrics?: MetricItem[]
}
