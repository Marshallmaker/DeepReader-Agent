/**
 * useDraggableModal — 使 antd Modal 可通过标题栏拖动
 *
 * 零外部依赖，基于原生 DOM 事件。利用 antd v5 的 modalRender 官方 API。
 *
 * 关键设计：
 * 1. 使用 useLayoutEffect（paint 之前）清理上一次拖动留下的内联样式，
 *    确保每次打开弹窗都从 antd 的居中位置开始，不影响 CSS 打开动画。
 * 2. 仅在用户实际拖动（超过 3px 阈值）时才切换到 fixed 定位。
 * 3. 清理函数（unmount 时）只移除事件监听，不触碰 Modal 样式，
 *    以免干扰 antd 的关闭动画。
 *
 * 用法：
 *   const { modalRender } = useDraggableModal()
 *   <Modal modalRender={modalRender} ... />
 */

import { useRef, useLayoutEffect, useCallback } from 'react'

/** 内部组件：包裹 modalRender 内容，负责拖动逻辑 */
function DragWrapper({ children }: { children: React.ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = wrapperRef.current
    if (!el) return

    const modal = el.closest('.ant-modal') as HTMLElement | null
    if (!modal) return

    // ── 清理上一次拖动留下的内联样式 ──
    // 仅在 position === 'fixed' 时说明弹窗曾被拖动过（正常弹窗是 relative）
    if (modal.style.position === 'fixed') {
      modal.style.position = ''
      modal.style.margin = ''
      modal.style.top = ''
      modal.style.left = ''
      modal.style.transition = ''
      // 仅清除 translate 类型的 transform，保留可能的动画 transform
      const t = modal.style.transform
      if (t && (
        t.startsWith('translate(') ||
        t.startsWith('translate3d(')
      )) {
        modal.style.transform = ''
      }
    }

    // ── 标题栏 ──
    const header = modal.querySelector('.ant-modal-header') as HTMLElement | null
    if (!header) return

    header.style.cursor = 'move'
    header.style.userSelect = 'none'

    // ── 拖动状态 ──
    let dragging = false
    let hasMoved = false
    let startX = 0
    let startY = 0
    let initialLeft = 0
    let initialTop = 0

    /** 最小拖动阈值（px），小于此距离视为点击，不切换定位 */
    const DRAG_THRESHOLD = 3

    // ── 事件处理器 ────────────────────────────────────────

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return // 仅响应左键

      dragging = true
      hasMoved = false

      startX = e.clientX
      startY = e.clientY

      // 在 antd 默认居中状态下记录 Modal 当前实际屏幕位置
      const rect = modal.getBoundingClientRect()
      initialLeft = rect.left
      initialTop = rect.top

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return
      e.preventDefault()

      const dx = e.clientX - startX
      const dy = e.clientY - startY

      // 未超过阈值：保持 antd 原生定位，不做任何样式修改
      if (!hasMoved) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
        hasMoved = true
        // 首次拖动：从 antd 的居中布局切换到 fixed 定位以支持自由移动
        modal.style.position = 'fixed'
        modal.style.margin = '0'
        modal.style.top = '0'
        modal.style.left = '0'
        modal.style.transition = 'none'
      }

      let newLeft = initialLeft + dx
      let newTop = initialTop + dy

      // 视口边界约束：左右保留 30% 可见，顶部不超出视口，底部保留 50px
      const rect = modal.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight

      newLeft = Math.max(-rect.width * 0.3, Math.min(newLeft, vw - rect.width * 0.3))
      newTop = Math.max(0, Math.min(newTop, vh - 50))

      modal.style.transform = `translate(${newLeft}px, ${newTop}px)`
    }

    const onMouseUp = () => {
      dragging = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    header.addEventListener('mousedown', onMouseDown)

    // ── 清理：仅移除事件监听和标题栏样式 ──
    // 不触碰 Modal 自身样式——关闭时 antd 自行管理动画和 DOM 移除
    return () => {
      header.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      header.style.cursor = ''
      header.style.userSelect = ''
    }
  }, [])

  return <div ref={wrapperRef}>{children}</div>
}

/**
 * 返回可传给 antd Modal 的 modalRender 函数。
 *
 * 每个 Modal 独立拥有 DragWrapper 实例，因此多个 Modal 同时打开时互不干扰；
 * 关闭再打开时自动回到居中位置。
 */
export function useDraggableModal() {
  const modalRender = useCallback(
    (node: React.ReactNode) => <DragWrapper>{node}</DragWrapper>,
    []
  )
  return { modalRender }
}
