import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Form, Input, Button, Checkbox, message, Tabs } from 'antd'
import { UserOutlined, LockOutlined, SmileOutlined, MailOutlined } from '@ant-design/icons'
import { authService } from '../services/authService'
import { checkPasswordStrength, type StrengthInfo } from '../utils/password'
import { extractErrorMessage } from '../utils/errorHandler'
import VerificationCodeInput from '../components/VerificationCodeInput'
import '../styles/shared.css'
import './Login.css'

function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const [activeTab, setActiveTab] = useState('login')
  const [loginLoading, setLoginLoading] = useState(false)
  const [registerLoading, setRegisterLoading] = useState(false)
  const [pwdStrength, setPwdStrength] = useState<StrengthInfo>({ level: 'weak', label: '', color: '#d9d9d9', className: '' })

  // ── 注册步骤状态 ──────────────────────────────────────
  const [registerStep, setRegisterStep] = useState(1)       // 1=输入邮箱, 2=验证码+密码
  const [registerEmail, setRegisterEmail] = useState('')
  const [registerCode, setRegisterCode] = useState('')
  const [sendCodeLoading, setSendCodeLoading] = useState(false)
  const [codeCountdown, setCodeCountdown] = useState(0)

  useEffect(() => {
    if (location.pathname === '/register') {
      setActiveTab('register')
    } else {
      setActiveTab('login')
    }
  }, [location.pathname])

  const handleTabChange = (key: string) => {
    setActiveTab(key)
    // 切换标签时重置注册步骤
    setRegisterStep(1)
    setRegisterCode('')
    navigate(key === 'register' ? '/register' : '/login', { replace: true })
  }

  const handlePasswordChange = (password: string) => {
    setPwdStrength(checkPasswordStrength(password))
  }

  const onLoginFinish = async (values: { email: string; password: string; remember_me: boolean }) => {
    setLoginLoading(true)
    try {
      await authService.login(values.email, values.password, values.remember_me)
      message.success('登录成功')
      navigate('/dashboard')
    } catch (error) {
      message.error(extractErrorMessage(error, '登录失败，请检查邮箱和密码'))
    } finally {
      setLoginLoading(false)
    }
  }

  // ── 注册第一步：发送验证码 ────────────────────────────
  const handleSendRegisterCode = async (values: { email: string }) => {
    setSendCodeLoading(true)
    try {
      await authService.registerSendCode(values.email)
      message.success('验证码已发送至您的注册邮箱，10分钟内有效')
      setRegisterEmail(values.email)
      setRegisterStep(2)
      // 启动倒计时
      setCodeCountdown(60)
      const timer = setInterval(() => {
        setCodeCountdown(prev => {
          if (prev <= 1) { clearInterval(timer); return 0 }
          return prev - 1
        })
      }, 1000)
    } catch (error) {
      message.error(extractErrorMessage(error, '发送验证码失败，请稍后重试'))
    } finally {
      setSendCodeLoading(false)
    }
  }

  // ── 注册第二步：验证验证码 + 完成注册 ─────────────────
  const onRegisterFinish = async (values: { password: string; nickname?: string }) => {
    if (!registerCode || registerCode.length !== 6) {
      message.warning('请输入6位验证码')
      return
    }
    setRegisterLoading(true)
    try {
      await authService.register(registerEmail, values.password, registerCode, values.nickname)
      message.success('注册成功，请登录')
      // 重置状态
      setRegisterStep(1)
      setRegisterCode('')
      setRegisterEmail('')
      setActiveTab('login')
      navigate('/login', { replace: true })
    } catch (error) {
      message.error(extractErrorMessage(error, '注册失败，请稍后重试'))
    } finally {
      setRegisterLoading(false)
    }
  }

  return (
    <div className="auth-page-container">
      <div className="auth-form-section">
        <div className="auth-card">
          {/* ── 应用标题 ──────────────────────────────── */}
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <h1 style={{ fontSize: 28, fontWeight: 600, color: 'var(--color-text)', margin: '0 0 4px' }}>
              DeepReader Agent
            </h1>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 15, margin: 0 }}>
              让研报分析更智能
            </p>
          </div>

          <Tabs
            activeKey={activeTab}
            onChange={handleTabChange}
            className="auth-tabs"
            centered
            items={[
              {
                key: 'login',
                label: '登录',
                children: (
                  <div className="tab-content">
                    <h2 className="form-title">欢迎回来</h2>
                    <p className="form-subtitle">请登录您的账号</p>

                    <Form
                      name="login"
                      onFinish={onLoginFinish}
                      autoComplete="off"
                      layout="vertical"
                      initialValues={{ remember_me: false }}
                    >
                      <Form.Item
                        name="email"
                        rules={[
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
                                  throw new Error('该邮箱尚未注册')
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
                        <Input
                          prefix={<UserOutlined className="input-icon" />}
                          placeholder="请输入注册邮箱"
                          size="large"
                          className="custom-input"
                        />
                      </Form.Item>

                      <Form.Item
                        name="password"
                        rules={[{ required: true, message: '请输入密码' }]}
                      >
                        <Input.Password
                          prefix={<LockOutlined className="input-icon" />}
                          placeholder="请输入密码"
                          size="large"
                          className="custom-input"
                        />
                      </Form.Item>

                      <Form.Item name="remember_me" valuePropName="checked">
                        <div className="login-options">
                          <Checkbox className="remember-checkbox">记住密码</Checkbox>
                          <Button type="link" className="forgot-link" onClick={() => navigate('/forgot-password')}>
                            忘记密码？
                          </Button>
                        </div>
                      </Form.Item>

                      <Form.Item>
                        <Button
                          type="primary"
                          htmlType="submit"
                          loading={loginLoading}
                          block
                          size="large"
                          className="submit-btn"
                        >
                          登录
                        </Button>
                      </Form.Item>
                    </Form>
                  </div>
                )
              },
              {
                key: 'register',
                label: '注册',
                children: (
                  <div className="tab-content">
                    {/* ── 第一步：输入邮箱 ──────────────────── */}
                    {registerStep === 1 && (
                      <>
                        <h2 className="form-title">创建新账号</h2>
                        <p className="form-subtitle">请输入注册邮箱获取验证码</p>

                        <Form
                          name="register-step1"
                          onFinish={handleSendRegisterCode}
                          autoComplete="off"
                          layout="vertical"
                        >
                          <Form.Item
                            name="email"
                            rules={[
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
                                    if (result.exists) {
                                      throw new Error('该邮箱已经被注册使用')
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
                            <Input
                              prefix={<MailOutlined className="input-icon" />}
                              placeholder="请输入注册邮箱"
                              size="large"
                              className="custom-input"
                            />
                          </Form.Item>

                          <Form.Item>
                            <Button
                              type="primary"
                              htmlType="submit"
                              loading={sendCodeLoading}
                              block
                              size="large"
                              className="submit-btn"
                            >
                              发送验证码
                            </Button>
                          </Form.Item>
                        </Form>
                      </>
                    )}

                    {/* ── 第二步：验证码 + 密码 ────────────── */}
                    {registerStep === 2 && (
                      <>
                        <h2 className="form-title">验证邮箱</h2>
                        <p className="form-subtitle">
                          验证码已发送至 <strong>{registerEmail}</strong>
                        </p>

                        <div style={{ marginBottom: 20 }}>
                          <div style={{ marginBottom: 10, fontWeight: 500, textAlign: 'center' }}>
                            请输入6位验证码
                          </div>
                          <VerificationCodeInput
                            value={registerCode}
                            onChange={setRegisterCode}
                          />
                        </div>

                        <Form
                          name="register-step2"
                          onFinish={onRegisterFinish}
                          autoComplete="off"
                          layout="vertical"
                        >
                          <Form.Item
                            name="nickname"
                            rules={[{ max: 100, message: '昵称最多100个字符' }]}
                          >
                            <Input
                              prefix={<SmileOutlined className="input-icon" />}
                              placeholder="昵称（可选）"
                              size="large"
                              className="custom-input"
                            />
                          </Form.Item>

                          <Form.Item
                            name="password"
                            rules={[
                              { required: true, message: '请输入密码' },
                              { min: 8, max: 20, message: '密码长度需在8-20位之间' },
                              {
                                pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)|(?=.*[a-z])(?=.*[A-Z])(?=.*[@$!%*#?&])|(?=.*[a-z])(?=.*\d)(?=.*[@$!%*#?&])|(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*#?&])/,
                                message: '密码必须包含大写字母、小写字母、数字和特殊符号中的至少三种'
                              }
                            ]}
                          >
                            <Input.Password
                              prefix={<LockOutlined className="input-icon" />}
                              placeholder="请输入密码"
                              size="large"
                              className="custom-input"
                              onChange={(e) => handlePasswordChange(e.target.value)}
                            />
                          </Form.Item>

                          <div className="password-strength-container">
                            <div className="strength-bars">
                              {[1, 2, 3].map((index) => (
                                <div
                                  key={index}
                                  className="strength-bar"
                                  style={{
                                    backgroundColor:
                                      pwdStrength.level === 'weak' && index === 1
                                        ? pwdStrength.color
                                        : pwdStrength.level === 'medium' && index <= 2
                                        ? pwdStrength.color
                                        : pwdStrength.level === 'strong'
                                        ? pwdStrength.color
                                        : '#E5E5EA'
                                  }}
                                />
                              ))}
                            </div>
                            <span className="strength-text" style={{ color: pwdStrength.color }}>
                              {pwdStrength.label || '请输入密码'}
                            </span>
                          </div>

                          <Form.Item
                            name="confirmPassword"
                            dependencies={['password']}
                            rules={[
                              { required: true, message: '请确认密码' },
                              ({ getFieldValue }) => ({
                                validator(_, value) {
                                  if (!value || getFieldValue('password') === value) {
                                    return Promise.resolve()
                                  }
                                  return Promise.reject(new Error('两次输入的密码不一致'))
                                },
                              }),
                            ]}
                          >
                            <Input.Password
                              prefix={<LockOutlined className="input-icon" />}
                              placeholder="请确认密码"
                              size="large"
                              className="custom-input"
                            />
                          </Form.Item>

                          <Form.Item>
                            <Button
                              type="primary"
                              htmlType="submit"
                              loading={registerLoading}
                              block
                              size="large"
                              className="submit-btn"
                            >
                              完成注册
                            </Button>
                          </Form.Item>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Button type="link" onClick={() => {
                              setRegisterStep(1)
                              setRegisterCode('')
                            }}>
                              返回修改邮箱
                            </Button>
                            <Button
                              type="link"
                              disabled={codeCountdown > 0}
                              onClick={() => handleSendRegisterCode({ email: registerEmail })}
                            >
                              {codeCountdown > 0 ? `${codeCountdown}秒后重发` : '重新发送验证码'}
                            </Button>
                          </div>
                        </Form>
                      </>
                    )}

                    <div className="register-footer">
                      <span>已有账号？</span>
                      <Button type="link" onClick={() => handleTabChange('login')}>
                        立即登录
                      </Button>
                    </div>
                  </div>
                )
              }
            ]}
          />
        </div>
      </div>
    </div>
  )
}

export default Login
