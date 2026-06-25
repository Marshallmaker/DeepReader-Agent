import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Input, Button, Avatar, Popover, Select, Typography, Tag, App } from 'antd'
import {
  SendOutlined,
  RobotOutlined,
  UserOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ClearOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
  ReadOutlined,
  BarChartOutlined,
  FundOutlined,
  BulbOutlined,
  ExpandOutlined,
  CompressOutlined,
} from '@ant-design/icons'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import { useChatStream } from '../hooks/useChatStream'
import { batchService } from '../services/batchService'
import { chatService } from '../services/chatService'
import type { BatchResponse } from '../services/batchService'
import ChatSidebar from '../components/ChatSidebar'
import MarkdownMessage from '../components/MarkdownMessage'
import './ChatPage.css'

const { TextArea } = Input
const { Text } = Typography

/** 快捷提示词 */
const QUICK_PROMPTS = [
  { icon: <ReadOutlined />, text: '总结报告核心观点' },
  { icon: <FundOutlined />, text: '提取关键财务指标' },
  { icon: <BulbOutlined />, text: '分析主要结论与风险' },
  { icon: <BarChartOutlined />, text: '对比同行业数据' },
  { icon: <ThunderboltOutlined />, text: '分析趋势与变化' },
]

function ChatPage() {
  const { message } = App.useApp()
  const store = useChatStore()
  const { user } = useAuthStore()
  const { sendMessage, isLoading, currentAssistantMessage } = useChatStream()

  // ── 本地状态 ──────────────────────────────────────────
  const [inputValue, setInputValue] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [fullscreenOrigin, setFullscreenOrigin] = useState<{
    top: number; left: number; width: number; height: number
  } | null>(null)
  const [batches, setBatches] = useState<BatchResponse[]>([])
  const [reports, setReports] = useState<{ id: number; filename: string }[]>([])
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null)
  const [batchesLoading, setBatchesLoading] = useState(false)
  const [reportPopoverOpen, setReportPopoverOpen] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const fullscreenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── 全屏切换（从当前位置向四周延展）───────────────────
  const TRANSITION_MS = 600

  const handleToggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      // 退出全屏：全屏坐标 → 原始位置 → 回到正常流
      setIsFullscreen(false)
      fullscreenTimerRef.current = setTimeout(() => {
        setFullscreenOrigin(null)       // 清除 fixed，回到正常文档流
        document.body.style.overflow = ''
        fullscreenTimerRef.current = null
      }, TRANSITION_MS)
    } else {
      // 进入全屏：捕获当前屏幕位置 → 锁定到 fixed → 延展至全屏
      const rect = wrapperRef.current?.getBoundingClientRect()
      if (!rect) return
      document.body.style.overflow = 'hidden'
      setFullscreenOrigin({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      })
      // 下一帧触发全屏目标坐标，CSS transition 处理四方向延展动画
      requestAnimationFrame(() => {
        setIsFullscreen(true)
      })
    }
  }, [isFullscreen])

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (fullscreenTimerRef.current) clearTimeout(fullscreenTimerRef.current)
      document.body.style.overflow = ''
    }
  }, [])

  // ── ESC 退出全屏 ──────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        handleToggleFullscreen()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFullscreen, handleToggleFullscreen])

  // ── 计算 wrapper 动态样式（实现四方向延展）──────────────
  const wrapperStyle = useMemo(() => {
    if (!fullscreenOrigin) return undefined
    if (isFullscreen) {
      // 全屏状态：铺满整个视口
      return {
        position: 'fixed' as const,
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        margin: 0,
        borderRadius: 0,
        border: 'none',
        boxShadow: 'none',
      }
    }
    // 过渡中（退出全屏）：回到原始位置
    return {
      position: 'fixed' as const,
      top: fullscreenOrigin.top,
      left: fullscreenOrigin.left,
      width: fullscreenOrigin.width,
      height: fullscreenOrigin.height,
      margin: 0,
    }
  }, [fullscreenOrigin, isFullscreen])

  // ── 初始化：加载会话列表和批次 ────────────────────────
  useEffect(() => {
    store.loadSessions().then(() => {
      const { sessions } = useChatStore.getState()
      if (sessions.length > 0) {
        store.switchSession(sessions[0].session_id)
      }
    })

    // 加载批次列表（报告绑定用）
    const loadBatches = async () => {
      setBatchesLoading(true)
      try {
        const data = await batchService.getBatches(1, 100)
        setBatches(data.items.filter((b) => b.status === 'completed' || b.status === 'partial'))
      } catch {
        // 静默失败
      } finally {
        setBatchesLoading(false)
      }
    }
    loadBatches()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 自动滚动到底部 ────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [store.messages, currentAssistantMessage])

  // ── 计算显示的标题 ────────────────────────────────────
  const currentSession = store.sessions.find((s) => s.session_id === store.sessionId)
  const displayTitle = currentSession?.title || '新对话'

  // ── 合并流式消息到展示列表 ────────────────────────────
  const allMessages = [...store.messages]
  if (currentAssistantMessage) {
    allMessages.push({
      role: 'assistant' as const,
      content: currentAssistantMessage,
      timestamp: new Date(),
    })
  }

  // ── 事件处理 ──────────────────────────────────────────

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim()
    if (!trimmed || isLoading) return
    setInputValue('')
    sendMessage(trimmed)
  }, [inputValue, isLoading, sendMessage])

  const handleNewSession = useCallback(async () => {
    try {
      await store.createNewSession()
    } catch {
      message.error('创建新对话失败')
    }
  }, [store, message])

  const handleSwitchSession = useCallback(async (sessionId: string) => {
    try {
      await store.switchSession(sessionId)
    } catch {
      message.error('加载对话失败')
    }
  }, [store, message])

  const handleClearMessages = useCallback(async () => {
    const currentId = store.sessionId
    if (!currentId) return
    try {
      await chatService.clearSessionMessages(currentId)
      store.clearMessages()
      message.success('对话已清空')
    } catch {
      message.error('清空对话失败')
    }
  }, [store, message])

  const handleBindReport = async (reportId: number, filename: string) => {
    store.setReportId(reportId, filename)
    setReportPopoverOpen(false)
    message.success(`已绑定报告: ${filename}`)
  }

  const handleUnbindReport = () => {
    store.setReportId(null)
    message.info('已取消报告绑定')
  }

  const handleBatchChange = async (batchId: number) => {
    setSelectedBatchId(batchId)
    try {
      const data = await batchService.getBatchDetail(batchId)
      setReports(data.reports?.map((r: { id: number; original_filename: string }) => ({
        id: r.id,
        filename: r.original_filename,
      })) || [])
    } catch {
      message.error('加载报告列表失败')
    }
  }

  // ── 报告绑定 Popover 内容 ─────────────────────────────
  const reportPopoverContent = (
    <div className="report-popover">
      <div className="report-popover-title">选择报告绑定</div>
      <Select
        placeholder="先选择批次..."
        loading={batchesLoading}
        value={selectedBatchId}
        onChange={handleBatchChange}
        style={{ width: '100%', marginBottom: 12 }}
        options={batches.map((b) => ({
          value: b.batch_id,
          label: b.batch_name || `批次 #${b.batch_id}`,
        }))}
        allowClear
      />
      {selectedBatchId && (
        <div className="report-list-popover">
          {reports.length === 0 ? (
            <Text type="secondary">该批次暂无报告</Text>
          ) : (
            reports.map((r) => (
              <div
                key={r.id}
                className={`report-item-popover${store.reportId === r.id ? ' active' : ''}`}
                onClick={() => handleBindReport(r.id, r.filename)}
              >
                <FileTextOutlined style={{ marginRight: 8 }} />
                <span>{r.filename}</span>
              </div>
            ))
          )}
        </div>
      )}
      {store.reportId && (
        <Button
          type="link"
          danger
          size="small"
          onClick={handleUnbindReport}
          style={{ padding: 0, marginTop: 8 }}
        >
          取消绑定
        </Button>
      )}
    </div>
  )

  return (
    <div
      ref={wrapperRef}
      className={`chat-page-wrapper${isFullscreen ? ' fullscreen' : ''}${fullscreenOrigin ? ' fs-overlay' : ''}`}
      style={wrapperStyle}
    >
      {/* 左侧历史栏 */}
      <ChatSidebar
        sessions={store.sessions}
        activeSessionId={store.sessionId}
        collapsed={sidebarCollapsed}
        loading={store.sessionsLoading}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onNewSession={handleNewSession}
        onSwitchSession={handleSwitchSession}
        onRenameSession={store.renameSession}
        onDeleteSession={store.deleteSession}
      />

      {/* 右侧对话区域 */}
      <div className="chat-main">
        {/* 顶栏 */}
        <div className="chat-top-bar">
          <div className="chat-top-left">
            <Button
              type="text"
              icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="sidebar-toggle-btn"
            />
            <span className="chat-session-title">{displayTitle}</span>
          </div>
          <div className="chat-top-right">
            {/* 报告绑定 */}
            <Popover
              content={reportPopoverContent}
              trigger="click"
              open={reportPopoverOpen}
              onOpenChange={setReportPopoverOpen}
              placement="bottomRight"
              zIndex={1060}
            >
              <Tag
                color={store.reportId ? 'blue' : 'default'}
                className="report-bind-tag"
                style={{ cursor: 'pointer' }}
              >
                {store.reportId ? (
                  <>
                    <FileTextOutlined style={{ marginRight: 4 }} />
                    {store.currentReportName || `报告 #${store.reportId}`}
                  </>
                ) : (
                  '通用模式'
                )}
              </Tag>
            </Popover>
            {/* 清空按钮 */}
            {store.messages.length > 0 && (
              <Button
                type="text"
                icon={<ClearOutlined />}
                onClick={handleClearMessages}
                title="清空对话"
              />
            )}
            {/* 全屏切换按钮 */}
            <Button
              type="text"
              icon={isFullscreen ? <CompressOutlined /> : <ExpandOutlined />}
              onClick={handleToggleFullscreen}
              title={isFullscreen ? '退出全屏' : '全屏显示'}
            />
          </div>
        </div>

        {/* 消息区 */}
        <div className="chat-messages-area">
          {store.historyLoading ? (
            <div className="chat-loading-state">
              <RobotOutlined className="chat-loading-icon" />
              <span>加载对话历史...</span>
            </div>
          ) : allMessages.length === 0 ? (
            /* 空状态欢迎页 */
            <div className="chat-welcome">
              <div className="chat-welcome-avatar">
                <RobotOutlined />
              </div>
              <h2>有什么可以帮助你的？</h2>
              <p className="chat-welcome-sub">
                我是 DeepReader AI 助手，可以分析研报、提取指标、回答问题
              </p>
              <div className="quick-prompts">
                {QUICK_PROMPTS.map((p) => (
                  <div
                    key={p.text}
                    className="quick-prompt-item"
                    onClick={() => {
                      setInputValue(p.text)
                    }}
                  >
                    <span className="quick-prompt-icon">{p.icon}</span>
                    <span>{p.text}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* 消息列表 */
            <div className="chat-message-list">
              {allMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`message-row${msg.role === 'user' ? ' user-row' : ' assistant-row'}`}
                >
                  {msg.role === 'assistant' && (
                    <Avatar
                      size={32}
                      icon={<RobotOutlined />}
                      className="message-avatar"
                      style={{ backgroundColor: '#007AFF' }}
                    />
                  )}
                  <div className={`message-bubble${msg.role === 'user' ? ' user-bubble' : ' assistant-bubble'}`}>
                    {msg.role === 'assistant' ? (
                      <MarkdownMessage content={msg.content} />
                    ) : (
                      <div className="user-message-text">{msg.content}</div>
                    )}
                  </div>
                  {msg.role === 'user' && (
                    <Avatar
                      size={32}
                      icon={<UserOutlined />}
                      src={user?.avatarUrl || undefined}
                      className="message-avatar"
                    />
                  )}
                </div>
              ))}
              {/* 加载中指示器 */}
              {isLoading && !currentAssistantMessage && (
                <div className="message-row assistant-row">
                  <Avatar
                    size={32}
                    icon={<RobotOutlined />}
                    className="message-avatar"
                    style={{ backgroundColor: '#007AFF' }}
                  />
                  <div className="message-bubble assistant-bubble thinking-bubble">
                    <span className="thinking-text">AI 正在思考...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="chat-input-area">
          <div className="chat-input-wrapper">
            <TextArea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={
                store.reportId
                  ? '针对绑定的报告提问...'
                  : '输入消息...'
              }
              autoSize={{ minRows: 1, maxRows: 6 }}
              disabled={isLoading}
              className="chat-input-textarea"
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSend}
              loading={isLoading}
              disabled={!inputValue.trim()}
              className="send-btn"
            />
          </div>
          <div className="chat-input-hint">
            按 Enter 发送，Shift + Enter 换行
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChatPage
