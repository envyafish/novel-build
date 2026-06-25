import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { buildServer } from '../server.js'

describe('routes /api/ai/providers', () => {
  let home: string
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(tmpdir(), 'novel-ai-'))
    process.env.NOVEL_HOME = home
    process.env.NOVEL_NOVELS_DIR = path.join(home, 'Novels')
  })
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    delete process.env.NOVEL_HOME
    delete process.env.NOVEL_NOVELS_DIR
  })

  it('returns empty list when no providers configured', async () => {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const res = await app.inject({ method: 'GET', url: '/api/ai/providers' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
    await app.close()
  })

  it('marks the first added provider as default', async () => {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    await app.inject({
      method: 'POST',
      url: '/api/ai/providers',
      payload: { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: 'k' },
    })
    const list = await app.inject({ method: 'GET', url: '/api/ai/providers' }).then((r) => r.json())
    expect(list.length).toBe(1)
    expect(list[0].isDefault).toBe(true)
    await app.close()
  })

  it('moves the default when setDefault is called', async () => {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    await app.inject({
      method: 'POST',
      url: '/api/ai/providers',
      payload: { id: 'a', label: 'A', baseUrl: 'https://a.example/v1', apiKey: '' },
    })
    await app.inject({
      method: 'POST',
      url: '/api/ai/providers',
      payload: { id: 'b', label: 'B', baseUrl: 'https://b.example/v1', apiKey: '' },
    })
    await app.inject({ method: 'PUT', url: '/api/ai/providers/b/default' })
    const list = await app.inject({ method: 'GET', url: '/api/ai/providers' }).then((r) => r.json())
    const a = list.find((p: { id: string }) => p.id === 'a')
    const b = list.find((p: { id: string }) => p.id === 'b')
    expect(a.isDefault).toBe(false)
    expect(b.isDefault).toBe(true)
    await app.close()
  })
})
