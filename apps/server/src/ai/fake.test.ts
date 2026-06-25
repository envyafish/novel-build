import { describe, it, expect } from 'vitest'
import { FakeAiProvider } from './fake.js'

describe('FakeAiProvider', () => {
  it('emits the configured response in chunks', async () => {
    const p = new FakeAiProvider({ response: 'abcdef', chunkSize: 2 })
    const out: string[] = []
    for await (const c of p.complete({ model: 'm', messages: [], stream: true })) out.push(c)
    expect(out.join('')).toBe('abcdef')
  })

  it('honors abort signal', async () => {
    const p = new FakeAiProvider({ response: 'longlonglong', delayMs: 5, chunkSize: 1 })
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 5)
    const out: string[] = []
    for await (const c of p.complete({ model: 'm', messages: [], stream: true, signal: ctrl.signal })) out.push(c)
    expect(out.length).toBeLessThan(12)
  })
})
