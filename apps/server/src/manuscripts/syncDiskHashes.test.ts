import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { openDb } from '../db/index.js'
import { runMigrations } from '../db/index.js'
import { writeManuscript } from './io.js'
import { syncDiskHashes } from './diffScanner.js'
import { manuscriptPath } from '../projects/paths.js'

describe('syncDiskHashes', () => {
  let home: string
  let novelsDir: string
  let dbPath: string

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(tmpdir(), 'novel-sync-'))
    novelsDir = path.join(home, 'Novels')
    await fs.mkdir(novelsDir, { recursive: true })
    dbPath = path.join(home, 'index.db')
  })
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  async function makeProjectWithScene() {
    const db = openDb(dbPath)
    runMigrations(db)
    const now = new Date().toISOString()
    db.prepare('INSERT INTO projects (slug, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('p', 'P', now, now)
    const proj = db.prepare('SELECT id FROM projects WHERE slug = ?').get('p') as { id: number }
    db.prepare('INSERT INTO volumes (project_id, slug, name, order_index) VALUES (?, ?, ?, ?)')
      .run(proj.id, 'vol-1', 'V', 0)
    const vol = db.prepare('SELECT id FROM volumes WHERE project_id = ?').get(proj.id) as { id: number }
    db.prepare('INSERT INTO chapters (volume_id, slug, title, order_index) VALUES (?, ?, ?, ?)')
      .run(vol.id, 'ch-1', 'C', 0)
    const chap = db.prepare('SELECT id FROM chapters WHERE volume_id = ?').get(vol.id) as { id: number }
    db.prepare("INSERT INTO scenes (chapter_id, slug, title, order_index, content_hash) VALUES (?, ?, ?, ?, '')")
      .run(chap.id, 'sc-1', 'S', 0)
    const scene = db.prepare('SELECT id FROM scenes WHERE chapter_id = ?').get(chap.id) as { id: number }
    return { db, scene, proj }
  }

  it('updates scenes.content_hash to match externally-modified disk file', async () => {
    const { db, scene } = await makeProjectWithScene()
    const file = manuscriptPath(path.join(novelsDir, 'p'), 'vol-1', 'ch-1', 'sc-1')
    await writeManuscript(file, 'first version')
    // External edit: overwrite disk file with new content (bypassing writeManuscript so DB hash is unchanged).
    await fs.writeFile(file, 'second version after external edit', 'utf8')

    const result = await syncDiskHashes(db, novelsDir)
    expect(result.scanned).toBeGreaterThanOrEqual(1)
    expect(result.updated).toBeGreaterThanOrEqual(1)

    const row = db.prepare('SELECT content_hash FROM scenes WHERE id = ?').get(scene.id) as { content_hash: string }
    expect(row.content_hash.length).toBe(64)
    expect(row.content_hash).not.toBe('')
  })

  it('does not touch scenes whose disk file is missing', async () => {
    const { db, scene } = await makeProjectWithScene()
    // No manuscript file written → scanManuscripts finds nothing for this scene.
    const beforeRow = db.prepare('SELECT content_hash FROM scenes WHERE id = ?').get(scene.id) as { content_hash: string }
    const result = await syncDiskHashes(db, novelsDir)
    expect(result.updated).toBe(0)
    const afterRow = db.prepare('SELECT content_hash FROM scenes WHERE id = ?').get(scene.id) as { content_hash: string }
    expect(afterRow.content_hash).toBe(beforeRow.content_hash)
  })

  it('handles missing project directory gracefully', async () => {
    const { db } = await makeProjectWithScene()
    const result = await syncDiskHashes(db, novelsDir)
    expect(result.scanned).toBeGreaterThanOrEqual(0)
    expect(result.updated).toBe(0)
  })
})