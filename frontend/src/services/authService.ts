import api from './api'
import { useAuthStore } from '../stores/authStore'

export interface LoginResponse {
  access_token: string
  refresh_token: string
  is_admin: boolean
}

export interface UserResponse {
  id: number
  email: string
  nickname: string | null
  is_admin: boolean
  is_active: boolean
  avatar_url: string | null
  created_at: string
}

export interface ForgotPasswordResponse {
  status: string
  message: string
}

export const authService = {
  async register(email: string, password: string, verificationCode: string, nickname?: string): Promise<UserResponse> {
    const response = await api.post('/auth/register', {
      email,
      password,
      nickname,
      verification_code: verificationCode,
    })
    return response.data
  },

  async checkEmail(email: string): Promise<{ exists: boolean; domain_valid: boolean; error_message: string | null }> {
    const response = await api.post('/auth/check-email', { email })
    return response.data
  },

  async registerSendCode(email: string): Promise<ForgotPasswordResponse> {
    const response = await api.post('/auth/register/send-code', { email })
    return response.data
  },
  
  async login(email: string, password: string, rememberMe: boolean = false): Promise<LoginResponse> {
    const response = await api.post('/auth/login', {
      email,
      password,
      remember_me: rememberMe
    })
    
    const { access_token, is_admin } = response.data
    
    useAuthStore.getState().setAuth(access_token, {
      id: 0,
      email: email,
      nickname: null,
      isAdmin: is_admin
    })
    
    return response.data
  },
  
  async refreshToken(): Promise<{ access_token: string }> {
    const response = await api.post('/auth/refresh', {}, {
      withCredentials: true
    })
    return response.data
  },
  
  async getCurrentUser(): Promise<UserResponse> {
    const response = await api.get('/auth/me')
    return response.data
  },
  
  async updateProfile(data: { nickname?: string }): Promise<UserResponse> {
    const response = await api.put('/auth/me', data)
    return response.data
  },

  async changeEmailSendCode(newEmail: string): Promise<ForgotPasswordResponse> {
    const response = await api.post('/auth/me/change-email/send-code', { new_email: newEmail })
    return response.data
  },

  async changeEmailVerify(newEmail: string, verificationCode: string): Promise<UserResponse> {
    const response = await api.post('/auth/me/change-email/verify', {
      new_email: newEmail,
      verification_code: verificationCode,
    })
    return response.data
  },

  async uploadAvatar(file: File): Promise<{ avatar_url: string }> {
    const formData = new FormData()
    formData.append('file', file)
    const response = await api.post('/auth/me/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return response.data
  },

  async forgotPasswordSendCode(email: string): Promise<ForgotPasswordResponse> {
    const response = await api.post('/auth/forgot-password/send-code', {
      email
    })
    return response.data
  },
  
  async forgotPasswordResetWithCode(email: string, verificationCode: string, newPassword: string): Promise<ForgotPasswordResponse> {
    const response = await api.post('/auth/forgot-password/reset-with-code', {
      email,
      verification_code: verificationCode,
      new_password: newPassword
    })
    return response.data
  }
}
