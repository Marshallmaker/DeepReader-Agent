/**
 * 统一错误信息提取工具。
 * 兼容项目自定义格式 { code, message, details }、
 * FastAPI 默认格式 { detail: string }、
 * Pydantic 验证错误 { detail: [{ msg, loc, type }] }。
 */

interface ApiErrorResponse {
  code?: string
  message?: string
  details?: unknown
  detail?: string | Array<{ msg: string; loc: string[]; type: string }>
}

export function extractErrorMessage(error: unknown, fallback = '操作失败'): string {
  if (!(error instanceof Error)) return fallback

  const axiosError = error as { response?: { data?: ApiErrorResponse } }
  const data = axiosError.response?.data

  if (data) {
    // 项目统一格式: { code, message, details }
    if (typeof data.message === 'string') {
      // 500 服务器内部错误：拼接 details 字段以便定位根因
      const details = typeof data.details === 'string' ? data.details : ''
      return details ? `${data.message}（${details}）` : data.message
    }
    // FastAPI 默认格式: { detail: string }
    if (typeof data.detail === 'string') return data.detail
    // Pydantic 验证错误: { detail: [{ msg, loc, type }] }
    if (Array.isArray(data.detail)) {
      return data.detail.map((item) => item.msg).join('; ')
    }
  }

  return error.message || fallback
}
