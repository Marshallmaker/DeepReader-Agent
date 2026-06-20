/**
 * useDataReducer — 智能数据降载 Hook
 *
 * 为图表组件提供 Top-N 截断、时间聚合、异常优先排序、分页能力。
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
  anomalyFirst: boolean
  setAnomalyFirst: (b: boolean) => void
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
    const groups = new Map<string, { sum: number; count: number }>()
    s.data.forEach(d => {
      const key = truncateDate(d.fiscal_year || '', granularity)
      const g = groups.get(key) ?? { sum: 0, count: 0 }
      groups.set(key, g)
      g.sum += d.value ?? 0
      g.count += 1
    })
    return {
      ...s,
      data: Array.from(groups.entries()).map(([key, g]) => ({
        fiscal_year: key,
        value: g.sum / g.count,
      })),
    }
  })
}

function truncateDate(date: string, granularity: 'day' | 'month' | 'quarter'): string {
  if (!date) return ''
  if (granularity === 'day') return date.slice(0, 10)
  if (granularity === 'month') return date.slice(0, 7)
  // quarter
  const month = parseInt(date.slice(5, 7), 10)
  const q = Math.ceil(month / 3)
  return `${date.slice(0, 4)}-Q${q}`
}

function anomalyFirst(data: SeriesData[]): SeriesData[] {
  return data.map(s => ({
    ...s,
    data: [...s.data].sort((a, b) => (b.is_anomaly ? 1 : 0) - (a.is_anomaly ? 1 : 0)),
  }))
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
  const [anomalyFirstEnabled, setAnomalyFirstEnabled] = useState(true)
  const [page, setPage] = useState(1)
  const pageSize = strategy.pageSize || 0

  const reducedData = useMemo(() => {
    let result = [...rawData]
    if (anomalyFirstEnabled) result = anomalyFirst(result)
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
  }, [rawData, topN, granularity, anomalyFirstEnabled, page, pageSize])

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
    anomalyFirst: anomalyFirstEnabled, setAnomalyFirst: setAnomalyFirstEnabled,
    page, setPage,
    totalPages,
  }

  return { reducedData, controls, stats }
}
