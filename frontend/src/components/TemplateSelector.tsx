import { useState } from 'react'
import { Button, Dropdown, Modal, List, Tag, message, Space, Typography, Tooltip } from 'antd'
import { FileTextOutlined, PlusOutlined, UserOutlined, ImportOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { templateService, TemplateResponse, MetricItem } from '../services/templateService'
import { extractErrorMessage } from '../utils/errorHandler'
import { useDraggableModal } from '../hooks/useDraggableModal'

const { Text } = Typography

interface TemplateSelectorProps {
  /** 导入完成后触发，用于刷新父组件中的指标列表 */
  onImportComplete: () => void
  /** 可选：点击"保存当前指标为模板"时的回调 */
  onSaveAsTemplate?: () => void
}

function TemplateSelector({ onImportComplete, onSaveAsTemplate }: TemplateSelectorProps) {
  const { modalRender } = useDraggableModal()
  const [templates, setTemplates] = useState<TemplateResponse[]>([])
  const [loading, setLoading] = useState(false)

  // ── 预览弹窗状态 ──────────────────────────────────────
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewTemplate, setPreviewTemplate] = useState<TemplateResponse | null>(null)
  const [importing, setImporting] = useState(false)

  /** 加载模板列表 */
  const loadTemplates = async () => {
    setLoading(true)
    try {
      const response = await templateService.getTemplates()
      setTemplates(response.data)
    } catch {
      message.error('加载模板列表失败')
    } finally {
      setLoading(false)
    }
  }

  /** 下拉菜单展开时自动加载 */
  const handleOpenChange = (open: boolean) => {
    if (open) {
      loadTemplates()
    }
  }

  /** 系统模板（包含已禁用的，已禁用的在菜单中灰显） */
  const systemTemplates = templates.filter((t) => t.is_system)
  /** 用户自定义模板 */
  const userTemplates = templates.filter((t) => !t.is_system)

  /** 构建 Ant Design Dropdown menu items */
  const buildMenuItems = (): MenuProps['items'] => {
    const items: MenuProps['items'] = []

    // 系统模板分组
    if (systemTemplates.length > 0) {
      items.push({
        type: 'group',
        label: '系统模板',
        key: 'group-system',
        children: systemTemplates.map((t) => {
          const isDisabled = t.is_active === false
          return {
            key: `template-${t.id}`,
            label: isDisabled ? `${t.name} (${t.metric_count}项)（已禁用）` : `${t.name} (${t.metric_count}项)`,
            icon: <FileTextOutlined />,
            disabled: isDisabled,
            onClick: () => handlePreviewTemplate(t),
          }
        }),
      })
    }

    // 用户模板分组
    if (userTemplates.length > 0) {
      items.push({
        type: 'group',
        label: '我的模板',
        key: 'group-user',
        children: userTemplates.map((t) => ({
          key: `template-${t.id}`,
          label: `${t.name} (${t.metric_count}项)`,
          icon: <UserOutlined />,
          onClick: () => handlePreviewTemplate(t),
        })),
      })
    }

    // 分隔线 + "保存当前指标为模板"
    if (onSaveAsTemplate) {
      if (items.length > 0) {
        items.push({ type: 'divider', key: 'divider' })
      }
      items.push({
        key: 'save-as-template',
        label: '保存当前指标为模板',
        icon: <PlusOutlined />,
        onClick: () => onSaveAsTemplate(),
      })
    }

    // 无模板时显示提示
    if (items.length === 0) {
      items.push({
        key: 'empty',
        label: '暂无可用模板',
        disabled: true,
      })
    }

    return items
  }

  /** 点击模板 → 打开预览弹窗 */
  const handlePreviewTemplate = (template: TemplateResponse) => {
    setPreviewTemplate(template)
    setPreviewOpen(true)
  }

  /** 确认导入模板中的指标 */
  const handleImport = async () => {
    if (!previewTemplate) return
    setImporting(true)
    try {
      const result = await templateService.importTemplate(previewTemplate.id)
      if (result.skipped_count > 0) {
        message.success(
          `成功导入 ${result.created_count} 个指标，跳过 ${result.skipped_count} 个（已存在或已被管理员禁用）`,
          5
        )
      } else {
        message.success(`成功导入 ${result.created_count} 个指标`)
      }
      setPreviewOpen(false)
      onImportComplete()
    } catch (error) {
      message.error(extractErrorMessage(error, '导入模板失败'))
    } finally {
      setImporting(false)
    }
  }

  /** 渲染指标列表项 */
  const renderMetricItem = (item: MetricItem) => {
    const isDisabled = item.disabled === true
    return (
      <List.Item style={isDisabled ? { opacity: 0.45, textDecoration: 'line-through' } : undefined}>
        <Space align="start">
          <Tag color={item.expected_type === 'NUMERIC' ? 'blue' : 'green'}
            style={isDisabled ? { opacity: 0.5 } : undefined}>
            {item.expected_type === 'NUMERIC' ? '数值' : '文本'}
          </Tag>
          <div>
            <div style={{ fontWeight: 500 }}>
              {item.metric_label}
              {isDisabled && <Tag color="error" style={{ marginLeft: 8, fontSize: 11 }}>已禁用</Tag>}
            </div>
            <Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
              {item.metric_key}
            </Text>
            {item.prompt_instruction && (
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  提示：{item.prompt_instruction}
                </Text>
              </div>
            )}
          </div>
        </Space>
      </List.Item>
    )
  }

  return (
    <>
      <Dropdown
        menu={{ items: buildMenuItems() }}
        onOpenChange={handleOpenChange}
        trigger={['click']}
      >
        <Button icon={<ImportOutlined />} loading={loading}>
          从模板导入
        </Button>
      </Dropdown>

      {/* 模板预览弹窗 */}
      <Modal
        modalRender={modalRender}
        title={previewTemplate ? `预览模板：${previewTemplate.name}` : '模板预览'}
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        width={600}
        footer={[
          <Button key="cancel" onClick={() => setPreviewOpen(false)}>
            取消
          </Button>,
          previewTemplate?.is_active === false ? (
            <Tooltip title="该模版已被管理员禁用，无法导入" key="import-disabled">
              <Button
                key="import"
                type="primary"
                disabled
                icon={<ImportOutlined />}
              >
                导入指标
              </Button>
            </Tooltip>
          ) : (
            <Button
              key="import"
              type="primary"
              loading={importing}
              icon={<ImportOutlined />}
              onClick={handleImport}
            >
              导入指标
            </Button>
          ),
        ]}
      >
        {previewTemplate && (
          <div>
            {previewTemplate.description && (
              <div style={{ marginBottom: 16 }}>
                <Text type="secondary">{previewTemplate.description}</Text>
              </div>
            )}
            <div style={{ marginBottom: 12 }}>
              <Text strong>共 {previewTemplate.metric_count} 项指标：</Text>
            </div>
            <List
              dataSource={previewTemplate.metrics}
              renderItem={renderMetricItem}
              style={{ maxHeight: 400, overflowY: 'auto' }}
            />
          </div>
        )}
      </Modal>
    </>
  )
}

export default TemplateSelector
