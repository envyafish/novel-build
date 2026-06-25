import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { buildServer } from '../server.js'

describe('snapshot restore updates content_hash and baseHash', () => {
  let home: string
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(tmpdir(), 'novel-restore-'))
    process.env.NOVEL_HOME = home
    process.env.NOVEL_NOVELS_DIR = path.join(home, 'Novels')
  })
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    delete process.env.NOVEL_HOME
    delete process.env.NOVEL_NOVELS_DIR
  })

  async function setup() {
    const { app, db } = await buildServer({ enableExternalScan: false, silentLogger: true })
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'X', slug: 'x' } })).json()
    const outline = (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/outline` })).json()
    const c = outline.chapters[0]
    const s = (await app.inject({ method: 'POST', url: '/api/scenes', payload: { slug: 'sc', title: 'S', chapterId: c.id } })).json()
    await app.inject({ method: 'PUT', url: `/api/scenes/${s.id}`, payload: { markdown: 'original', baseHash: '' } })
    const snap = (await app.inject({ method: 'POST', url: `/api/scenes/${s.id}/snapshot` })).json()
    await app.inject({ method: 'PUT', url: `/api/scenes/${s.id}`, payload: { markdown: 'modified', baseHash: '' } })
    return { app, db, sceneId: s.id, snapHash: snap.hash }
  }

  it('restore writes the snapshot content to disk and updates scenes.content_hash', async () => {
    const { app, db, sceneId, snapHash } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: `/api/scenes/${sceneId}/snapshots/${snapHash}/restore`,
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.markdown).toBe('original')
    // The returned baseHash must match what's in the DB (state machine is consistent)
    const row = db.prepare('SELECT content_hash FROM scenes WHERE id = ?').get(sceneId) as { content_hash: string }
    expect(body.baseHash).toBe(row.content_hash)

    // Subsequent PUT with the returned baseHash should succeed (no external_change)
    const save = await app.inject({
      method: 'PUT',
      url: `/api/scenes/${sceneId}`,
      payload: { markdown: 'edited after restore', baseHash: body.baseHash },
    })
    expect(save.statusCode).toBe(200)
    await app.close()
  })
})