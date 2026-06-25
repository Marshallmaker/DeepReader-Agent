import api from './api'
import { useAuthStore } from '../stores/authStore'

export interface ChatRequest {
  report_id: number | null
  session_id: string
  prompt: string
}

/** 会话摘要（对应后端 SessionSummaryResponse） */
export interface SessionSummary {
  session_id: string
  title: string | null
  report_id: number | null
  first_message: string | null
  message_count: number
  created_at: string
  updated_at: string | null
}

/** 会话列表响应 */
export interface SessionListResponse {
  sessions: SessionSummary[]
  total: number
}

/** 聊天历史消息 */
export interface ChatHistoryMessage {
  id: number
  session_id: string
  role: string
  content: string
  created_at: string
}

/** 聊天历史响应 */
export interface ChatHistoryResponse {
  session_id: string
  report_id: number | null
  messages: ChatHistoryMessage[]
}

export const chatService = {
  /** SSE 流式聊天（使用原生 fetch 读取 ReadableStream） */
  async streamChat(request: ChatRequest): Promise<Response> {
    const token = useAuthStore.getState().accessToken
    const response = await fetch('/api/v1/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(request)
    })

    return response
  },

  /** 获取指定会话的聊天历史 */
  async getChatHistory(sessionId: string): Promise<ChatHistoryResponse> {
    const response = await api.get(`/chat/history/${sessionId}`)
    return response.data
  },

  /** 列出当前用户的所有会话 */
  async listSessions(): Promise<SessionListResponse> {
    const response = await api.get('/chat/sessions')
    return response.data
  },

  /** 创建新会话 */
  async createSession(reportId?: number): Promise<SessionSummary> {
    const response = await api.post('/chat/sessions', { report_id: reportId || null })
    return response.data
  },

  /** 重命名会话 */
  async renameSession(sessionId: string, title: string): Promise<SessionSummary> {
    const response = await api.patch(`/chat/sessions/${sessionId}`, { title })
    return response.data
  },

  /** 删除会话 */
  async deleteSession(sessionId: string): Promise<void> {
    await api.delete(`/chat/sessions/${sessionId}`)
  },

  /** 清空会话中的全部消息（保留会话标题） */
  async clearSessionMessages(sessionId: string): Promise<void> {
    await api.delete(`/chat/sessions/${sessionId}/messages`)
  }
}