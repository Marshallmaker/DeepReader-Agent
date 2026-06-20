import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import Layout from './components/Layout'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import Dashboard from './pages/Dashboard'
import Profile from './pages/Profile'
import AdminPanel from './pages/AdminPanel'
import FileList from './pages/FileList'
import './App.css'

function App() {
  const { isAuthenticated, isAdmin } = useAuthStore()

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
        <Route path="profile" element={<Profile />} />
        <Route path="files" element={<FileList />} />

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