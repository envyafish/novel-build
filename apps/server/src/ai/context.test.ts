import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { openDb } from '../db/index.js'
import { ProjectRepo } from '../projects/repo.js'
import { buildContext } from './context.js'

describe('buildContext', () => {
  let home: string
  beforeEach(async () => { home = await fs.mkdtemp(path.join(tmpdir(), 'novel-ctx-')); })
  afterEach(async () => { await fs.rm(home, { recursive: true, force: true }); })

  it('honors overrideMessages and prepends system prompt', async () => {
    const db = openDb(path.join(home, 'novel.db'))
    const repo = new ProjectRepo(db)
    const p = repo.createProject('T', 't')
    const s = repo.createScene(repo.getOutline(p.id).chapters[0]!.id, 'sc-1', 'x')
    const out = await buildContext({
      db, sceneId: s.id, novelsDir: path.join(home, 'Novels'),
      mode: 'polish', systemPrompt: 'be terse', contextPrevChars: 100, inputText: 'hi',
      overrideMessages: [{ role: 'user', content: 'fix this' }],
    })
    expect(out.messages[0]).toEqual({ role: 'system', content: 'be terse' })
    expect(out.messages[1]).toEqual({ role: 'user', content: 'fix this' })
    db.close()
  })
})
