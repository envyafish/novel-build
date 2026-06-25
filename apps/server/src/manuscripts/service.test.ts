import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { openDb } from '../db/index.js'
import { ProjectRepo } from '../projects/repo.js'
import { ManuscriptService } from './service.js'
import { projectDir } from '../projects/paths.js'

describe('ManuscriptService', () => {
  let home: string
  let novelsDir: string
  let db: ReturnType<typeof openDb>
  let repo: ProjectRepo
  let svc: ManuscriptService
  let p: ReturnType<ProjectRepo['createProject']>
  let sceneId: number
  let pd: string

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(tmpdir(), 'novel-svc-'))
    novelsDir = path.join(home, 'Novels')
    process.env.NOVEL_HOME = home
    process.env.NOVEL_NOVELS_DIR = novelsDir
    db = openDb(path.join(home, 'novel.db'))
    repo = new ProjectRepo(db)
    svc = new ManuscriptService(db, novelsDir)
    p = repo.createProject('Test', 'test')
    const outline = repo.getOutline(p.id)
    const c = outline.chapters[0]!
    const s = repo.createScene(c.id, 'sc-1', '开场')
    sceneId = s.id
    pd = projectDir(novelsDir, 'test')
  })
  afterEach(async () => {
    db.close()
    await fs.rm(home, { recursive: true, force: true })
    delete process.env.NOVEL_HOME
    delete process.env.NOVEL_NOVELS_DIR
  })

  it('saves the manuscript and updates content_hash', async () => {
    const out = await svc.saveScene({ sceneId, markdown: 'first line', baseHash: '', projectDirAbs: pd })
    expect(out.hash.length).toBe(64)
    const row = db.prepare<{ content_hash: string }>('SELECT content_hash FROM scenes WHERE id = ?').get(sceneId)!
    expect(row.content_hash).toBe(out.hash)
  })

  it('rejects stale baseHash with 422 external_change', async () => {
    await svc.saveScene({ sceneId, markdown: 'a', baseHash: '', projectDirAbs: pd })
    await expect(
      svc.saveScene({ sceneId, markdown: 'b', baseHash: 'deadbeef', projectDirAbs: pd }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'external_change' })
  })
})
