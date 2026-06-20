import { useRef, useCallback, KeyboardEvent, ClipboardEvent } from 'react'
import './VerificationCodeInput.css'

interface VerificationCodeInputProps {
  value: string
  onChange: (code: string) => void
  disabled?: boolean
}

const DIGIT_COUNT = 6

function VerificationCodeInput({ value, onChange, disabled = false }: VerificationCodeInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const digits = value.padEnd(DIGIT_COUNT, '').split('').slice(0, DIGIT_COUNT)

  const focusInput = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(DIGIT_COUNT - 1, index))
    inputRefs.current[clamped]?.focus()
  }, [])

  const handleChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '')
    // 处理粘贴多个字符的场景
    if (raw.length > 1) {
      handlePaste(raw)
      return
    }
    if (raw.length === 0) return // 空值不处理（由 keyDown 处理 backspace）

    const chars = value.split('')
    chars[index] = raw
    const newValue = chars.join('').slice(0, DIGIT_COUNT)
    onChange(newValue)

    // 自动跳到下一个框
    if (index < DIGIT_COUNT - 1) {
      focusInput(index + 1)
    }
  }

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault()
      const chars = value.split('')
      if (chars[index]) {
        // 当前框有值 → 清除当前框
        chars[index] = ''
        onChange(chars.join('').slice(0, DIGIT_COUNT))
      } else if (index > 0) {
        // 当前框为空 → 跳回上一个框并清除
        chars[index - 1] = ''
        onChange(chars.join('').slice(0, DIGIT_COUNT))
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
    const digits = raw.replace(/\D/g, '').slice(0, DIGIT_COUNT)
    if (digits.length === 0) return
    onChange(digits.padEnd(DIGIT_COUNT, '').slice(0, DIGIT_COUNT))
    // 焦点跳到最后一个已填充的框或最末尾
    const lastIndex = Math.min(digits.length, DIGIT_COUNT) - 1
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
          className={`otp-box ${digits[i] ? 'otp-box--filled' : ''}`}
          value={digits[i]}
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
