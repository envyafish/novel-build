import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { scanManuscripts } from './watcher.js'
import { writeManuscript } from './io.js'

describe('scanManuscripts', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'novel-watch-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('produces a hash map of every .md under the root', async () => {
    await writeManuscript(path.join(dir, 'v', 'c', 'a.md'), 'aaa')
    await writeManuscript(path.join(dir, 'v', 'c', 'b.md'), 'bbb')
    const map = await scanManuscripts(dir)
    expect(Object.keys(map).length).toBe(2)
  })

  it('returns empty when root missing', async () => {
    const map = await scanManuscripts(path.join(dir, 'nope'))
    expect(map).toEqual({})
  })
})
