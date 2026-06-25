import { useCallback, useEffect, useRef, useState } from 'react'
import { consumeNdjson } from '../api/stream.js'
import type { StreamEvent } from '../api/stream.js'
import { draftsApi, type DraftDto } from '../features/ai/draftsApi.js'

export interface AiStreamState {
  text: string
  status: 'idle' | 'streaming' | 'done' | 'error'
  errorMessage?: string
  draftId?: string
  usage?: { promptTokens: number; completionTokens: number }
  maxOutputTokens: number
  /** ms elapsed since the current run started; 0 when idle. */
  elapsedMs: number
  /** Estimated progress 0..100 based on completion tokens vs maxOutputTokens. */
  progressPct: number
}

const INITIAL: AiStreamState = {
  text: '',
  status: 'idle',
  maxOutputTokens: 0,
  elapsedMs: 0,
  progressPct: 0,
}

export interface AiStreamOptions {
  /**
   * Persist this run to a draft row. When true, a draft is created on start
   * (or reused if `recoverFromDraft` is provided) and the accumulated text
   * is kept server-side so the user can recover after a page refresh.
   */
  persist?: boolean
  /** If set, reattach to an existing draft and resume from its text. */
  recoverFromDraft?: DraftDto
}

export function useAiStream(opts: AiStreamOptions = {}) {
  const { persist = false, recoverFromDraft } = opts
  const [state, setState] = useState<AiStreamState>(() => {
    if (recoverFromDraft) {
      return {
        text: recoverFromDraft.text,
        status: recoverFromDraft.status === 'streaming' ? 'streaming' : (recoverFromDraft.status as AiStreamState['status']),
        draftId: recoverFromDraft.id,
        usage: recoverFromDraft.usage,
        maxOutputTokens: recoverFromDraft.maxOutputTokens,
        elapsedMs: 0,
        progressPct: progressFromUsage(recoverFromDraft),
      }
    }
    return INITIAL
  })
  const ctrl = useRef<AbortController | null>(null)
  const startedAt = useRef<number>(0)

  const start = useCallback(
    async (body: object) => {
      ctrl.current?.abort()
      const c = new AbortController()
      ctrl.current = c
      startedAt.current = Date.now()
      const opts = { ...body, ...(state.draftId ? { draftId: state.draftId } : {}) } as Record<string, unknown>
      setState((s) => {
        const { errorMessage, ...rest } = s
        return { ...rest, text: '', status: 'streaming' as const, elapsedMs: 0, progressPct: 0 }
      })
      try {
        const res = await fetch('/api/ai/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(opts),
          signal: c.signal,
        })
        for await (const e of consumeNdjson(res, c.signal)) {
          apply(e, setState)
          if (e.kind === 'done' || e.kind === 'error') break
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setState({ text: '', status: 'error', errorMessage: (e as Error).message, maxOutputTokens: 0, elapsedMs: 0, progressPct: 0 })
      }
    },
    [state.draftId],
  )

  const cancel = useCallback(async () => {
    ctrl.current?.abort()
    // Best-effort cleanup of the persisted draft if the user cancels.
    setState((s) => {
      if (s.draftId && persist) {
        draftsApi.remove(s.draftId).catch(() => {})
      }
      return { ...s, status: 'idle' }
    })
  }, [persist])

  const reset = useCallback(() => setState(INITIAL), [])

  const accept = useCallback(async () => {
    // User accepted the generated text — drop the draft so the next run starts fresh.
    setState((s) => {
      if (s.draftId) draftsApi.remove(s.draftId).catch(() => {})
      const { draftId: _, ...rest } = s
      return { ...rest, status: 'idle' as const }
    })
  }, [])

  // Tick elapsedMs while streaming.
  useEffect(() => {
    if (state.status !== 'streaming') return
    const t = setInterval(() => {
      setState((s) => ({ ...s, elapsedMs: Date.now() - startedAt.current }))
    }, 200)
    return () => clearInterval(t)
  }, [state.status])

  // Persist (POST /api/ai/drafts) right when start() is invoked.
  useEffect(() => {
    if (!persist) return
    if (state.status !== 'streaming') return
    if (state.draftId) return
    // No draft yet — try to create one lazily so the server can persist deltas.
    // The server itself creates a draft when /complete is called, so this is mostly
    // a no-op safety net for cases where the server response hasn't arrived yet.
  }, [persist, state.status, state.draftId])

  return { state, start, cancel, reset, accept }
}

function apply(e: StreamEvent, set: (updater: (s: AiStreamState) => AiStreamState) => void) {
  if (e.kind === 'meta') {
    set((s) => ({
      ...s,
      draftId: e.draftId,
      maxOutputTokens: e.maxOutputTokens,
      progressPct: progressPct(s.text, s.maxOutputTokens || e.maxOutputTokens),
    }))
  } else if (e.kind === 'delta') {
    set((s) => {
      const text = s.text + e.delta
      return {
        ...s,
        text,
        progressPct: progressPct(text, s.maxOutputTokens),
      }
    })
  } else if (e.kind === 'done') {
    set((s) => ({
      ...s,
      status: 'done',
      ...(e.usage ? { usage: { promptTokens: e.usage.promptTokens ?? 0, completionTokens: e.usage.completionTokens ?? 0 } } : {}),
      progressPct: progressPct(s.text, s.maxOutputTokens, /* fallback */ 100),
    }))
  } else if (e.kind === 'error') {
    set((s) => ({ ...s, status: 'error', errorMessage: e.message }))
  }
}

function progressPct(text: string, maxTokens: number, fallback = 0): number {
  if (maxTokens > 0) {
    const estTokens = Math.ceil(text.length / 1.5)
    return Math.min(100, Math.round((estTokens / maxTokens) * 100))
  }
  return fallback
}

function progressFromUsage(d: DraftDto): number {
  if (d.maxOutputTokens > 0 && d.usage.completionTokens > 0) {
    return Math.min(100, Math.round((d.usage.completionTokens / d.maxOutputTokens) * 100))
  }
  if (d.maxOutputTokens > 0) {
    return progressPct(d.text, d.maxOutputTokens)
  }
  return 0
}