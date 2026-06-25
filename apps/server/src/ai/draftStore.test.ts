import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { openDb } from '../db/index.js'
import { runMigrations } from '../db/index.js'
import { DraftStore, toDraftDto } from './draftStore.js'

describe('DraftStore', () => {
  let home: string
  let dbPath: string

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(tmpdir(), 'novel-draft-'))
    dbPath = path.join(home, 'index.db')
  })
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  function makeStore() {
    const db = openDb(dbPath)
    runMigrations(db)
    const now = new Date().toISOString()
    db.prepare('INSERT INTO projects (slug, name, created_at, updated_at) VALUES (?,?,?,?)')
      .run('p', 'P', now, now)
    const proj = db.prepare('SELECT id FROM projects WHERE slug = ?').get('p') as { id: number }
    db.prepare('INSERT INTO volumes (project_id, slug, name, order_index) VALUES (?,?,?,?)')
      .run(proj.id, 'vol-1', 'V', 0)
    const vol = db.prepare('SELECT id FROM volumes WHERE project_id = ?').get(proj.id) as { id: number }
    db.prepare('INSERT INTO chapters (volume_id, slug, title, order_index) VALUES (?,?,?,?)')
      .run(vol.id, 'ch-1', 'C', 0)
    const chap = db.prepare('SELECT id FROM chapters WHERE volume_id = ?').get(vol.id) as { id: number }
    db.prepare("INSERT INTO scenes (chapter_id, slug, title, order_index, content_hash) VALUES (?,?,?,?,?)")
      .run(chap.id, 'sc-1', 'S', 0, 'deadbeef')
    const scene = db.prepare('SELECT id FROM scenes WHERE chapter_id = ?').get(chap.id) as { id: number }
    return { store: new DraftStore(db), projId: proj.id, sceneId: scene.id }
  }

  it('creates and retrieves a draft', () => {
    const { store, projId, sceneId } = makeStore()
    const draft = store.create({ projectId: projId, sceneId, mode: 'continue', model: 'gpt-4o-mini' })
    expect(draft.id.length).toBe(36) // UUID
    expect(draft.status).toBe('streaming')
    const fetched = store.get(draft.id)
    expect(fetched?.id).toBe(draft.id)
    const dto = toDraftDto(draft)
    expect(dto.projectId).toBe(projId)
    expect(dto.mode).toBe('continue')
  })

  it('appends text to a draft', () => {
    const { store, projId, sceneId } = makeStore()
    const draft = store.create({ projectId: projId, sceneId, mode: 'polish', model: 'gpt-4o-mini' })
    store.appendText(draft.id, 'hello ')
    store.appendText(draft.id, 'world')
    expect(store.get(draft.id)?.text).toBe('hello world')
  })

  it('sets status and error message', () => {
    const { store, projId, sceneId } = makeStore()
    const draft = store.create({ projectId: projId, sceneId, mode: 'continue', model: 'gpt-4o-mini' })
    store.setStatus(draft.id, 'done')
    expect(store.get(draft.id)?.status).toBe('done')
    store.setStatus(draft.id, 'error', 'something broke')
    expect(store.get(draft.id)?.error_message).toBe('something broke')
  })

  it('sets usage tokens', () => {
    const { store, projId, sceneId } = makeStore()
    const draft = store.create({ projectId: projId, sceneId, mode: 'continue', model: 'gpt-4o-mini' })
    store.setUsage(draft.id, 100, 500)
    const dto = toDraftDto(store.get(draft.id)!)
    expect(dto.usage.promptTokens).toBe(100)
    expect(dto.usage.completionTokens).toBe(500)
  })

  it('lists active drafts by scene', () => {
    const { store, projId, sceneId } = makeStore()
    store.create({ projectId: projId, sceneId, mode: 'continue', model: 'gpt-4o-mini' })
    store.create({ projectId: projId, sceneId, mode: 'expand', model: 'gpt-4o-mini' })
    expect(store.listActiveByScene(sceneId).length).toBe(2)
    // Mark one as done
    const all = store.listActiveByScene(sceneId)
    store.setStatus(all[0]!.id, 'done')
    expect(store.listActiveByScene(sceneId).length).toBe(1)
  })

  it('lists active drafts by project', () => {
    const { store, projId, sceneId } = makeStore()
    store.create({ projectId: projId, sceneId, mode: 'continue', model: 'gpt-4o-mini' })
    expect(store.listActiveByProject(projId).length).toBe(1)
  })

  it('deletes a draft', () => {
    const { store, projId, sceneId } = makeStore()
    const draft = store.create({ projectId: projId, sceneId, mode: 'continue', model: 'gpt-4o-mini' })
    expect(store.delete(draft.id)).toBe(true)
    expect(store.get(draft.id)).toBeUndefined()
    // Second delete returns false
    expect(store.delete(draft.id)).toBe(false)
  })

  it('purges expired drafts', () => {
    const { store, projId, sceneId } = makeStore()
    // Create with TTL=1ms
    const draft = store.create({ projectId: projId, sceneId, mode: 'continue', model: 'gpt-4o-mini', ttlMs: 1 })
    // Purge before expiry
    expect(store.purgeExpired(Date.now() - 10)).toBe(0) // purge with past time — should not delete
    expect(store.purgeExpired(Date.now() + 10000)).toBe(1) // future time — should delete
    expect(store.get(draft.id)).toBeUndefined()
  })

  it('rejects draft with non-existent project (FK violation)', () => {
    const { store } = makeStore()
    expect(() => store.create({ projectId: 999999, sceneId: null, mode: 'continue', model: 'gpt-4o-mini' })).toThrow()
  })
})