import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { openDb } from '../db/index.js'
import { ProjectRepo } from './repo.js'

describe('ProjectRepo', () => {
  let dir: string
  let db: ReturnType<typeof openDb>
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'novel-repo-'))
    db = openDb(path.join(dir, 'novel.db'))
  })
  afterEach(async () => {
    db.close()
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('creates a project with a default volume and chapter', () => {
    const repo = new ProjectRepo(db)
    const p = repo.createProject('Test', 'test')
    expect(p.slug).toBe('test')
    const outline = repo.getOutline(p.id)
    expect(outline.volumes.length).toBe(1)
    expect(outline.chapters.length).toBe(1)
  })

  it('adds chapters and scenes with monotonic order_index', () => {
    const repo = new ProjectRepo(db)
    const p = repo.createProject('Test', 'test')
    const v = repo.getOutline(p.id).volumes[0]!
    const c2 = repo.createChapter(v.id, 'ch-2', '第二章')
    const c1 = repo.createChapter(v.id, 'ch-3', '第一章')
    expect(c1.order_index).toBeGreaterThan(c2.order_index)
    const s1 = repo.createScene(c1.id, 'sc-a', '开场')
    const s2 = repo.createScene(c1.id, 'sc-b', '冲突')
    expect(s2.order_index).toBe(s1.order_index + 1)
  })
})
