import { useState, useRef, useCallback } from 'react'
import { message } from 'antd'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'

const SSE_READ_TIMEOUT_MS = 120_000

interface UseChatStreamReturn {
  /** 发送消息（传入文本或取 inputValue） */
  sendMessage: (text: string) => Promise<void>
  /** 是否正在等待 AI 回复 */
  isLoading: boolean
  /** 当前流式累积中的 AI 回复片段 */
  currentAssistantMessage: string
  /** 取消当前请求 */
  abort: () => void
}

/**
 * SSE 流式聊天 Hook
 * 从 ChatWidget 提取，供 ChatWidget 和 ChatPage 共用。
 *
 * 使用 requestAnimationFrame 批量更新 React 状态：
 * 多个 SSE chunk 合并到一个 ~16ms 的渲染帧中，避免高频渲染阻塞主线程。
 */
export function useChatStream(): UseChatStreamReturn {
  const { sessionId, reportId, addMessage } = useChatStore()
  const { accessToken, clearAuth } = useAuthStore()
  const [isLoading, setIsLoading] = useState(false)
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState('')
  const abortControllerRef = useRef<AbortController | null>(null)
  const currentMessageRef = useRef('')        // 实时累积全部消息（避免闭包过期）
  const rafIdRef = useRef<number | null>(null) // rAF 批量更新句柄

  const abort = useCallback(() => {
    abortControllerRef.current?.abort()
  }, [])

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isLoading) return

    // 取消尚未执行的 rAF
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }

    setCurrentAssistantMessage('')
    currentMessageRef.current = ''

    addMessage({ role: 'user', content: trimmed, timestamp: new Date() })
    setIsLoading(true)

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const response = await fetch('/api/v1/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          report_id: reportId,
          session_id: sessionId,
          prompt: trimmed,
        }),
        signal: controller.signal,
      })

      if (response.status === 401) {
        try {
          const refreshResp = await fetch('/api/v1/auth/refresh', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
          })
          if (refreshResp.ok) {
            const { access_token } = await refreshResp.json()
            if (access_token) {
              useAuthStore.getState().updateToken(access_token)
              message.info('Token 已刷新，请重新发送消息')
            }
          } else {
            throw new Error('刷新失败')
          }
        } catch {
          clearAuth()
          window.location.href = '/login'
          return
        }
        setIsLoading(false)
        return
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: '请求失败' }))
        throw new Error(errorData.message || errorData.detail || '请求失败')
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (reader) {
        let lastChunkTime = Date.now()
        let completedContent = ''

        while (true) {
          if (Date.now() - lastChunkTime > SSE_READ_TIMEOUT_MS) {
            controller.abort()
            throw new Error('AI 响应超时，请重试')
          }
          const { done, value } = await reader.read()
          if (done) break
          lastChunkTime = Date.now()
          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') {
                completedContent = currentMessageRef.current
                break
              }
              try {
                const parsed = JSON.parse(data)
                if (parsed.content) {
                  currentMessageRef.current += parsed.content

                  // 使用 rAF 批量更新：多个 SSE chunk 合并为一次渲染
                  if (rafIdRef.current === null) {
                    rafIdRef.current = requestAnimationFrame(() => {
                      setCurrentAssistantMessage(currentMessageRef.current)
                      rafIdRef.current = null
                    })
                  }
                }
              } catch { /* skip non-JSON lines */ }
            }
          }

          if (completedContent) break
        }

        // 确保最后一次渲染（可能有残留的 pending 内容）
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current)
          rafIdRef.current = null
        }

        // 提交完整消息到 store
        if (completedContent) {
          addMessage({ role: 'assistant', content: completedContent, timestamp: new Date() })
        }
        setCurrentAssistantMessage('')
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        /* timeout or abort — 静默处理 */
      } else if (error instanceof Error) {
        message.error(error.message || '发送消息失败')
      }
      setCurrentAssistantMessage('')
      // 清理残留 rAF
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }, [accessToken, reportId, sessionId, isLoading, addMessage, clearAuth])

  return { sendMessage, isLoading, currentAssistantMessage, abort }
}
