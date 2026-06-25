import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { openDb } from './index.js'

describe('db', () => {
  let dir: string
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(tmpdir(), 'novel-db-')); })
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); })

  it('creates schema and is idempotent on reopen', () => {
    const db = openDb(path.join(dir, 'novel.db'))
    const tables = db.prepare<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((t) => t.name)
    expect(tables).toContain('scenes')
    expect(tables).toContain('snapshots_meta')
    db.close()
    const db2 = openDb(path.join(dir, 'novel.db'))
    const migrations = db2.prepare<{ id: number }>('SELECT id FROM _migrations').all()
    expect(migrations.length).toBeGreaterThan(0)
    db2.close()
  })
})
