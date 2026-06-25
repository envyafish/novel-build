import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastKind = 'info' | 'success' | 'error' | 'warning'

export interface Toast {
  id: string
  kind: ToastKind
  title: string
  description?: string
  durationMs?: number
}

export interface ToastInput {
  kind?: ToastKind
  title: string
  description?: string
  durationMs?: number
}

interface ToastContextValue {
  toast: (input: ToastInput) => void
  dismiss: (id: string) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

const KIND_STYLES: Record<ToastKind, string> = {
  info: 'border-border bg-background',
  success: 'border-green-600/40 bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-100',
  error: 'border-destructive/50 bg-destructive/10 text-destructive',
  warning: 'border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100',
}

const KIND_LABEL: Record<ToastKind, string> = {
  info: '提示',
  success: '成功',
  error: '错误',
  warning: '注意',
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])
  const timers = React.useRef<Record<string, NodeJS.Timeout>>({})

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    clearTimeout(timers.current[id])
    delete timers.current[id]
  }, [])

  const toast = React.useCallback(
    (input: ToastInput) => {
      const id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
      const t: Toast = {
        id,
        kind: input.kind ?? 'info',
        title: input.title,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      }
      setToasts((prev) => [...prev, t])
      const duration = input.durationMs ?? 4000
      if (duration > 0) {
        timers.current[id] = setTimeout(() => dismiss(id), duration)
      }
    },
    [dismiss],
  )

  React.useEffect(() => {
    const refs = timers.current
    return () => {
      for (const id of Object.keys(refs)) clearTimeout(refs[id])
    }
  }, [])

  const value = React.useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-start gap-2 rounded-lg border p-3 shadow-lg backdrop-blur',
              KIND_STYLES[t.kind],
            )}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">
                <span className="mr-1 text-xs uppercase tracking-wide opacity-70">{KIND_LABEL[t.kind]}</span>
                {t.title}
              </p>
              {t.description && <p className="mt-0.5 text-xs opacity-80">{t.description}</p>}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
