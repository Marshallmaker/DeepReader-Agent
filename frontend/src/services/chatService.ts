import api from './api'
import { useAuthStore } from '../stores/authStore'

export interface ChatRequest {
  report_id: number | null
  session_id: string
  prompt: string
}

export const chatService = {
  // 使用 fetch + POST 实现 SSE 流式请求（已废弃 EventSource，因为不支持 POST/自定义 Header）
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

  async getChatHistory(sessionId: string) {
    const response = await api.get(`/chat/history/${sessionId}`)
    return response.data
  }
}