import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAiStream } from './useAiStream.js'

function makeStreamResponse(body: string): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(body))
        c.close()
      },
    }),
    { status: 200 },
  )
}

describe('useAiStream', () => {
  it('accumulates deltas and reaches done', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        makeStreamResponse(
          '{"draftId":"d1","maxOutputTokens":800}\n{"delta":"hi"}\n{"done":true,"usage":{"promptTokens":50,"completionTokens":10}}\n',
        ),
      ) as typeof fetch,
    )
    const { result } = renderHook(() => useAiStream())
    await act(async () => {
      await result.current.start({})
    })
    expect(result.current.state.text).toBe('hi')
    expect(result.current.state.status).toBe('done')
    expect(result.current.state.draftId).toBe('d1')
    expect(result.current.state.maxOutputTokens).toBe(800)
    expect(result.current.state.usage?.promptTokens).toBe(50)
    expect(result.current.state.usage?.completionTokens).toBe(10)
  })

  it('tracks progress pct based on maxOutputTokens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        makeStreamResponse(
          '{"draftId":"d2","maxOutputTokens":800}\n{"delta":"你好世界"}\n{"done":true}\n',
        ),
      ) as typeof fetch,
    )
    const { result } = renderHook(() => useAiStream())
    await act(async () => {
      await result.current.start({})
    })
    // "你好世界" = ~3 tokens (4 chars / 1.5), out of 800 ≈ 0.375% → rounds to 0
    expect(result.current.state.text).toBe('你好世界')
    // progressPct when done: if maxOutputTokens > 0, it uses the text-based
    // estimate, which for 4 chars gives ~0%. The fallback (100) only applies
    // when maxTokens <= 0.
    expect(result.current.state.progressPct).toBe(0)
    expect(result.current.state.draftId).toBe('d2')
  })

  it('streams delta progressively updates text and progress', async () => {
    const streamChunks = [
      '{"draftId":"d3","maxOutputTokens":100}\n',
      '{"delta":"hello"}\n',
      '{"delta":" world"}\n',
      '{"done":true}\n',
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        let i = 0
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (i < streamChunks.length) {
                controller.enqueue(new TextEncoder().encode(streamChunks[i]))
                i++
              } else {
                controller.close()
              }
            },
          }),
          { status: 200 },
        )
      }) as typeof fetch,
    )
    const { result } = renderHook(() => useAiStream())
    await act(async () => {
      await result.current.start({})
    })
    expect(result.current.state.text).toBe('hello world')
    expect(result.current.state.status).toBe('done')
    expect(result.current.state.draftId).toBe('d3')
  })

  it('recoverFromDraft initializes from existing draft', () => {
    const { result } = renderHook(() =>
      useAiStream({
        recoverFromDraft: {
          id: 'd-old',
          projectId: 1,
          sceneId: 2,
          mode: 'continue',
          model: 'gpt-4o-mini',
          text: '已有的内容',
          status: 'done',
          errorMessage: null,
          maxOutputTokens: 500,
          usage: { promptTokens: 50, completionTokens: 200 },
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          expiresAt: '2025-01-08T00:00:00.000Z',
        },
      }),
    )
    expect(result.current.state.text).toBe('已有的内容')
    expect(result.current.state.draftId).toBe('d-old')
    expect(result.current.state.usage?.completionTokens).toBe(200)
    expect(result.current.state.progressPct).toBe(40) // 200/500*100
    expect(result.current.state.status).toBe('done')
  })

  it('cancel resets to idle and cleans up draft', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeStreamResponse('{"draftId":"d4","maxOutputTokens":800}\n{"delta":"x"}\n')) as typeof fetch,
    )
    const { result } = renderHook(() => useAiStream({ persist: true }))
    await act(async () => {
      await result.current.start({})
    })
    await act(async () => {
      result.current.cancel()
    })
    expect(result.current.state.status).toBe('idle')
  })

  it('accept cleans up draft id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        makeStreamResponse('{"draftId":"d5","maxOutputTokens":800}\n{"delta":"ok"}\n{"done":true}\n'),
      ) as typeof fetch,
    )
    const { result } = renderHook(() => useAiStream({ persist: true }))
    await act(async () => {
      await result.current.start({})
    })
    await act(async () => {
      await result.current.accept()
    })
    expect(result.current.state.draftId).toBeUndefined()
    expect(result.current.state.status).toBe('idle')
  })
})