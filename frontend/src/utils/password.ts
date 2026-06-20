/**
 * 密码强度校验工具。
 * 规则：至少包含两种字符类型（小写字母 + 大写字母 + 数字 + 特殊符号），长度 8-20。
 */

/** 密码复杂度正则：至少包含两种不同类型的字符 */
export const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)|(?=.*[a-z])(?=.*[A-Z])(?=.*[@$!%*#?&])|(?=.*[a-z])(?=.*\d)(?=.*[@$!%*#?&])|(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*#?&])/

export type StrengthLevel = 'weak' | 'medium' | 'strong'

export interface StrengthInfo {
  level: StrengthLevel
  label: string
  color: string
  className: string
}

/** 检测密码强度并返回可视化信息 */
export function checkPasswordStrength(password: string): StrengthInfo {
  if (!password) return { level: 'weak', label: '', color: '#d9d9d9', className: '' }

  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[a-z]/.test(password)) score++
  if (/[A-Z]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[@$!%*#?&]/.test(password)) score++

  if (score >= 5) {
    return { level: 'strong', label: '安全', color: '#52c41a', className: 'strength-strong' }
  }
  if (score >= 3) {
    return { level: 'medium', label: '中等', color: '#faad14', className: 'strength-medium' }
  }
  return { level: 'weak', label: '弱', color: '#ff4d4f', className: 'strength-weak' }
}
