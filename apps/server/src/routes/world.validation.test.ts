import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { buildServer } from '../server.js'

describe('world routes require existing projectId', () => {
  let home: string
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(tmpdir(), 'novel-world-val-'))
    process.env.NOVEL_HOME = home
    process.env.NOVEL_NOVELS_DIR = path.join(home, 'Novels')
  })
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    delete process.env.NOVEL_HOME
    delete process.env.NOVEL_NOVELS_DIR
  })

  const collections = [
    { name: 'characters', url: '/api/projects/99999/characters', body: { name: 'x' } },
    { name: 'world-elements', url: '/api/projects/99999/world-elements', body: { name: 'x' } },
    { name: 'timeline', url: '/api/projects/99999/timeline', body: { title: 'x' } },
    { name: 'foreshadows', url: '/api/projects/99999/foreshadows', body: { title: 'x' } },
    { name: 'conflicts', url: '/api/projects/99999/conflicts', body: { title: 'x' } },
  ] as const

  for (const c of collections) {
    it(`POST ${c.name} returns 404 for missing project`, async () => {
      const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
      const res = await app.inject({ method: 'POST', url: c.url, payload: c.body })
      expect(res.statusCode).toBe(404)
      expect(res.json().code).toBe('project_not_found')
      await app.close()
    })

    it(`GET ${c.name} returns 404 for missing project`, async () => {
      const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
      const res = await app.inject({ method: 'GET', url: c.url })
      expect(res.statusCode).toBe(404)
      expect(res.json().code).toBe('project_not_found')
      await app.close()
    })
  }

  it('GET world-summary returns 404 for missing project', async () => {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const res = await app.inject({ method: 'GET', url: '/api/projects/99999/world-summary' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('happy path: POST character succeeds for a real project', async () => {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'X', slug: 'x' } })).json()
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${p.id}/characters`,
      payload: { name: '李逍遥' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('李逍遥')
    await app.close()
  })
})