import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider, App as AntdApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import './styles/tokens.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#007AFF',
          colorInfo: '#007AFF',
          borderRadius: 10,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif",
          fontSize: 15,
          lineHeight: 1.47059,
          colorTextBase: '#1D1D1F',
          colorBgLayout: '#F5F5F7',
          colorBorder: '#E5E5EA',
          colorSuccess: '#34C759',
          colorWarning: '#FF9500',
          colorError: '#FF3B30',
        },
        components: {
          Layout: {
            headerBg: 'rgba(251, 251, 253, 0.8)',
            headerHeight: 56,
            siderBg: '#FBFBFC',
          },
          Menu: {
            itemBg: 'transparent',
            itemSelectedBg: 'rgba(0, 122, 255, 0.08)',
            itemSelectedColor: '#007AFF',
            itemHoverBg: 'rgba(0, 122, 255, 0.04)',
            itemHoverColor: '#007AFF',
            itemActiveBg: 'rgba(0, 122, 255, 0.06)',
          },
          Button: {
            primaryShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
          },
          Table: {
            headerBg: '#FAFAFA',
            headerColor: '#6E6E73',
            rowHoverBg: 'rgba(0, 122, 255, 0.02)',
            borderColor: '#F2F2F7',
          },
          Card: {
            borderRadiusLG: 14,
          },
          Modal: {
            borderRadiusLG: 14,
          },
          Tag: {
            borderRadiusSM: 6,
          },
          Input: {
            borderRadius: 10,
            activeShadow: '0 0 0 3px rgba(0, 122, 255, 0.15)',
          },
          Select: {
            borderRadius: 10,
          },
          Breadcrumb: {
            fontSize: 13,
          },
          Tabs: {
            inkBarColor: '#007AFF',
            itemSelectedColor: '#007AFF',
            itemHoverColor: '#007AFF',
          },
        },
      }}
    >
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <AntdApp>
          <App />
        </AntdApp>
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>,
)
