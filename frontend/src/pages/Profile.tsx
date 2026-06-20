import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Form, Input, Button, Avatar, Upload, message } from 'antd'
import { UserOutlined, MailOutlined, SmileOutlined, CameraOutlined, ArrowLeftOutlined, SendOutlined } from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'
import { authService } from '../services/authService'
import { extractErrorMessage } from '../utils/errorHandler'
import VerificationCodeInput from '../components/VerificationCodeInput'
import '../styles/components.css'
import './Profile.css'

function Profile() {
  const navigate = useNavigate()
  const { user, accessToken, setAuth } = useAuthStore()
  const [saving, setSaving] = useState(false)
  const [avatarLoading, setAvatarLoading] = useState(false)

  // ── 邮箱修改状态 ──────────────────────────────────────
  const [newEmail, setNewEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [sendCodeLoading, setSendCodeLoading] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [verificationCode, setVerificationCode] = useState('')
  const [verifyLoading, setVerifyLoading] = useState(false)

  const handleUpdateProfile = async (values: { nickname: string }) => {
    setSaving(true)
    try {
      const updated = await authService.updateProfile({
        nickname: values.nickname,
      })
      if (accessToken) {
        setAuth(accessToken, {
          id: updated.id,
          email: updated.email,
          nickname: updated.nickname,
          isAdmin: updated.is_admin,
          avatarUrl: updated.avatar_url,
        })
      }
      message.success('个人信息已更新')
    } catch (error) {
      message.error(extractErrorMessage(error, '更新失败'))
    } finally {
      setSaving(false)
    }
  }

  const handleAvatarUpload = async (file: File) => {
    setAvatarLoading(true)
    try {
      const result = await authService.uploadAvatar(file)
      if (accessToken && user) {
        setAuth(accessToken, {
          ...user,
          avatarUrl: result.avatar_url,
        })
      }
      message.success('头像已更新')
    } catch (error) {
      message.error(extractErrorMessage(error, '头像上传失败'))
    } finally {
      setAvatarLoading(false)
    }
    return false
  }

  // ── 邮箱格式校验 ──────────────────────────────────────
  const validateEmailFormat = (email: string): string | null => {
    if (!email) return null
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return '请输入有效的邮箱地址，例如：example@qq.com'
    }
    return null
  }

  // ── 失焦时校验邮箱域名 ──────────────────────────────
  const handleEmailBlur = async () => {
    // 先做格式校验
    const formatError = validateEmailFormat(newEmail)
    if (formatError) {
      setEmailError(formatError)
      return
    }
    // 调用后端检查域名合法性
    try {
      const result = await authService.checkEmail(newEmail)
      if (!result.domain_valid) {
        setEmailError(result.error_message || '邮箱格式不正确')
        return
      }
      if (result.exists && newEmail !== user?.email) {
        setEmailError('该邮箱已经被注册使用')
        return
      }
      setEmailError(null)
    } catch {
      // 网络错误时不清除现有错误
    }
  }

  // ── 邮箱修改：发送验证码 ──────────────────────────────
  const handleSendCode = async () => {
    if (!newEmail) {
      message.warning('请输入新邮箱地址')
      return
    }
    // 校验邮箱格式
    const formatError = validateEmailFormat(newEmail)
    if (formatError) {
      setEmailError(formatError)
      message.warning(formatError)
      return
    }
    // 检查邮箱域名合法性 + 是否已被其他账号使用
    try {
      const result = await authService.checkEmail(newEmail)
      if (!result.domain_valid) {
        const msg = result.error_message || '邮箱格式不正确'
        setEmailError(msg)
        message.warning(msg)
        return
      }
      if (result.exists && newEmail !== user?.email) {
        setEmailError('该邮箱已经被注册使用')
        message.warning('该邮箱已经被注册使用')
        return
      }
    } catch {
      // 网络错误时静默放行，后端还会再次校验
    }

    setSendCodeLoading(true)
    try {
      await authService.changeEmailSendCode(newEmail)
      setCodeSent(true)
      message.success('验证码已发送至新邮箱，10分钟内有效')
    } catch (error) {
      message.error(extractErrorMessage(error, '发送验证码失败'))
    } finally {
      setSendCodeLoading(false)
    }
  }

  // ── 邮箱修改：验证并更新 ──────────────────────────────
  const handleVerifyAndChange = async () => {
    if (!verificationCode || verificationCode.length !== 6) {
      message.warning('请输入6位验证码')
      return
    }
    setVerifyLoading(true)
    try {
      const updated = await authService.changeEmailVerify(newEmail, verificationCode)
      if (accessToken) {
        setAuth(accessToken, {
          id: updated.id,
          email: updated.email,
          nickname: updated.nickname,
          isAdmin: updated.is_admin,
          avatarUrl: updated.avatar_url,
        })
      }
      message.success('邮箱已更新')
      // 重置状态
      setNewEmail('')
      setVerificationCode('')
      setCodeSent(false)
    } catch (error) {
      message.error(extractErrorMessage(error, '邮箱修改失败'))
    } finally {
      setVerifyLoading(false)
    }
  }

  const avatarSrc = user?.avatarUrl || undefined

  return (
    <div className="profile-page">
      <div className="page-header">
        <div>
          <h1 className="page-header-title">
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate('/dashboard')}
              style={{ marginRight: 8 }}
            />
            个人中心
          </h1>
          <p className="page-header-subtitle">管理您的个人信息和头像</p>
        </div>
      </div>

      <div className="profile-cards">
        {/* 头像卡片 */}
        <Card className="profile-avatar-card">
          <div className="avatar-section">
            <div className="avatar-upload-wrapper">
              <Avatar
                size={100}
                icon={!avatarSrc && <UserOutlined />}
                src={avatarSrc}
                className="profile-avatar"
              />
              <Upload
                showUploadList={false}
                accept="image/jpeg,image/png"
                beforeUpload={handleAvatarUpload}
              >
                <div className="avatar-upload-overlay">
                  <CameraOutlined />
                  <span>{avatarLoading ? '上传中...' : '更换头像'}</span>
                </div>
              </Upload>
            </div>
            <div className="avatar-info">
              <h3>{user?.nickname || user?.email || '用户'}</h3>
              <p className="text-secondary">{user?.email}</p>
              <p className="text-tertiary" style={{ fontSize: 12 }}>
                支持 JPG / PNG，最大 2MB
              </p>
            </div>
          </div>
        </Card>

        {/* 昵称编辑卡片 */}
        <Card title="个人信息" className="profile-form-card">
          <Form
            layout="vertical"
            initialValues={{
              nickname: user?.nickname || '',
            }}
            onFinish={handleUpdateProfile}
          >
            <Form.Item
              name="nickname"
              label="昵称"
              rules={[{ max: 100, message: '昵称最多100个字符' }]}
            >
              <Input
                prefix={<SmileOutlined />}
                placeholder="设置您的昵称（直接保存即可）"
                size="large"
              />
            </Form.Item>

            <Button
              type="primary"
              htmlType="submit"
              loading={saving}
              size="large"
              block
            >
              保存修改
            </Button>
          </Form>
        </Card>

        {/* 邮箱修改卡片（验证码流程） */}
        <Card title="修改邮箱" className="profile-form-card">
          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8, color: 'var(--color-text-secondary)', fontSize: 13 }}>
              当前邮箱：<strong>{user?.email}</strong>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>新邮箱地址</div>
            <Input
              prefix={<MailOutlined />}
              placeholder="请输入新邮箱地址，例如：example@domain.com"
              size="large"
              value={newEmail}
              status={emailError ? 'error' : undefined}
              onChange={(e) => {
                setNewEmail(e.target.value)
                setCodeSent(false)
                setVerificationCode('')
                if (emailError) setEmailError(null)
              }}
              onBlur={handleEmailBlur}
              disabled={verifyLoading}
            />
            {emailError && (
              <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>{emailError}</div>
            )}
            <Button
              type="default"
              icon={<SendOutlined />}
              loading={sendCodeLoading}
              onClick={handleSendCode}
              style={{ marginTop: 12 }}
              block
            >
              {codeSent ? '重新发送验证码' : '发送验证码'}
            </Button>
          </div>

          {codeSent && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 12, textAlign: 'center', fontWeight: 500 }}>请输入6位验证码</div>
              <VerificationCodeInput
                value={verificationCode}
                onChange={setVerificationCode}
              />
              <Button
                type="primary"
                loading={verifyLoading}
                onClick={handleVerifyAndChange}
                style={{ marginTop: 16 }}
                block
              >
                验证并更新邮箱
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

export default Profile
