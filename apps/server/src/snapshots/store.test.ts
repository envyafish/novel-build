import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { writeObject, readObject } from './store.js'

describe('snapshot store', () => {
  let dir: string
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(tmpdir(), 'novel-snap-')); })
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); })

  it('round-trips a string and deduplicates', async () => {
    const h1 = await writeObject(dir, 'hello')
    const h2 = await writeObject(dir, 'hello')
    expect(h1).toBe(h2)
    expect(await readObject(dir, h1)).toBe('hello')
  })
})
