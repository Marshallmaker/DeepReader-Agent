import { create } from 'zustand'
import { chatService, SessionSummary } from '../services/chatService'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface ChatState {
  // ── 原有状态（ChatWidget 依赖）──────────────────────────
  sessionId: string
  reportId: number | null
  currentReportName: string | null
  isOpen: boolean
  messages: ChatMessage[]

  // ── 原有操作 ────────────────────────────────────────────
  setSessionId: (id: string) => void
  setReportId: (id: number | null, name?: string) => void
  setCurrentReportName: (name: string | null) => void
  toggleChat: () => void
  addMessage: (message: ChatMessage) => void
  clearMessages: () => void
  resetSession: () => void

  // ── 新增状态（ChatPage 专用）─────────────────────────────
  sessions: SessionSummary[]
  sessionsLoading: boolean
  historyLoading: boolean

  // ── 新增操作 ────────────────────────────────────────────
  /** 从后端加载会话列表 */
  loadSessions: () => Promise<void>
  /** 创建新会话，返回 session_id */
  createNewSession: () => Promise<string>
  /** 切换到指定会话（设置 sessionId + 加载历史消息） */
  switchSession: (sessionId: string) => Promise<void>
  /** 重命名会话 */
  renameSession: (sessionId: string, title: string) => Promise<void>
  /** 删除会话 */
  deleteSession: (sessionId: string) => Promise<void>
  /** 加载会话历史消息到 messages[] */
  loadSessionHistory: (sessionId: string) => Promise<void>
  /** 完全重置聊天状态（退出登录 / 新用户登录时调用） */
  resetAll: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  // ── 原有状态 ────────────────────────────────────────────
  sessionId: `session_${Date.now()}`,
  reportId: null,
  currentReportName: null,
  isOpen: false,
  messages: [],

  // ── 原有操作 ────────────────────────────────────────────
  setSessionId: (id) => set({ sessionId: id }),
  setReportId: (id, name) => set({ reportId: id, currentReportName: name || null }),
  setCurrentReportName: (name) => set({ currentReportName: name }),
  toggleChat: () => set((state) => ({ isOpen: !state.isOpen })),
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message]
  })),
  clearMessages: () => set({ messages: [] }),
  resetSession: () => set({
    sessionId: `session_${Date.now()}`,
    reportId: null,
    currentReportName: null,
    messages: []
  }),

  // ── 新增状态 ────────────────────────────────────────────
  sessions: [],
  sessionsLoading: false,
  historyLoading: false,

  // ── 新增操作 ────────────────────────────────────────────
  loadSessions: async () => {
    set({ sessionsLoading: true })
    try {
      const data = await chatService.listSessions()
      set({ sessions: data.sessions })
    } finally {
      set({ sessionsLoading: false })
    }
  },

  createNewSession: async () => {
    const session = await chatService.createSession()
    set((state) => ({
      sessions: [session, ...state.sessions],
      sessionId: session.session_id,
      reportId: null,
      currentReportName: null,
      messages: []
    }))
    return session.session_id
  },

  switchSession: async (sessionId: string) => {
    set({ sessionId, historyLoading: true })
    try {
      const data = await chatService.getChatHistory(sessionId)
      set({
        messages: data.messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: new Date(m.created_at)
        })),
        reportId: data.report_id,
      })
    } finally {
      set({ historyLoading: false })
    }
  },

  renameSession: async (sessionId: string, title: string) => {
    const updated = await chatService.renameSession(sessionId, title)
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.session_id === sessionId ? { ...s, title: updated.title } : s
      )
    }))
  },

  deleteSession: async (sessionId: string) => {
    await chatService.deleteSession(sessionId)
    set((state) => {
      const remaining = state.sessions.filter((s) => s.session_id !== sessionId)
      // 如果删除的是活跃会话，清空消息并生成新会话 ID
      if (state.sessionId === sessionId) {
        return {
          sessions: remaining,
          sessionId: `session_${Date.now()}`,
          reportId: null,
          currentReportName: null,
          messages: []
        }
      }
      return { sessions: remaining }
    })
  },

  loadSessionHistory: async (sessionId: string) => {
    set({ historyLoading: true })
    try {
      const data = await chatService.getChatHistory(sessionId)
      set({
        messages: data.messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: new Date(m.created_at)
        }))
      })
    } finally {
      set({ historyLoading: false })
    }
  },

  /** 完全重置聊天状态（退出登录 / 新用户登录时调用） */
  resetAll: () => set({
    sessionId: `session_${Date.now()}`,
    reportId: null,
    currentReportName: null,
    isOpen: false,
    messages: [],
    sessions: [],
    sessionsLoading: false,
    historyLoading: false,
  })
}))
