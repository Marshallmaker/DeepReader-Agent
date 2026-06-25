import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useChatStore } from './chatStore'

interface User {
  id: number
  email: string
  nickname: string | null
  isAdmin: boolean
  avatarUrl?: string | null
}

interface AuthState {
  accessToken: string | null
  user: User | null
  isAuthenticated: boolean
  isAdmin: boolean
  
  setAuth: (token: string, user: User) => void
  clearAuth: () => void
  updateToken: (token: string) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isAdmin: false,
      
      setAuth: (token, user) => {
        // 新用户登录时重置聊天 Store，防止旧用户数据残留
        useChatStore.getState().resetAll()
        set({
          accessToken: token,
          user: user,
          isAuthenticated: true,
          isAdmin: user.isAdmin
        })
      },

      clearAuth: () => {
        // 退出登录时清除聊天数据
        useChatStore.getState().resetAll()
        set({
          accessToken: null,
          user: null,
          isAuthenticated: false,
          isAdmin: false
        })
      },
      
      updateToken: (token) => set({
        accessToken: token
      })
    }),
    {
      name: 'auth-storage',
      // Only persist user info, not token (token in memory for security)
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        isAdmin: state.isAdmin
      })
    }
  )
)