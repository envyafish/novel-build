import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { writeManuscript, readManuscript } from './io.js'
import { sha256 } from './hash.js'

describe('manuscripts io', () => {
  let dir: string
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(tmpdir(), 'novel-io-')); })
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); })

  it('writes and reads a manuscript with consistent hash', async () => {
    const p = path.join(dir, 'vol-1', 'ch-1', 'sc-1.md')
    const h = await writeManuscript(p, 'hello world')
    expect(h).toBe(sha256('hello world'))
    const r = await readManuscript(p)
    expect(r.text).toBe('hello world')
    expect(r.hash).toBe(h)
  })

  it('readManuscript on missing file returns empty + empty hash', async () => {
    const p = path.join(dir, 'missing.md')
    const r = await readManuscript(p)
    expect(r.text).toBe('')
    expect(r.hash).toBe(sha256(''))
  })
})
