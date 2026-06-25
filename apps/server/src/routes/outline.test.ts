import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { buildServer } from '../server.js'

describe('outline routes', () => {
  let home: string
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(tmpdir(), 'novel-outline-'))
    process.env.NOVEL_HOME = home
    process.env.NOVEL_NOVELS_DIR = path.join(home, 'Novels')
  })
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    delete process.env.NOVEL_HOME
    delete process.env.NOVEL_NOVELS_DIR
  })

  async function makeProject() {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'X', slug: 'x' } })).json()
    const outline = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/outline` })).json()
    return { app, project: p, chapter: outline.chapters[0] as { id: number } }
  }

  it('PATCH /api/chapters/:id renames a chapter', async () => {
    const { app, chapter } = await makeProject()
    const res = await app.inject({ method: 'PATCH', url: `/api/chapters/${chapter.id}`, payload: { title: '新章节' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().title).toBe('新章节')
    await app.close()
  })

  it('DELETE /api/chapters/:id removes a chapter', async () => {
    const { app, chapter } = await makeProject()
    const res = await app.inject({ method: 'DELETE', url: `/api/chapters/${chapter.id}` })
    expect(res.statusCode).toBe(200)
    const outline = (await app.inject({ method: 'GET', url: `/api/projects/${(await app.inject({ method: 'GET', url: '/api/projects' })).json()[0].id}/outline` })).json()
    expect(outline.chapters.length).toBe(0)
    await app.close()
  })

  it('PATCH /api/scenes/:id updates status, title, targetWords', async () => {
    const { app, chapter } = await makeProject()
    const s = (await app.inject({ method: 'POST', url: '/api/scenes', payload: { slug: 'sc-1', title: 'S', chapterId: chapter.id } })).json()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/scenes/${s.id}`,
      payload: { status: 'revising', title: '改', targetWords: 500 },
    })
    expect(res.statusCode).toBe(200)
    const out = res.json()
    expect(out.status).toBe('revising')
    expect(out.title).toBe('改')
    expect(out.targetWords).toBe(500)
    await app.close()
  })

  it('DELETE /api/scenes/:id removes a scene', async () => {
    const { app, chapter } = await makeProject()
    const s = (await app.inject({ method: 'POST', url: '/api/scenes', payload: { slug: 'sc-1', title: 'S', chapterId: chapter.id } })).json()
    const res = await app.inject({ method: 'DELETE', url: `/api/scenes/${s.id}` })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('POST /api/volumes creates a new volume', async () => {
    const { app, project } = await makeProject()
    const res = await app.inject({ method: 'POST', url: '/api/volumes', payload: { projectId: project.id, slug: 'vol-2', name: '第二卷' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('第二卷')
    const outline = (await app.inject({ method: 'GET', url: `/api/projects/${project.id}/outline` })).json()
    expect(outline.volumes.length).toBe(2)
    await app.close()
  })

  it('DELETE /api/chapters/:id removes a chapter', async () => {
    const { app, chapter } = await makeProject()
    const res = await app.inject({ method: 'DELETE', url: `/api/chapters/${chapter.id}` })
    expect(res.statusCode).toBe(200)
    await app.close()
  })
})

describe('project routes', () => {
  let home: string
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(tmpdir(), 'novel-proj-'))
    process.env.NOVEL_HOME = home
    process.env.NOVEL_NOVELS_DIR = path.join(home, 'Novels')
  })
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    delete process.env.NOVEL_HOME
    delete process.env.NOVEL_NOVELS_DIR
  })

  it('GET /api/projects/:id/stats reports chapters/scenes/words', async () => {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Y', slug: 'y' } })).json()
    const outline = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/outline` })).json()
    const c = outline.chapters[0]
    const s = (await app.inject({ method: 'POST', url: '/api/scenes', payload: { slug: 'sc', title: 'S', chapterId: c.id } })).json()
    await app.inject({ method: 'PUT', url: `/api/scenes/${s.id}`, payload: { markdown: '你好世界', baseHash: '' } })
    const stats = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/stats` })).json()
    expect(stats.chapters).toBe(1)
    expect(stats.scenes).toBe(1)
    expect(stats.words).toBeGreaterThan(0)
    await app.close()
  })

  it('DELETE /api/projects/:id removes the project', async () => {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Z', slug: 'z' } })).json()
    const res = await app.inject({ method: 'DELETE', url: `/api/projects/${p.id}` })
    expect(res.statusCode).toBe(200)
    const list = (await app.inject({ method: 'GET', url: '/api/projects' })).json()
    expect(list.length).toBe(0)
    await app.close()
  })

  it('PATCH /api/projects/:id renames the project', async () => {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'A', slug: 'a' } })).json()
    const res = await app.inject({ method: 'PATCH', url: `/api/projects/${p.id}`, payload: { name: '新名' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('新名')
    await app.close()
  })
})
