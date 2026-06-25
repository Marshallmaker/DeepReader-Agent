import api from './api'

// ── 多系列数据类型 ────────────────────────────────────────

export interface MultiSeriesDataPoint {
  fiscal_year: string
  entity_name?: string
  report_name?: string
  report_id?: number
  batch_id?: number
  value: number | null
  unit?: string
  is_anomaly?: boolean
  anomaly_deviation?: number
  anomaly_direction?: string
  anomaly_method?: string
  anomaly_threshold?: number
}

export interface SeriesData {
  metric_key: string
  metric_label: string
  data: MultiSeriesDataPoint[]
}

export interface MultiSeriesTrendResponse {
  status: string
  chart_type: string
  batch_ids: number[]
  series: SeriesData[]
}

export interface MultiSeriesComparisonResponse {
  status: string
  chart_type: string
  batch_ids: number[]
  series: SeriesData[]
}

export interface CompatibleCheckResponse {
  compatible: boolean
  common_metrics: { metric_key: string; metric_label: string; expected_type: string }[]
  incompatible_batches: number[]
}

// ── 服务方法 ──────────────────────────────────────────────

export const visualizationService = {
  /** 多批次、多指标折线图趋势数据 */
  async getTrendData(batchIds: number[], metricKeys: string[]): Promise<MultiSeriesTrendResponse> {
    const response = await api.get('/visualization/trend', {
      params: { batch_ids: batchIds, metric_keys: metricKeys },
      paramsSerializer: { indexes: null },
    })
    return response.data
  },

  /** 多批次、多指标柱状图对比数据 */
  async getComparisonData(batchIds: number[], metricKeys: string[]): Promise<MultiSeriesComparisonResponse> {
    const response = await api.get('/visualization/comparison', {
      params: { batch_ids: batchIds, metric_keys: metricKeys },
      paramsSerializer: { indexes: null },
    })
    return response.data
  },

  /** 校验批次指标兼容性 */
  async checkCompatibility(batchIds: number[]): Promise<CompatibleCheckResponse> {
    const response = await api.get('/batches/compatible', {
      params: { batch_ids: batchIds },
      paramsSerializer: { indexes: null },
    })
    return response.data
  },
}
