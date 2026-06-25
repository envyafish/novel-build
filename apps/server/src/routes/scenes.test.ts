import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { buildServer } from '../server.js'

describe('routes /api/scenes', () => {
  let home: string
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(tmpdir(), 'novel-sc-'))
    process.env.NOVEL_HOME = home
  })
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    delete process.env.NOVEL_HOME
  })

  it('PUT /api/scenes/:id writes file and updates hash', async () => {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'X', slug: 'x' } })).json()
    const outline = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/outline` })).json()
    const c = outline.chapters[0]
    const s = (await app.inject({ method: 'POST', url: '/api/scenes', payload: { slug: 's1', title: 'S1', chapterId: c.id } })).json()
    const put = await app.inject({ method: 'PUT', url: `/api/scenes/${s.id}`, payload: { markdown: 'hello', baseHash: '' } })
    expect(put.statusCode).toBe(200)
    const get = (await app.inject({ method: 'GET', url: `/api/scenes/${s.id}` })).json()
    expect(get.markdown).toBe('hello')
    expect(get.contentHash.length).toBe(64)
    await app.close()
  })

  it('returns 422 when baseHash is stale', async () => {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'X', slug: 'x' } })).json()
    const outline = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/outline` })).json()
    const c = outline.chapters[0]
    const s = (await app.inject({ method: 'POST', url: '/api/scenes', payload: { slug: 's1', title: 'S1', chapterId: c.id } })).json()
    await app.inject({ method: 'PUT', url: `/api/scenes/${s.id}`, payload: { markdown: 'a', baseHash: '' } })
    const stale = await app.inject({ method: 'PUT', url: `/api/scenes/${s.id}`, payload: { markdown: 'b', baseHash: 'deadbeef' } })
    expect(stale.statusCode).toBe(422)
    expect(stale.json().code).toBe('external_change')
    await app.close()
  })
})
