import { describe, it, expect } from 'vitest'
import { consumeNdjson } from './stream.js'

function makeResponse(body: string, status = 200): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(body))
        c.close()
      },
    }),
    { status },
  )
}

describe('consumeNdjson', () => {
  it('parses deltas and done', async () => {
    const res = makeResponse('{"delta":"a"}\n{"delta":"b"}\n{"done":true}\n')
    const out: string[] = []
    let done = false
    for await (const e of consumeNdjson(res)) {
      if (e.kind === 'delta') out.push(e.delta)
      if (e.kind === 'done') done = true
    }
    expect(out.join('')).toBe('ab')
    expect(done).toBe(true)
  })

  it('parses recoverable error', async () => {
    const res = makeResponse('{"error":"oops","recoverable":true}\n')
    const events = []
    for await (const e of consumeNdjson(res)) events.push(e)
    expect(events[0]).toMatchObject({ kind: 'error', recoverable: true })
  })
})
