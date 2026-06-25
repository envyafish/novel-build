import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { buildServer } from '../server.js'

describe('routes /api/projects', () => {
  let home: string
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(tmpdir(), 'novel-routes-'))
    process.env.NOVEL_HOME = home
  })
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    delete process.env.NOVEL_HOME
  })

  it('creates and lists a project', async () => {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const created = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'My Novel', slug: 'my-novel' } })
    expect(created.statusCode).toBe(200)
    const list = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(list.json().length).toBe(1)
    await app.close()
  })
})
