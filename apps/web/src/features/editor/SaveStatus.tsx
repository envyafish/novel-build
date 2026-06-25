import { useEffect, useState } from 'react'
import { Check, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface Props {
  state: SaveState
  lastSavedAt?: number | undefined
  errorMessage?: string | undefined
}

export function SaveStatus({ state, lastSavedAt, errorMessage }: Props) {
  const [showSavedFlash, setShowSavedFlash] = useState(false)

  useEffect(() => {
    if (state !== 'saved') {
      setShowSavedFlash(false)
      return
    }
    setShowSavedFlash(true)
    const t = setTimeout(() => setShowSavedFlash(false), 1500)
    return () => clearTimeout(t)
  }, [state, lastSavedAt])

  if (state === 'saving') {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status" aria-live="polite">
        <Loader2 className="h-3 w-3 animate-spin" /> 保存中…
      </span>
    )
  }
  if (state === 'error') {
    return (
      <span className="flex items-center gap-1 text-xs text-destructive" title={errorMessage}>
        <AlertCircle className="h-3 w-3" /> 保存失败
      </span>
    )
  }
  if (state === 'saved' && showSavedFlash) {
    return (
      <span
        className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400"
        role="status"
        aria-live="polite"
      >
        <Check className="h-3 w-3" /> 已保存
      </span>
    )
  }
  if (state === 'idle' && lastSavedAt) {
    return <span className={cn('text-xs text-muted-foreground')}>已保存 · {timeAgo(lastSavedAt)}</span>
  }
  return null
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 5000) return '刚刚'
  if (diff < 60_000) return `${Math.floor(diff / 1000)} 秒前`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
