import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { buildServer } from './server.js'

describe('server', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(tmpdir(), 'novel-test-'))
    process.env.NOVEL_HOME = tmp
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
    delete process.env.NOVEL_HOME
  })

  it('responds ok on /health', async () => {
    const { app } = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    await app.close()
  })
})
