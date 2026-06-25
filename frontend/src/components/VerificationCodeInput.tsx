import { useRef, useCallback, KeyboardEvent, ClipboardEvent } from 'react'
import './VerificationCodeInput.css'

interface VerificationCodeInputProps {
  value: string
  onChange: (code: string) => void
  disabled?: boolean
}

const DIGIT_COUNT = 6
/** 空格占位符，用于保留已删除位置的空位，防止 join 时字符左移 */
const EMPTY = ' '

/**
 * 清洗验证码：去除空格占位符，得到纯数字字符串。
 * 父组件在校验和 API 调用前应使用此函数。
 */
export const cleanCode = (code: string): string => code.replace(/\s/g, '')

function VerificationCodeInput({ value, onChange, disabled = false }: VerificationCodeInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  /** 将 value 展开为固定 6 位的数组，空位填充 EMPTY */
  const digits = value.padEnd(DIGIT_COUNT, EMPTY).split('').slice(0, DIGIT_COUNT)

  const focusInput = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(DIGIT_COUNT - 1, index))
    inputRefs.current[clamped]?.focus()
  }, [])

  /**
   * 将内部字符数组转换为传给外部的 value 字符串：
   * join 后去除尾部占位符，保留中间的空位标记。
   */
  const charsToValue = (chars: string[]): string => {
    return chars.join('').replace(new RegExp(EMPTY + '+$'), '')
  }

  const handleChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '')
    // 处理粘贴多个字符的场景
    if (raw.length > 1) {
      handlePaste(raw)
      return
    }
    // 空值（包括全被过滤的非数字字符）由 handleKeyDown 处理 Backspace/Delete
    if (raw.length === 0) return

    // 展开为固定 6 位数组以确保位置对应
    const chars = value.padEnd(DIGIT_COUNT, EMPTY).split('')
    // 防御竞态条件：输入值与当前位置已有值相同，跳过
    if (raw === chars[index]) return

    chars[index] = raw
    const newValue = charsToValue(chars)
    onChange(newValue)

    // 自动跳到下一个框
    if (index < DIGIT_COUNT - 1) {
      focusInput(index + 1)
    }
  }

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      const chars = value.padEnd(DIGIT_COUNT, EMPTY).split('')

      if (e.key === 'Delete') {
        // Delete：清除当前框，焦点不移动
        if (chars[index] !== EMPTY) {
          chars[index] = EMPTY
          onChange(charsToValue(chars))
        }
        return
      }

      // Backspace：清除当前框；若当前为空则跳回并清除前一个
      if (chars[index] !== EMPTY) {
        chars[index] = EMPTY
        onChange(charsToValue(chars))
      } else if (index > 0) {
        chars[index - 1] = EMPTY
        onChange(charsToValue(chars))
        focusInput(index - 1)
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (index > 0) focusInput(index - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (index < DIGIT_COUNT - 1) focusInput(index + 1)
    }
  }

  const handlePaste = (raw: string) => {
    const pureDigits = raw.replace(/\D/g, '').slice(0, DIGIT_COUNT)
    if (pureDigits.length === 0) return
    // 将粘贴的数字按顺序填入各位置，剩余位留空
    const chars = Array.from({ length: DIGIT_COUNT }, (_, i) => pureDigits[i] || EMPTY)
    onChange(charsToValue(chars))
    // 焦点跳到最后一个已填充的框或末尾
    const lastIndex = Math.min(pureDigits.length, DIGIT_COUNT) - 1
    focusInput(lastIndex)
  }

  const handlePasteEvent = (_index: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pasted = e.clipboardData?.getData('text') || ''
    if (pasted) handlePaste(pasted)
  }

  return (
    <div className="otp-container">
      {Array.from({ length: DIGIT_COUNT }, (_, i) => (
        <input
          key={i}
          ref={(el) => { inputRefs.current[i] = el }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}  // 允许粘贴多个字符，onChange 中处理
          className={`otp-box ${digits[i] !== EMPTY ? 'otp-box--filled' : ''}`}
          value={digits[i] === EMPTY ? '' : digits[i]}
          disabled={disabled}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePasteEvent(i, e)}
          aria-label={`验证码第 ${i + 1} 位`}
        />
      ))}
    </div>
  )
}

export default VerificationCodeInput
