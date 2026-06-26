import { useCallback } from 'react'
import { useToast } from '@/components/ui/toast'
import { ApiClientError } from '../api/client.js'

/**
 * Standardized error-to-toast conversion. Use this everywhere we currently
 * write `toast({ kind: 'error', title: '<X>失败', description: msg })` —
 * the call site shrinks to a single `showError(err, '<X>失败')` and the
 * title/description conventions stay consistent across the app.
 *
 * Also:
 * - Logs to `console.error` with a labeled prefix so dev tools show context.
 * - For `ApiClientError`, surfaces the `code` and `hint` fields when the
 *   caller hasn't supplied a custom description (so users see actionable
 *   hints like "choose a different slug" instead of just the HTTP code).
 */
export function useErrorToast() {
  const { toast } = useToast()

  const showError = useCallback(
    (err: unknown, title: string, opts?: { description?: string; durationMs?: number }) => {
      let description = opts?.description
      if (!description) {
        if (err instanceof ApiClientError) {
          // Prefer the server-supplied hint over the raw message — hints are
          // already user-actionable ("choose a different slug", "reload the
          // scene") whereas messages can be jargon.
          description = err.hint ?? (err.code ? `${err.code}: ${err.message}` : err.message)
        } else if (err instanceof Error) {
          description = err.message
        } else {
          description = String(err)
        }
      }
      console.error(`[${title}]`, err)
      toast({
        kind: 'error',
        title,
        description,
        ...(opts?.durationMs !== undefined ? { durationMs: opts.durationMs } : {}),
      })
    },
    [toast],
  )

  return { showError }
}