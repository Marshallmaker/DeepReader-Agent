import { useState } from 'react'
import { Button, Input, Popconfirm, Tooltip, App } from 'antd'
import {
  PlusOutlined,
  LeftOutlined,
  RightOutlined,
  EditOutlined,
  DeleteOutlined,
  CommentOutlined,
  MessageOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import type { SessionSummary } from '../services/chatService'
import './ChatSidebar.css'

interface TimeGroup {
  label: string
  sessions: SessionSummary[]
}

/** 将会话列表按时间分组 */
function groupSessionsByTime(sessions: SessionSummary[]): TimeGroup[] {
  const now = dayjs()
  const today: SessionSummary[] = []
  const yesterday: SessionSummary[] = []
  const last7Days: SessionSummary[] = []
  const last30Days: SessionSummary[] = []
  const byMonth: Record<string, SessionSummary[]> = {}

  for (const s of sessions) {
    const d = dayjs(s.updated_at || s.created_at)
    if (d.isSame(now, 'day')) {
      today.push(s)
    } else if (d.isSame(now.subtract(1, 'day'), 'day')) {
      yesterday.push(s)
    } else if (d.isAfter(now.subtract(7, 'day'))) {
      last7Days.push(s)
    } else if (d.isAfter(now.subtract(30, 'day'))) {
      last30Days.push(s)
    } else {
      const key = d.format('YYYY年M月')
      if (!byMonth[key]) byMonth[key] = []
      byMonth[key].push(s)
    }
  }

  const groups: TimeGroup[] = []
  if (today.length) groups.push({ label: '今天', sessions: today })
  if (yesterday.length) groups.push({ label: '昨天', sessions: yesterday })
  if (last7Days.length) groups.push({ label: '7天内', sessions: last7Days })
  if (last30Days.length) groups.push({ label: '30天内', sessions: last30Days })

  // 按月分组按时间倒序排列
  const monthKeys = Object.keys(byMonth).sort((a, b) => {
    // 解析 "2026年5月" 格式
    const [ya, ma] = a.replace('年', '-').replace('月', '').split('-')
    const [yb, mb] = b.replace('年', '-').replace('月', '').split('-')
    return new Date(+yb, +mb - 1).getTime() - new Date(+ya, +ma - 1).getTime()
  })
  for (const key of monthKeys) {
    groups.push({ label: key, sessions: byMonth[key] })
  }

  return groups
}

interface ChatSidebarProps {
  sessions: SessionSummary[]
  activeSessionId: string
  collapsed: boolean
  loading: boolean
  onToggleCollapse: () => void
  onNewSession: () => void
  onSwitchSession: (sessionId: string) => void
  onRenameSession: (sessionId: string, title: string) => Promise<void>
  onDeleteSession: (sessionId: string) => Promise<void>
}

function ChatSidebar({
  sessions,
  activeSessionId,
  collapsed,
  loading,
  onToggleCollapse,
  onNewSession,
  onSwitchSession,
  onRenameSession,
  onDeleteSession,
}: ChatSidebarProps) {
  const { message } = App.useApp()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const grouped = groupSessionsByTime(sessions)

  const handleStartRename = (sessionId: string, currentTitle: string | null) => {
    setEditingId(sessionId)
    setEditValue(currentTitle || '')
  }

  const handleConfirmRename = async (sessionId: string) => {
    const trimmed = editValue.trim()
    if (!trimmed) {
      setEditingId(null)
      return
    }
    try {
      await onRenameSession(sessionId, trimmed)
      setEditingId(null)
    } catch {
      message.error('重命名失败')
    }
  }

  const handleDelete = async (sessionId: string) => {
    try {
      await onDeleteSession(sessionId)
      message.success('对话已删除')
    } catch {
      message.error('删除失败')
    }
  }

  return (
    <div className={`chat-sidebar${collapsed ? ' collapsed' : ''}`}>
      {/* 头部 */}
      <div className="sidebar-header">
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={onNewSession}
          className="new-chat-btn"
          block
        >
          {!collapsed && '新对话'}
        </Button>
        <Tooltip title={collapsed ? '展开侧边栏' : '收起侧边栏'}>
          <Button
            type="text"
            icon={collapsed ? <RightOutlined /> : <LeftOutlined />}
            onClick={onToggleCollapse}
            className="collapse-btn"
          />
        </Tooltip>
      </div>

      {/* 会话列表 */}
      <div className="session-list">
        {loading && sessions.length === 0 ? (
          <div className="sidebar-loading">
            <span className="sidebar-loading-text">加载中...</span>
          </div>
        ) : grouped.length === 0 ? (
          <div className="sidebar-empty">
            <MessageOutlined className="sidebar-empty-icon" />
            <span className="sidebar-empty-text">暂无对话记录</span>
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.label} className="time-group">
              <div className="time-group-label">{group.label}</div>
              {group.sessions.map((s) => {
                const isActive = s.session_id === activeSessionId
                const isEditing = editingId === s.session_id
                const displayTitle = s.title || '新对话'

                return (
                  <div
                    key={s.session_id}
                    className={`session-item${isActive ? ' active' : ''}`}
                    onClick={() => {
                      if (!isEditing && !isActive) {
                        onSwitchSession(s.session_id)
                      }
                    }}
                  >
                    <CommentOutlined className="session-item-icon" />
                    <div className="session-item-content">
                      {isEditing ? (
                        <Input
                          size="small"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onPressEnter={() => handleConfirmRename(s.session_id)}
                          onBlur={() => handleConfirmRename(s.session_id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          autoFocus
                          className="rename-input"
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="session-item-title">{displayTitle}</span>
                      )}
                    </div>
                    {!collapsed && !isEditing && (
                      <div className="session-item-actions">
                        <Tooltip title="重命名">
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleStartRename(s.session_id, s.title)
                            }}
                            className="action-btn"
                          />
                        </Tooltip>
                        <Popconfirm
                          title="确定删除此对话？"
                          description="删除后无法恢复"
                          onConfirm={(e) => {
                            e?.stopPropagation()
                            handleDelete(s.session_id)
                          }}
                          onCancel={(e) => e?.stopPropagation()}
                          okText="删除"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                        >
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={(e) => e.stopPropagation()}
                            className="action-btn"
                          />
                        </Popconfirm>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default ChatSidebar
export type { ChatSidebarProps }
