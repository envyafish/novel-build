import type { AiProvider, CompletionRequest, ProviderConfig } from '@novel/shared'

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
            if (delta) yield delta
          } catch {
            // ignore malformed line
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
}
