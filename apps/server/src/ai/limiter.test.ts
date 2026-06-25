import { describe, it, expect } from 'vitest'
import { StreamLimiter } from './limiter.js'

describe('StreamLimiter', () => {
  it('queues beyond max and releases in order', async () => {
    const l = new StreamLimiter(1)
    await l.acquire()
    let acquired2 = false
    const p2 = l.acquire().then(() => { acquired2 = true })
    expect(acquired2).toBe(false)
    l.release()
    await p2
    expect(acquired2).toBe(true)
  })
})
