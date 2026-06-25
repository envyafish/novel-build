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

  it('injects the outline + story arc into generate_chapter context', async () => {
    const db = openDb(path.join(home, 'novel.db'))
    const repo = new ProjectRepo(db)
    const p = repo.createProject('T', 't')
    // Project-level story arc notes
    db.prepare('UPDATE projects SET story_arc_notes = ? WHERE id = ?').run('主角觉醒，踏上寻找真相之路。', p.id)
    // Add two scenes with notes so we can see the outline
    const chap = repo.getOutline(p.id).chapters[0]!
    repo.createScene(chap.id, 'sc-1', '开场')
    const sc2 = repo.createScene(chap.id, 'sc-2', '高潮对决')
    db.prepare('UPDATE scenes SET notes = ? WHERE id = ?').run('与宿敌正面交锋', sc2.id)
    const target = repo.getOutline(p.id).scenes[0]!

    const out = await buildContext({
      db, sceneId: target.id, novelsDir: path.join(home, 'Novels'),
      mode: 'generate_chapter', systemPrompt: '', contextPrevChars: 100, inputText: '...',
    })
    const userMsg = out.messages.find((m) => m.role === 'user')!
    expect(userMsg.content).toContain('[Outline]')
    expect(userMsg.content).toContain('[Story Arc Notes]')
    expect(userMsg.content).toContain('主角觉醒')
    expect(userMsg.content).toContain('当前章节')
    expect(userMsg.content).toContain('高潮对决')
    db.close()
  })

  it('does NOT inject the outline for continue / polish / rewrite modes', async () => {
    const db = openDb(path.join(home, 'novel.db'))
    const repo = new ProjectRepo(db)
    const p = repo.createProject('T', 't')
    db.prepare('UPDATE projects SET story_arc_notes = ? WHERE id = ?').run('arc notes here', p.id)
    const chap = repo.getOutline(p.id).chapters[0]!
    const sc = repo.createScene(chap.id, 'sc-1', '开场')
    const target = sc

    for (const mode of ['continue', 'polish', 'rewrite', 'expand', 'condense'] as const) {
      const out = await buildContext({
        db, sceneId: target.id, novelsDir: path.join(home, 'Novels'),
        mode, systemPrompt: '', contextPrevChars: 100, inputText: '...',
      })
      const userMsg = out.messages.find((m) => m.role === 'user')!
      expect(userMsg.content, `mode=${mode}`).not.toContain('[Outline]')
      expect(userMsg.content, `mode=${mode}`).not.toContain('[Story Arc Notes]')
    }
    db.close()
  })

  it('returns a usable context when the project has no story arc and no scenes beyond the current one', async () => {
    const db = openDb(path.join(home, 'novel.db'))
    const repo = new ProjectRepo(db)
    const p = repo.createProject('T', 't')
    // no story_arc_notes, no scene notes — outline should still come back
    // (just the chapter header line, no [Story Arc Notes] block).
    const chap = repo.getOutline(p.id).chapters[0]!
    const sc = repo.createScene(chap.id, 'sc-1', '唯一场景')
    const out = await buildContext({
      db, sceneId: sc.id, novelsDir: path.join(home, 'Novels'),
      mode: 'generate_chapter', systemPrompt: '', contextPrevChars: 100, inputText: '...',
    })
    const userMsg = out.messages.find((m) => m.role === 'user')!
    expect(userMsg.content).toContain('[Outline]')
    expect(userMsg.content).toContain('[Current Volume]')
    expect(userMsg.content).not.toContain('[Story Arc Notes]')
    db.close()
  })
})
