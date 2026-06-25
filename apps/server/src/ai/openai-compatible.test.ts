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

  // Helper: build an async iterable provider.run call against fake SSE deltas.
  async function runAgainst(sseChunks: string[]): Promise<string> {
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      sseResponse(sseChunks)) as typeof fetch
    try {
      const p = new OpenAiCompatibleProvider({ id: 'x', label: 'X', baseUrl: 'https://x', apiKey: 'k' })
      const out: string[] = []
      for await (const c of p.complete({ model: 'm', messages: [], stream: true })) out.push(c)
      return out.join('')
    } finally {
      globalThis.fetch = original
    }
  }

  function dataLine(content: string): string {
    return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
  }

  it('strips a complete <think>...</think> block', async () => {
    const text = await runAgainst([
      dataLine('<think>'),
      dataLine('let me think...'),
      dataLine('okay plan ready'),
      dataLine('</think>'),
      dataLine('{"title":"x"}'),
    ])
    expect(text).toBe('{"title":"x"}')
  })

  it('strips thinking when interleaved with content', async () => {
    const text = await runAgainst([
      dataLine('before'),
      dataLine('<think>hidden</think>'),
      dataLine('after'),
    ])
    expect(text).toBe('beforeafter')
  })

  it('handles a <think> block split across many deltas', async () => {
    // Realistic token-boundary splits — the provider must hold the partial
    // open and close tags until they complete, so the inner reasoning never leaks.
    const text = await runAgainst([
      dataLine('<think'),
      dataLine('>reasoning here'),
      dataLine('</thin'),
      dataLine('k>final'),
    ])
    expect(text).toBe('final')
  })

  it('strips multiple tag variants', async () => {
    const text = await runAgainst([
      dataLine('<thinking>t</thinking>'),
      dataLine('A'),
      dataLine('<reasoning>r</reasoning>'),
      dataLine('B'),
      dataLine('【思考】c【/思考】'),
      dataLine('C'),
    ])
    expect(text).toBe('ABC')
  })

  it('drops a thinking block whose close tag never arrives', async () => {
    // No </think> — the buffered tail is dropped at end-of-stream.
    const text = await runAgainst([
      dataLine('real content'),
      dataLine('<think>orphan thinking without close'),
    ])
    expect(text).toBe('real content')
  })
})
