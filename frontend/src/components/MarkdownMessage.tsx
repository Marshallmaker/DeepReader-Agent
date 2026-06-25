import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownMessageProps {
  content: string
}

/**
 * AI 回复 Markdown 渲染组件。
 * 仅用于助手消息气泡，用户消息保持纯文本。
 * 使用 React.memo：流式输出时仅新消息重新渲染，历史消息跳过。
 */
const MarkdownMessage = memo(function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  )
})

export default MarkdownMessage
