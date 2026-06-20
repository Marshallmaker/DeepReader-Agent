import { create } from 'zustand'

interface ChatState {
  sessionId: string
  reportId: number | null
  currentReportName: string | null
  isOpen: boolean
  messages: ChatMessage[]
  
  setSessionId: (id: string) => void
  setReportId: (id: number | null, name?: string) => void
  setCurrentReportName: (name: string | null) => void
  toggleChat: () => void
  addMessage: (message: ChatMessage) => void
  clearMessages: () => void
  resetSession: () => void
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: `session_${Date.now()}`,
  reportId: null,
  currentReportName: null,
  isOpen: false,
  messages: [],
  
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
  })
}))