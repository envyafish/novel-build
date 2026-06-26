import { useCallback, useEffect, useRef, useState } from 'react'
import { consumeNdjson } from '../api/stream.js'
import type { StreamEvent } from '../api/stream.js'

export interface AiStreamState {
  text: string
  status: 'idle' | 'streaming' | 'done' | 'error'
  errorMessage?: string
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

/**
 * Stream consumer for `/api/ai/complete`.
 *
 * In-memory only: if the page refreshes mid-stream, the text in flight is
 * lost. Persistence + recovery used to live here (and on the server's
 * `ai_drafts` table) but were removed when the per-stream "recover banner"
 * UX was dropped — the project is moving toward a centralised AI task centre
 * instead, so persistence will be reintroduced at that level.
 */
export function useAiStream() {
  const [state, setState] = useState<AiStreamState>(INITIAL)
  const ctrl = useRef<AbortController | null>(null)
  const startedAt = useRef<number>(0)

  const start = useCallback(async (body: object) => {
    ctrl.current?.abort()
    const c = new AbortController()
    ctrl.current = c
    startedAt.current = Date.now()
    setState((s) => {
      const { errorMessage, ...rest } = s
      return { ...rest, text: '', status: 'streaming' as const, elapsedMs: 0, progressPct: 0 }
    })
    try {
      const res = await fetch('/api/ai/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
  }, [])

  const cancel = useCallback(async () => {
    ctrl.current?.abort()
    setState((s) => ({ ...s, status: 'idle' }))
  }, [])

  const reset = useCallback(() => setState(INITIAL), [])

  const accept = useCallback(async () => {
    setState((s) => ({ ...s, status: 'idle' as const }))
  }, [])

  // Tick elapsedMs while streaming.
  useEffect(() => {
    if (state.status !== 'streaming') return
    const t = setInterval(() => {
      setState((s) => ({ ...s, elapsedMs: Date.now() - startedAt.current }))
    }, 200)
    return () => clearInterval(t)
  }, [state.status])

  return { state, start, cancel, reset, accept }
}

function apply(e: StreamEvent, set: (updater: (s: AiStreamState) => AiStreamState) => void) {
  if (e.kind === 'meta') {
    set((s) => ({
      ...s,
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