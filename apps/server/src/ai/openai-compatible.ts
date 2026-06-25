import type { AiProvider, CompletionRequest, ProviderConfig } from '@novel/shared'

// Some OSS/reasoning models emit chain-of-thought inside the streamed content
// using <<think>...</think>> / <thinking>...</thinking> / <reasoning>...</reasoning>
// or 【思考】...【/思考】 wrappers. We strip these before yielding so the
// client only sees the final answer.
const THINKING_BLOCK_RE = /<think>[\s\S]*?<\/think>|<thinking>[\s\S]*?<\/thinking>|<reasoning>[\s\S]*?<\/reasoning>|【思考】[\s\S]*?【\/思考】/gi
const THINKING_OPENS = ['<think>', '<thinking>', '<reasoning>', '【思考】'] as const
const THINKING_CLOSES = ['</think>', '</thinking>', '</reasoning>', '【/思考】'] as const
const ALL_TAGS = [...THINKING_OPENS, ...THINKING_CLOSES] as const

function stripThinking(text: string): string {
  return text.replace(THINKING_BLOCK_RE, '')
}

// Compute the largest index `safeEnd` such that buffer[0..safeEnd] is safe to
// emit (i.e. cannot be part of a thinking block that might still be opening,
// continuing, or have its close tag split mid-way). Everything from safeEnd
// onward must be held back for the next delta.
function safePrefixLength(buffer: string): number {
  let safeEnd = buffer.length
  // 1. Partial opening or closing tag at the end of the buffer (split across deltas).
  for (const tag of ALL_TAGS) {
    for (let len = tag.length - 1; len >= 1; len--) {
      if (buffer.endsWith(tag.slice(0, len))) {
        safeEnd = Math.min(safeEnd, buffer.length - len)
        break
      }
    }
  }
  // 2. Full opening tag in buffer with no matching close yet.
  for (const open of THINKING_OPENS) {
    const openIdx = buffer.lastIndexOf(open)
    if (openIdx < 0) continue
    let closeIdx = -1
    for (const close of THINKING_CLOSES) {
      const idx = buffer.indexOf(close, openIdx + open.length)
      if (idx >= 0 && (closeIdx < 0 || idx < closeIdx)) closeIdx = idx
    }
    if (closeIdx < 0) safeEnd = Math.min(safeEnd, openIdx)
  }
  return safeEnd
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly id: string
  readonly label: string
  constructor(private cfg: ProviderConfig) {
    this.id = cfg.id
    this.label = cfg.label
  }

  async *complete(req: CompletionRequest): AsyncIterable<string> {
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
        stream: true,
      }),
    }
    if (req.signal) init.signal = req.signal
    const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, init)
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      throw new Error(`ai_http_${res.status}: ${text.slice(0, 200)}`)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let held = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trimEnd()
          buffer = buffer.slice(idx + 1)
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') return
          if (!payload) continue
          try {
            const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
            const delta = json.choices?.[0]?.delta?.content
            if (!delta) continue
            held += delta
            // Strip complete thinking blocks from the held buffer.
            held = held.replace(THINKING_BLOCK_RE, '')
            const safeEnd = safePrefixLength(held)
            if (safeEnd > 0) {
              const emit = held.slice(0, safeEnd)
              held = held.slice(safeEnd)
              if (emit) yield emit
            }
          } catch {
            // ignore malformed line
          }
        }
      }
      // End of stream: flush only the safe prefix. Anything still held that
      // looks like it's inside an unclosed thinking block is dropped.
      if (held) {
        const safeEnd = safePrefixLength(held)
        if (safeEnd > 0) yield held.slice(0, safeEnd)
      }
    } finally {
      reader.releaseLock()
    }
  }
}
