import { useState, useEffect, useRef } from 'react'
import { Card, Input, Button, List, Avatar, Spin, message, Tooltip } from 'antd'
import {
  MessageOutlined, CloseOutlined, SendOutlined, RobotOutlined,
  UserOutlined, DeleteOutlined, FileTextOutlined,
} from '@ant-design/icons'
import { useChatStore } from '../stores/chatStore'
import { useChatStream } from '../hooks/useChatStream'
import './ChatWidget.css'

/** 快捷提问建议 */
const QUICK_PROMPTS = [
  '总结这份报告的核心内容',
  '提取关键财务指标',
  '这份报告的主要结论是什么？',
]

function ChatWidget() {
  const {
    isOpen, reportId, messages, toggleChat,
    clearMessages, setReportId, currentReportName,
  } = useChatStore()
  const { sendMessage, isLoading, currentAssistantMessage } = useChatStream()
  const [inputValue, setInputValue] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentAssistantMessage])

  const handleSend = (content?: string) => {
    const text = (content || inputValue).trim()
    if (!text) return
    setInputValue('')
    sendMessage(text)
  }

  const handleClearMessages = () => {
    clearMessages()
    message.success('对话记录已清空')
  }

  const handleUnbindReport = () => {
    setReportId(null)
    message.info('已取消报告绑定，切换到通用知识模式')
  }

  // ── 关闭态：触发按钮 ──────────────────────────────
  if (!isOpen) {
    return (
      <div className="chat-trigger" onClick={toggleChat}>
        <div className="chat-trigger-pulse" />
        <MessageOutlined />
        <span className="chat-trigger-text">AI助手</span>
      </div>
    )
  }

  const allMessages = [...messages]
  if (currentAssistantMessage) {
    allMessages.push({
      role: 'assistant' as const,
      content: currentAssistantMessage,
      timestamp: new Date(),
    })
  }

  // ── 展开态：聊天窗口 ──────────────────────────────
  return (
    <Card
      className="chat-widget"
      title={
        <div className="chat-header">
          <RobotOutlined />
          <span>AI助手</span>
          {reportId && currentReportName && (
            <Tooltip title={`当前绑定报告: ${currentReportName}`}>
              <span className="report-badge">
                <FileTextOutlined style={{ fontSize: 12, marginRight: 4 }} />
                报告 #{reportId}
              </span>
            </Tooltip>
          )}
          {!reportId && <span className="mode-badge">通用模式</span>}
        </div>
      }
      extra={
        <div className="chat-header-actions">
          {messages.length > 0 && (
            <Tooltip title="清空对话">
              <Button type="text" icon={<DeleteOutlined />}
                onClick={handleClearMessages} size="small" />
            </Tooltip>
          )}
          {reportId && (
            <Tooltip title="取消报告绑定">
              <Button type="text" danger onClick={handleUnbindReport} size="small">解绑</Button>
            </Tooltip>
          )}
          <Button type="text" icon={<CloseOutlined />}
            onClick={toggleChat} size="small" />
        </div>
      }
    >
      <div className="chat-messages">
        {allMessages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <RobotOutlined />
            </div>
            <p className="empty-state-title">
              {reportId ? `已绑定报告 #${reportId}` : '开始对话'}
            </p>
            <p className="empty-state-desc">
              {reportId ? '可以针对报告内容提问' : '向AI助手提出任何问题'}
            </p>
            <div className="quick-prompts">
              {QUICK_PROMPTS.map((prompt, i) => (
                <div
                  key={i}
                  className="quick-prompt-item"
                  onClick={() => handleSend(prompt)}
                >
                  {prompt}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <List
            dataSource={allMessages}
            renderItem={(item, index) => (
              <List.Item key={index} className={`message-item ${item.role}`}>
                <Avatar
                  icon={item.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                  size={36}
                  className={`message-avatar message-avatar-${item.role}`}
                />
                <div className="message-wrapper">
                  <div className={`message-bubble message-bubble-${item.role}`}>
                    {item.content}
                  </div>
                  <div className={`message-time message-time-${item.role}`}>
                    {item.timestamp?.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </List.Item>
            )}
          />
        )}
        {isLoading && (
          <div className="loading-indicator">
            <Spin size="small" />
            <span>AI正在思考...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input">
        <Input
          placeholder={reportId ? '针对报告提问...' : '输入消息...'}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onPressEnter={() => handleSend()}
          disabled={isLoading}
          size="large"
          className="chat-input-field"
        />
        <Button
          type="primary"
          shape="circle"
          icon={<SendOutlined />}
          onClick={() => handleSend()}
          loading={isLoading}
          className="chat-send-btn"
        />
      </div>
    </Card>
  )
}

export default ChatWidget
