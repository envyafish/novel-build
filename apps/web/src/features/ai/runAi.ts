import { consumeNdjson } from '../../api/stream.js'

/**
 * Fire a single /api/ai/complete request and accumulate the streamed text.
 * Returns the full assembled response. Throws on transport errors, non-2xx
 * status, or recoverable error frames from the server.
 */
export async function runAiCompletion(opts: {
  sceneId: number
  mode: string
  model: string
  inputText: string
  signal?: AbortSignal | null
}): Promise<string> {
  const res = await fetch('/api/ai/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sceneId: opts.sceneId,
      mode: opts.mode,
      model: opts.model,
      inputText: opts.inputText,
    }),
    ...(opts.signal ? { signal: opts.signal } : {}),
  })
  if (!res.ok || !res.body) throw new Error(`ai_http_${res.status}`)
  let full = ''
  for await (const e of consumeNdjson(res, opts.signal ?? undefined)) {
    if (e.kind === 'delta') {
      full += e.delta
    } else if (e.kind === 'error') {
      throw new Error(e.message)
    } else if (e.kind === 'done') {
      break
    }
  }
  return full
}