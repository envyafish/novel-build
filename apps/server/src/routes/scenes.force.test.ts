import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { buildServer } from '../server.js'

describe('routes /api/scenes with force=true', () => {
  let home: string
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(tmpdir(), 'novel-force-'))
    process.env.NOVEL_HOME = home
    process.env.NOVEL_NOVELS_DIR = path.join(home, 'Novels')
  })
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    delete process.env.NOVEL_HOME
    delete process.env.NOVEL_NOVELS_DIR
  })

  it('PUT /api/scenes/:id with force=true bypasses baseHash guard', async () => {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'X', slug: 'x' } })).json()
    const outline = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/outline` })).json()
    const c = outline.chapters[0]
    const s = (await app.inject({ method: 'POST', url: '/api/scenes', payload: { slug: 's1', title: 'S1', chapterId: c.id } })).json()
    // First save with no guard
    await app.inject({ method: 'PUT', url: `/api/scenes/${s.id}`, payload: { markdown: 'a', baseHash: '' } })
    // Pretend client baseHash is wrong, but pass force=true
    const res = await app.inject({
      method: 'PUT',
      url: `/api/scenes/${s.id}`,
      payload: { markdown: 'b overwritten', baseHash: 'deadbeef', force: true },
    })
    expect(res.statusCode).toBe(200)
    const get = (await app.inject({ method: 'GET', url: `/api/scenes/${s.id}` })).json()
    expect(get.markdown).toBe('b overwritten')
    await app.close()
  })

  it('PUT /api/scenes/:id without force still returns 422 on stale baseHash', async () => {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'X', slug: 'x' } })).json()
    const outline = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/outline` })).json()
    const c = outline.chapters[0]
    const s = (await app.inject({ method: 'POST', url: '/api/scenes', payload: { slug: 's1', title: 'S1', chapterId: c.id } })).json()
    await app.inject({ method: 'PUT', url: `/api/scenes/${s.id}`, payload: { markdown: 'a', baseHash: '' } })
    const res = await app.inject({
      method: 'PUT',
      url: `/api/scenes/${s.id}`,
      payload: { markdown: 'b', baseHash: 'wrong' },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('external_change')
    await app.close()
  })
})