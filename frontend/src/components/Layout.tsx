import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useMemo } from 'react'
import { Layout as AntLayout, Menu, Button, Dropdown, Avatar, Breadcrumb, message } from 'antd'
import {
  DashboardOutlined,
  HistoryOutlined,
  SettingOutlined,
  UserOutlined,
  LogoutOutlined,
  MessageOutlined,
  HomeOutlined,
  FileTextOutlined,
} from '@ant-design/icons'

import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'
import { authService } from '../services/authService'
import ChatWidget from '../components/ChatWidget'
import './Layout.css'

const { Header, Content, Sider } = AntLayout

/** 路由 → 面包屑名称映射 */
const ROUTE_NAMES: Record<string, string> = {
  '/dashboard': '工作台',
  '/admin': '管理员面板',
  '/files': '全部文件',
}

function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, isAdmin, clearAuth, accessToken, updateToken } = useAuthStore()
  const { toggleChat } = useChatStore()

  // Auto refresh token and fetch user info when authenticated
  useEffect(() => {
    const refreshTokenIfNeeded = async () => {
      if (!accessToken && user) {
        try {
          const response = await authService.refreshToken()
          updateToken(response.access_token)
        } catch {
          message.error('登录状态已过期，请重新登录')
          clearAuth()
          navigate('/login')
        }
      }

      // 获取完整用户信息
      if (accessToken && user && user.id === 0) {
        try {
          const userInfo = await authService.getCurrentUser()
          useAuthStore.getState().setAuth(accessToken, {
            id: userInfo.id,
            email: userInfo.email,
            nickname: userInfo.nickname,
            isAdmin: userInfo.is_admin,
            avatarUrl: userInfo.avatar_url,
          })
        } catch {
          console.error('获取用户信息失败')
        }
      }
    }

    refreshTokenIfNeeded()
  }, [accessToken, user, updateToken, clearAuth, navigate])

  const handleLogout = () => {
    clearAuth()
    navigate('/login')
  }

  // 当前选中菜单
  const selectedKey = useMemo(() => {
    if (location.pathname.startsWith('/admin')) return 'admin'
    if (location.pathname.startsWith('/files')) return 'files'
    return 'dashboard'
  }, [location.pathname])

  // 面包屑
  const breadcrumbItems = useMemo(() => {
    const items = [{ title: <><HomeOutlined /> 首页</> }]
    const name = ROUTE_NAMES[location.pathname]
    if (name) {
      items.push({ title: <span>{name}</span> })
    }
    return items
  }, [location.pathname])

  const menuItems = [
    {
      key: 'dashboard',
      icon: <DashboardOutlined />,
      label: '工作台',
      onClick: () => navigate('/dashboard'),
    },
    {
      key: 'history',
      icon: <HistoryOutlined />,
      label: '历史批次',
      onClick: () => navigate('/dashboard'),
    },
    {
      key: 'files',
      icon: <FileTextOutlined />,
      label: '全部文件',
      onClick: () => navigate('/files'),
    },
  ]

  if (isAdmin) {
    menuItems.push({
      key: 'admin',
      icon: <SettingOutlined />,
      label: '管理员面板',
      onClick: () => navigate('/admin'),
    })
  }

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人中心',
      onClick: () => navigate('/profile'),
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ]

  return (
    <AntLayout className="layout">
      <Header className="layout-header">
        <div className="header-left">
          <div className="logo">
            <DashboardOutlined />
            <span className="logo-text">DeepReader Agent</span>
          </div>
        </div>
        <div className="header-right">
          <Button
            type="text"
            icon={<MessageOutlined />}
            onClick={toggleChat}
            className="chat-btn"
          >
            AI助手
          </Button>
          <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
            <div className="user-dropdown-trigger">
              <Avatar
                size="small"
                icon={<UserOutlined />}
                src={user?.avatarUrl || undefined}
                style={{ backgroundColor: '#007AFF' }}
              />
              <span className="user-name">
                {user?.nickname || user?.email || '用户'}
              </span>
            </div>
          </Dropdown>
        </div>
      </Header>
      <AntLayout>
        <Sider
          width={220}
          breakpoint="lg"
          collapsible
          collapsedWidth={64}
          trigger={null}
          className="layout-sider"
        >
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            items={menuItems}
            className="layout-menu"
          />
        </Sider>
        <Content className="layout-content">
          <div className="page-container">
            <Breadcrumb items={breadcrumbItems} className="page-breadcrumb" />
            <Outlet />
          </div>
        </Content>
      </AntLayout>
      <ChatWidget />
    </AntLayout>
  )
}

export default Layout
