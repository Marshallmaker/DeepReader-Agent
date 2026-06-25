/**
 * useDataReducer — 智能数据降载 Hook
 *
 * 为图表组件提供 Top-N 截断、时间聚合、分页能力。
 *
 * @param rawData  原始 SeriesData 数组
 * @param strategy 降载策略（defaultTopN, pageSize, aggregateGranularity）
 * @returns { reducedData, controls, stats }
 */

import { useState, useMemo } from 'react'
import type { SeriesData, ReductionStrategy } from '../components/charts/ChartRegistry'

// ── 公开类型 ───────────────────────────────────────────────

export interface ReductionControls {
  topN: number
  setTopN: (n: number) => void
  granularity: 'day' | 'month' | 'quarter' | null
  setGranularity: (g: 'day' | 'month' | 'quarter' | null) => void
  page: number
  setPage: (p: number) => void
  totalPages: number
}

export interface ReductionStats {
  total: number
  shown: number
  hidden: number
  hasReduction: boolean
}

// ── 内部工具函数 ───────────────────────────────────────────

function applyTopN(data: SeriesData[], n: number): SeriesData[] {
  return data.map(s => ({
    ...s,
    data: s.data.slice(0, n),
  }))
}

function aggregateByGranularity(data: SeriesData[], granularity: 'day' | 'month' | 'quarter'): SeriesData[] {
  return data.map(s => {
    const groups = new Map<string, {
      sum: number
      count: number
      hasAnomaly: boolean
      // 保留聚合组中偏离度最大的异常数据点的详情
      anomalyDirection?: string
      anomalyDeviation?: number
      anomalyMethod?: string
      anomalyThreshold?: number
      maxDeviation: number
      unit?: string
      // 保留实体元数据（取组内第一个非空值）
      report_name?: string
      entity_name?: string
      report_id?: number
    }>()
    s.data.forEach(d => {
      // 按 (时间段 + 报告) 分组，避免不同报告的同一时间段数据被错误合并
      const entityKey = d.entity_name || d.report_name || ''
      const dateKey = truncateDate(d.fiscal_year || '', granularity)
      const key = entityKey ? `${dateKey}|${entityKey}` : dateKey
      const g = groups.get(key) ?? { sum: 0, count: 0, hasAnomaly: false, maxDeviation: -1 }
      groups.set(key, g)
      g.sum += d.value ?? 0
      g.count += 1
      // 保留第一个非空 entity 元数据
      if (!g.report_name && d.report_name) g.report_name = d.report_name
      if (!g.entity_name && d.entity_name) g.entity_name = d.entity_name
      if (!g.report_id && d.report_id) g.report_id = d.report_id
      if (d.is_anomaly) {
        g.hasAnomaly = true
        const dev = d.anomaly_deviation ?? 0
        if (dev > g.maxDeviation) {
          g.maxDeviation = dev
          g.anomalyDirection = d.anomaly_direction
          g.anomalyDeviation = d.anomaly_deviation
          g.anomalyMethod = d.anomaly_method
          g.anomalyThreshold = d.anomaly_threshold
        }
      }
      if (d.unit && !g.unit) g.unit = d.unit
    })
    return {
      ...s,
      data: Array.from(groups.entries()).map(([key, g]) => ({
        fiscal_year: key.includes('|') ? key.split('|')[0] : key,
        value: g.sum / g.count,
        report_name: g.report_name,
        entity_name: g.entity_name,
        report_id: g.report_id,
        is_anomaly: g.hasAnomaly || undefined,
        anomaly_direction: g.anomalyDirection,
        anomaly_deviation: g.anomalyDeviation,
        anomaly_method: g.anomalyMethod,
        anomaly_threshold: g.anomalyThreshold,
        unit: g.unit,
      })),
    }
  })
}

function truncateDate(date: string, granularity: 'day' | 'month' | 'quarter'): string {
  if (!date) return ''
  if (granularity === 'day') return date.slice(0, 10)
  if (granularity === 'month') return date.slice(0, 7)
  // quarter
  if (date.length < 7) return date  // 无法判断季度，原样返回
  const month = parseInt(date.slice(5, 7), 10)
  const q = Math.ceil(month / 3)
  return `${date.slice(0, 4)}-Q${q}`
}

// ── Hook ──────────────────────────────────────────────────

export function useDataReducer(
  rawData: SeriesData[],
  strategy: ReductionStrategy,
) {
  const [topN, setTopN] = useState(strategy.defaultTopN)
  const [granularity, setGranularity] = useState<'day' | 'month' | 'quarter' | null>(
    (strategy.aggregateGranularity as 'day' | 'month' | 'quarter' | null) || null
  )
  const [page, setPage] = useState(1)
  const pageSize = strategy.pageSize || 0

  const reducedData = useMemo(() => {
    let result = [...rawData]
    if (granularity) result = aggregateByGranularity(result, granularity)
    if (topN > 0) result = applyTopN(result, topN)
    if (pageSize > 0) {
      const start = (page - 1) * pageSize
      result = result.map(s => ({
        ...s,
        data: s.data.slice(start, start + pageSize),
      }))
    }
    return result
  }, [rawData, topN, granularity, page, pageSize])

  const totalItems = rawData.reduce((s, x) => s + x.data.length, 0)
  const shownItems = reducedData.reduce((s, x) => s + x.data.length, 0)
  const totalPages = pageSize > 0 ? Math.ceil((topN > 0 ? Math.min(totalItems, topN) : totalItems) / pageSize) : 1

  const stats: ReductionStats = {
    total: totalItems,
    shown: shownItems,
    hidden: totalItems - shownItems,
    hasReduction: totalItems > shownItems,
  }

  const controls: ReductionControls = {
    topN, setTopN,
    granularity, setGranularity,
    page, setPage,
    totalPages,
  }

  return { reducedData, controls, stats }
}
