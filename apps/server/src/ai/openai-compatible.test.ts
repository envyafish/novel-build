import { describe, it, expect } from 'vitest'
import { OpenAiCompatibleProvider } from './openai-compatible.js'

function sseResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder()
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('OpenAiCompatibleProvider', () => {
  it('parses SSE deltas', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      void init
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        'data: [DONE]\n\n',
      ])
    }) as typeof fetch
    try {
      const p = new OpenAiCompatibleProvider({ id: 'x', label: 'X', baseUrl: 'https://x', apiKey: 'k' })
      const out: string[] = []
      for await (const c of p.complete({ model: 'm', messages: [], stream: true })) out.push(c)
      expect(out.join('')).toBe('hello')
    } finally {
      globalThis.fetch = original
    }
  })
})
