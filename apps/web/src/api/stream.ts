export type StreamEvent =
  | { kind: 'meta'; maxOutputTokens: number }
  | { kind: 'delta'; delta: string }
  | { kind: 'done'; usage?: { promptTokens?: number; completionTokens?: number } }
  | { kind: 'error'; message: string; recoverable: boolean }

export async function* consumeNdjson(res: Response, signal?: AbortSignal): AsyncIterable<StreamEvent> {
  if (!res.ok || !res.body) throw new Error(`stream_http_${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  try {
    while (true) {
      if (signal?.aborted) return
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line) as Record<string, unknown>
          if (typeof obj.maxOutputTokens === 'number') {
            yield { kind: 'meta', maxOutputTokens: obj.maxOutputTokens }
          } else if (typeof obj.delta === 'string') {
            yield { kind: 'delta', delta: obj.delta }
          } else if (obj.done === true) {
            const u = obj.usage as { promptTokens?: number; completionTokens?: number } | undefined
            if (u) yield { kind: 'done', usage: u }
            else yield { kind: 'done' }
          }
          else if (typeof obj.error === 'string') yield { kind: 'error', message: obj.error, recoverable: obj.recoverable === true }
        } catch {
          // ignore
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
