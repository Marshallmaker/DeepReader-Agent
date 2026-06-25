import { useEffect, useState, useRef } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import api from './services/api'
import Layout from './components/Layout'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import Dashboard from './pages/Dashboard'
import Profile from './pages/Profile'
import AdminPanel from './pages/AdminPanel'
import FileList from './pages/FileList'
import Analytics from './pages/Analytics'
import Metrics from './pages/Metrics'
import ChatPage from './pages/ChatPage'
import './App.css'

function App() {
  const { isAuthenticated, isAdmin, accessToken } = useAuthStore()
  const [initializing, setInitializing] = useState(true)
  const refreshAttempted = useRef(false)

  // 应用启动时检测"有身份无令牌"的假登录状态，主动恢复令牌
  // 背景：accessToken 仅存内存（安全考量），浏览器重启后丢失；
  // 但 isAuthenticated 持久化在 localStorage，导致路由守卫放行但 API 无令牌可用。
  useEffect(() => {
    // 情况一：未认证 → 正常显示登录页
    if (!isAuthenticated) {
      setInitializing(false)
      return
    }

    // 情况二：已认证且有令牌 → 正常进入应用
    if (accessToken) {
      setInitializing(false)
      return
    }

    // 情况三：已认证但无令牌（假登录）→ 尝试用 httpOnly Cookie 中的 refresh_token 恢复
    if (refreshAttempted.current) return
    refreshAttempted.current = true

    api.post('/auth/refresh', {})
      .then(async (res) => {
        const newToken = res.data.access_token
        useAuthStore.getState().updateToken(newToken)
        // 同时刷新用户完整信息，确保 isAdmin 与服务端一致
        // 此举修复：localStorage 中 isAdmin 陈旧时路由守卫误放行导致 403
        try {
          const meRes = await api.get('/auth/me')
          const u = meRes.data
          useAuthStore.getState().setAuth(newToken, {
            id: u.id,
            email: u.email,
            nickname: u.nickname,
            isAdmin: u.is_admin,
            avatarUrl: u.avatar_url,
          })
        } catch {
          // /auth/me 失败时保留 updateToken 已写入的信息，Layout 中的 useEffect 会兜底重试
          console.warn('会话恢复后获取用户信息失败，将在后续自动重试')
        }
      })
      .catch(() => {
        // refresh_token Cookie 已过期或不存在（remember_me=false 且浏览器已重启）
        // → 清空认证状态，让用户重新登录
        useAuthStore.getState().clearAuth()
      })
      .finally(() => {
        setInitializing(false)
      })
  }, [isAuthenticated, accessToken])

  // 正在尝试恢复令牌时显示加载动画，避免闪烁登录页
  if (initializing && isAuthenticated) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#f5f5f5',
      }}>
        <div style={{ textAlign: 'center', color: '#888', fontSize: 15 }}>
          <div style={{
            width: 32, height: 32, border: '3px solid #e0e0e0',
            borderTopColor: '#1677ff', borderRadius: '50%',
            animation: 'app-spin 0.8s linear infinite', margin: '0 auto 12px',
          }} />
          <span>正在恢复会话…</span>
          <style>{`@keyframes app-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    )
  }

  return (
    <Routes>
      {/* 公开路由（无需登录） */}
      <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to="/dashboard" />} />
      <Route path="/register" element={!isAuthenticated ? <Login /> : <Navigate to="/dashboard" />} />
      <Route path="/forgot-password" element={!isAuthenticated ? <ForgotPassword /> : <Navigate to="/dashboard" />} />
      
      {/* 受保护路由（需要登录） */}
      <Route path="/" element={isAuthenticated ? <Layout /> : <Navigate to="/login" />}>
        <Route index element={<Navigate to="/dashboard" />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="metrics" element={<Metrics />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="files" element={<FileList />} />
        <Route path="profile" element={<Profile />} />

        {/* 管理员路由（需要管理员权限） */}
        <Route 
          path="admin" 
          element={isAdmin ? <AdminPanel /> : <Navigate to="/dashboard" />} 
        />
      </Route>
      
      {/* 捕获所有未匹配路由 */}
      <Route path="*" element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} />} />
    </Routes>
  )
}

export default App