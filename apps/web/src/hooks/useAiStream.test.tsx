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
          '{"maxOutputTokens":800}\n{"delta":"hi"}\n{"done":true,"usage":{"promptTokens":50,"completionTokens":10}}\n',
        ),
      ) as typeof fetch,
    )
    const { result } = renderHook(() => useAiStream())
    await act(async () => {
      await result.current.start({})
    })
    expect(result.current.state.text).toBe('hi')
    expect(result.current.state.status).toBe('done')
    expect(result.current.state.maxOutputTokens).toBe(800)
    expect(result.current.state.usage?.promptTokens).toBe(50)
    expect(result.current.state.usage?.completionTokens).toBe(10)
  })

  it('streams delta progressively updates text', async () => {
    const streamChunks = [
      '{"maxOutputTokens":100}\n',
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
  })

  it('cancel resets to idle', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeStreamResponse('{"maxOutputTokens":800}\n{"delta":"x"}\n')) as typeof fetch,
    )
    const { result } = renderHook(() => useAiStream())
    await act(async () => {
      await result.current.start({})
    })
    act(() => {
      result.current.cancel()
    })
    expect(result.current.state.status).toBe('idle')
  })

  it('accept transitions status to idle', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        makeStreamResponse('{"maxOutputTokens":800}\n{"delta":"ok"}\n{"done":true}\n'),
      ) as typeof fetch,
    )
    const { result } = renderHook(() => useAiStream())
    await act(async () => {
      await result.current.start({})
    })
    await act(async () => {
      await result.current.accept()
    })
    expect(result.current.state.status).toBe('idle')
  })
})