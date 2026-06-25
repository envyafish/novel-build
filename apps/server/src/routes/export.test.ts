import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { buildServer } from '../server.js'

describe('export routes', () => {
  let home: string
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(tmpdir(), 'novel-export-'))
    process.env.NOVEL_HOME = home
    process.env.NOVEL_NOVELS_DIR = path.join(home, 'Novels')
  })
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    delete process.env.NOVEL_HOME
    delete process.env.NOVEL_NOVELS_DIR
  })

  it('exports project as txt', async () => {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: '测试', slug: 'test' } })).json()
    const outline = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/outline` })).json()
    const c = outline.chapters[0]
    const s = (await app.inject({ method: 'POST', url: '/api/scenes', payload: { slug: 'sc', title: '开场', chapterId: c.id } })).json()
    await app.inject({ method: 'PUT', url: `/api/scenes/${s.id}`, payload: { markdown: '你好世界', baseHash: '' } })

    const res = await app.inject({ method: 'GET', url: `/api/projects/${p.id}/export?format=txt` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.headers['content-disposition']).toContain('.txt')
    expect(res.body).toContain('你好世界')
    expect(res.body).toContain('测试')
    await app.close()
  })

  it('exports project as markdown', async () => {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: '测试', slug: 'test' } })).json()
    const outline = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/outline` })).json()
    const c = outline.chapters[0]
    const s = (await app.inject({ method: 'POST', url: '/api/scenes', payload: { slug: 'sc', title: '开场', chapterId: c.id } })).json()
    await app.inject({ method: 'PUT', url: `/api/scenes/${s.id}`, payload: { markdown: '你好世界', baseHash: '' } })
    const res = await app.inject({ method: 'GET', url: `/api/projects/${p.id}/export?format=markdown` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('markdown')
    expect(res.body).toContain('# 测试')
    expect(res.body).toContain('你好世界')
    await app.close()
  })

  it('exports project as html', async () => {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: '测试', slug: 'test' } })).json()
    const outline = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/outline` })).json()
    const c = outline.chapters[0]
    const s = (await app.inject({ method: 'POST', url: '/api/scenes', payload: { slug: 'sc', title: '开场', chapterId: c.id } })).json()
    await app.inject({ method: 'PUT', url: `/api/scenes/${s.id}`, payload: { markdown: '你好世界', baseHash: '' } })
    const res = await app.inject({ method: 'GET', url: `/api/projects/${p.id}/export?format=html` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('<!DOCTYPE html>')
    expect(res.body).toContain('你好世界')
    await app.close()
  })

  it('returns 400 for invalid format', async () => {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'X', slug: 'x' } })).json()
    const res = await app.inject({ method: 'GET', url: `/api/projects/${p.id}/export?format=pdf` })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('exports project as epub', async () => {
    const { app } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: '测试书', slug: 'test-epub' } })).json()
    const outline = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/outline` })).json()
    const c = outline.chapters[0]
    const s = (await app.inject({ method: 'POST', url: '/api/scenes', payload: { slug: 'sc', title: '开场', chapterId: c.id } })).json()
    await app.inject({ method: 'PUT', url: `/api/scenes/${s.id}`, payload: { markdown: '你好世界', baseHash: '' } })

    const res = await app.inject({ method: 'GET', url: `/api/projects/${p.id}/export?format=epub` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/epub+zip')
    expect(res.headers['content-disposition']).toContain('.epub')

    // Verify it's a valid zip
    expect(res.rawPayload.length).toBeGreaterThan(0)
    expect(res.rawPayload[0]).toBe(0x50) // 'P' from PK\x03\x04
    expect(res.rawPayload[1]).toBe(0x4b) // 'K'

    // Verify zip contents
    const zip = await JSZip.loadAsync(res.rawPayload)
    expect(zip.file('mimetype')).toBeTruthy()
    expect(zip.file('META-INF/container.xml')).toBeTruthy()
    expect(zip.file('OEBPS/content.opf')).toBeTruthy()
    expect(zip.file('OEBPS/toc.ncx')).toBeTruthy()
    expect(zip.file('OEBPS/style.css')).toBeTruthy()
    expect(zip.file('OEBPS/title.xhtml')).toBeTruthy()
    expect(zip.file('OEBPS/chapter-1.xhtml')).toBeTruthy()

    // Verify mimetype content
    const mimetype = await zip.file('mimetype')!.async('string')
    expect(mimetype).toBe('application/epub+zip')

    // Verify content.opf contains project name
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('测试书')

    // Verify chapter contains scene text
    const chapter = await zip.file('OEBPS/chapter-1.xhtml')!.async('string')
    expect(chapter).toContain('你好世界')
    await app.close()
  })
})
