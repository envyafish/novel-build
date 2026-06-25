import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { buildServer } from '../server.js'

describe('snapshot routes', () => {
  let home: string
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(tmpdir(), 'novel-snap-'))
    process.env.NOVEL_HOME = home
    process.env.NOVEL_NOVELS_DIR = path.join(home, 'Novels')
  })
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    delete process.env.NOVEL_HOME
    delete process.env.NOVEL_NOVELS_DIR
  })

  async function makeScene() {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'T', slug: 't' } })).json()
    const outline = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/outline` })).json()
    const c = outline.chapters[0]
    const s = (await app.inject({ method: 'POST', url: '/api/scenes', payload: { slug: 'sc', title: 'S', chapterId: c.id } })).json()
    await app.inject({ method: 'PUT', url: `/api/scenes/${s.id}`, payload: { markdown: '你好世界', baseHash: '' } })
    return { app, sceneId: s.id }
  }

  it('POST /api/scenes/:id/snapshot creates a manual snapshot', async () => {
    const { app, sceneId } = await makeScene()
    const res = await app.inject({ method: 'POST', url: `/api/scenes/${sceneId}/snapshot` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.kind).toBe('manual')
    expect(body.hash.length).toBe(64)
    await app.close()
  })

  it('POST /api/scenes/:id/snapshot returns 422 for empty scene', async () => {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'T', slug: 't' } })).json()
    const outline = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/outline` })).json()
    const c = outline.chapters[0]
    const s = (await app.inject({ method: 'POST', url: '/api/scenes', payload: { slug: 'sc', title: 'S', chapterId: c.id } })).json()
    const res = await app.inject({ method: 'POST', url: `/api/scenes/${s.id}/snapshot` })
    expect(res.statusCode).toBe(422)
    await app.close()
  })

  it('GET /api/scenes/:id/snapshots lists snapshots including manual', async () => {
    const { app, sceneId } = await makeScene()
    await app.inject({ method: 'POST', url: `/api/scenes/${sceneId}/snapshot` })
    const res = await app.inject({ method: 'GET', url: `/api/scenes/${sceneId}/snapshots` })
    expect(res.statusCode).toBe(200)
    const list = res.json()
    expect(list.length).toBeGreaterThan(0)
    expect(list.some((s: { kind: string }) => s.kind === 'manual')).toBe(true)
    await app.close()
  })

  it('POST /api/scenes/:id/snapshots/:hash/restore restores content', async () => {
    const { app, sceneId } = await makeScene()
    const snap = (await app.inject({ method: 'POST', url: `/api/scenes/${sceneId}/snapshot` })).json()
    await app.inject({ method: 'PUT', url: `/api/scenes/${sceneId}`, payload: { markdown: '新内容', baseHash: '' } })
    const res = await app.inject({ method: 'POST', url: `/api/scenes/${sceneId}/snapshots/${snap.hash}/restore` })
    expect(res.statusCode).toBe(200)
    expect(res.json().markdown).toBe('你好世界')
    await app.close()
  })
})
