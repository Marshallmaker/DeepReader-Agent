import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Form, Input, Button, message, Steps } from 'antd'
import { MailOutlined, KeyOutlined, CheckCircleOutlined, ArrowLeftOutlined } from '@ant-design/icons'
import { authService } from '../services/authService'
import { checkPasswordStrength, type StrengthInfo } from '../utils/password'
import { extractErrorMessage } from '../utils/errorHandler'
import VerificationCodeInput from '../components/VerificationCodeInput'
import '../styles/shared.css'
import './ForgotPassword.css'

const { Step } = Steps

function ForgotPassword() {
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [pwdStrength, setPwdStrength] = useState<StrengthInfo>({ level: 'weak', label: '', color: '#d9d9d9', className: '' })
  const [countdown, setCountdown] = useState(0)
  const [sentEmail, setSentEmail] = useState('')
  const [verificationCode, setVerificationCode] = useState('')

  const steps = [
    { title: '输入邮箱', icon: MailOutlined },
    { title: '输入验证码', icon: KeyOutlined },
    { title: '设置新密码', icon: CheckCircleOutlined }
  ]

  const handleStep1Submit = async (values: { email: string }) => {
    setLoading(true)
    try {
      const response = await authService.forgotPasswordSendCode(values.email)
      message.success(response.message)
      setEmail(values.email)
      setSentEmail(values.email)
      setCurrentStep(1)
      startCountdown()
    } catch (error) {
      message.error(extractErrorMessage(error, '申请失败，请重试'))
    } finally {
      setLoading(false)
    }
  }

  const startCountdown = () => {
    setCountdown(60)
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(timer); return 0 }
        return prev - 1
      })
    }, 1000)
  }

  const handleResendCode = async () => {
    if (countdown > 0) return
    setLoading(true)
    try {
      const response = await authService.forgotPasswordSendCode(email)
      message.success(response.message)
      startCountdown()
    } catch (error) {
      message.error(extractErrorMessage(error, '发送失败，请重试'))
    } finally {
      setLoading(false)
    }
  }

  const handleStep2Submit = async (values: { new_password: string; confirm_password: string }) => {
    if (!verificationCode || verificationCode.length !== 6) {
      message.warning('请输入6位验证码')
      return
    }
    if (values.new_password !== values.confirm_password) {
      message.error('两次输入的密码不一致')
      return
    }
    setLoading(true)
    try {
      const response = await authService.forgotPasswordResetWithCode(email, verificationCode, values.new_password)
      message.success(response.message)
      setCurrentStep(2)
    } catch (error) {
      message.error(extractErrorMessage(error, '密码重置失败，请检查验证码是否正确'))
    } finally {
      setLoading(false)
    }
  }

  const handleBackToLogin = () => navigate('/login')

  return (
    <div className="auth-page-container">
      <div className="auth-form-section">
        <div className="auth-card wide">
          {/* ── 应用标题 ──────────────────────────────── */}
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--color-text)', margin: '0 0 4px' }}>
              DeepReader Agent
            </h1>
          </div>

          <div className="back-button" onClick={handleBackToLogin}>
            <ArrowLeftOutlined /><span>返回登录</span>
          </div>

          <div className="form-header">
            <h2 className="form-title">忘记密码</h2>
            <p className="form-subtitle">通过邮箱验证重置您的密码</p>
          </div>

          <Steps current={currentStep} className="steps-container">
            {steps.map((step, index) => (
              <Step key={index} title={step.title} icon={<step.icon />} />
            ))}
          </Steps>

          {currentStep === 0 && (
            <Form name="step1" onFinish={handleStep1Submit} autoComplete="off" layout="vertical">
              <p className="step-description">
                请输入注册时使用的邮箱，我们将发送6位验证码。
              </p>
              <Form.Item name="email" rules={[
                { required: true, message: '请输入邮箱' },
                { type: 'email', message: '请输入有效的邮箱地址，例如：example@domain.com' },
                {
                  validator: async (_, value) => {
                    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return
                    try {
                      const result = await authService.checkEmail(value)
                      if (!result.domain_valid) {
                        throw new Error(result.error_message || '邮箱格式不正确')
                      }
                      if (!result.exists) {
                        throw new Error('该邮箱尚未注册，请检查邮箱地址')
                      }
                    } catch (e: any) {
                      if (e?.message && (e.message.includes('邮箱') || e.message.includes('域名'))) throw e
                    }
                  },
                  validateTrigger: 'onBlur',
                },
              ]}
              validateTrigger={['onBlur', 'onChange']}
              >
                <Input prefix={<MailOutlined className="input-icon" />}
                  placeholder="请输入邮箱地址" size="large" className="custom-input" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading}
                  block size="large" className="submit-btn">
                  发送验证码
                </Button>
              </Form.Item>
            </Form>
          )}

          {currentStep === 1 && (
            <Form name="step2" onFinish={handleStep2Submit} autoComplete="off" layout="vertical">
              <p className="step-description">
                验证码已发送至 <span className="highlight">{sentEmail}</span>，请在10分钟内完成验证。
              </p>
              <div style={{ marginBottom: 24, textAlign: 'center' }}>
                <div style={{ marginBottom: 12, fontWeight: 500 }}>请输入6位验证码</div>
                <VerificationCodeInput
                  value={verificationCode}
                  onChange={setVerificationCode}
                />
              </div>
              <Form.Item name="new_password" rules={[
                { required: true, message: '请输入新密码' },
                { min: 8, max: 20, message: '密码长度需在8-20位之间' },
                { pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)|(?=.*[a-z])(?=.*[A-Z])(?=.*[@$!%*#?&])|(?=.*[a-z])(?=.*\d)(?=.*[@$!%*#?&])|(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*#?&])/, message: '密码必须包含大写字母、小写字母、数字和特殊符号(@$!%*#?&)中的至少三种' }
              ]}>
                <Input.Password prefix={<KeyOutlined className="input-icon" />}
                  placeholder="新密码" size="large" className="custom-input"
                  onChange={(e) => setPwdStrength(checkPasswordStrength(e.target.value))} />
              </Form.Item>
              <div className="password-strength-container">
                <div className="strength-bars">
                  {[1, 2, 3].map((index) => (
                    <div key={index} className="strength-bar"
                      style={{ backgroundColor: pwdStrength.color !== '#d9d9d9' ? pwdStrength.color : '#E5E5EA' }} />
                  ))}
                </div>
                <span className="strength-text" style={{ color: pwdStrength.color }}>
                  {pwdStrength.label || '请输入密码'}
                </span>
              </div>
              <Form.Item name="confirm_password" dependencies={['new_password']} rules={[
                { required: true, message: '请确认密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('new_password') === value) return Promise.resolve()
                    return Promise.reject(new Error('两次输入的密码不一致'))
                  },
                }),
              ]}>
                <Input.Password prefix={<KeyOutlined className="input-icon" />}
                  placeholder="确认新密码" size="large" className="custom-input" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading}
                  block size="large" className="submit-btn">
                  确认重置
                </Button>
              </Form.Item>
              <div className="step-nav">
                <Button type="link" onClick={() => setCurrentStep(0)}>返回上一步</Button>
                <Button type="link" onClick={handleResendCode} disabled={countdown > 0}>
                  {countdown > 0 ? `${countdown}秒后重新发送` : '重新发送验证码'}
                </Button>
              </div>
            </Form>
          )}

          {currentStep === 2 && (
            <div className="success-container">
              <CheckCircleOutlined className="success-icon" />
              <h3>密码重置成功</h3>
              <p>您的密码已成功修改，请使用新密码登录。</p>
              <Button type="primary" onClick={handleBackToLogin}
                block size="large" className="submit-btn">
                返回登录
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ForgotPassword
