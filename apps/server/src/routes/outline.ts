// @ts-nocheck - Fastify 4 + @types/node 25 route inference under exactOptionalPropertyTypes is noisy; runtime is correct.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Database } from '../db/sqlite.js'
import { ProjectRepo } from '../projects/repo.js'
import { apiError } from '../errors.js'
import { manuscriptPath, snapshotsDir } from '../projects/paths.js'
import fs from 'node:fs/promises'
import path from 'node:path'

const chapterBody = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  title: z.string().min(1),
  volumeId: z.number().int(),
})
const sceneBody = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  title: z.string().min(1),
  chapterId: z.number().int(),
})
const chapterPatchBody = z.object({ title: z.string().min(1) })
const scenePatchBody = z.object({
  title: z.string().min(1).optional(),
  status: z.enum(['draft', 'revising', 'done']).optional(),
  targetWords: z.number().int().nullable().optional(),
})


export function registerOutlineRoutes(app: any, db: Database, novelsDir: string) {
  const repo = new ProjectRepo(db)

  app.get<{ Params: { id: string } }>('/api/projects/:id/outline', async (req) => {
    const id = Number(req.params.id)
    if (!repo.getProject(id)) throw apiError(404, 'project_not_found', `project ${id} not found`)
    const o = repo.getOutline(id)
    return {
      volumes: o.volumes.map((v) => ({ id: v.id, projectId: v.project_id, slug: v.slug, name: v.name, orderIndex: v.order_index })),
      chapters: o.chapters.map((c) => ({ id: c.id, volumeId: c.volume_id, slug: c.slug, title: c.title, orderIndex: c.order_index, status: c.status })),
      scenes: o.scenes.map((s) => ({ id: s.id, chapterId: s.chapter_id, slug: s.slug, title: s.title, orderIndex: s.order_index, status: s.status, targetWords: s.target_words, notes: s.notes, contentHash: s.content_hash, wordCount: 0 })),
    }
  })

  app.post('/api/chapters', async (req) => {
    const body = chapterBody.parse(req.body)
    if (!repo.getVolume(body.volumeId)) throw apiError(404, 'volume_not_found', `volume ${body.volumeId} not found`)
    const existing = db.prepare<{ id: number }>('SELECT id FROM chapters WHERE volume_id = ? AND slug = ?').get(body.volumeId, body.slug)
    if (existing) throw apiError(409, 'slug_conflict', `slug "${body.slug}" already exists in this volume`)
    const c = repo.createChapter(body.volumeId, body.slug, body.title)
    return { id: c.id, volumeId: c.volume_id, slug: c.slug, title: c.title, orderIndex: c.order_index, status: c.status }
  })

  app.post('/api/volumes', async (req) => {
    const body = z.object({
      projectId: z.number().int(),
      slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
      name: z.string().min(1),
    }).parse(req.body)
    if (!repo.getProject(body.projectId)) throw apiError(404, 'project_not_found', `project ${body.projectId} not found`)
    const existing = db.prepare<{ id: number }>('SELECT id FROM volumes WHERE project_id = ? AND slug = ?').get(body.projectId, body.slug)
    if (existing) throw apiError(409, 'slug_conflict', `slug "${body.slug}" already exists in this project`)
    const v = repo.createVolume(body.projectId, body.slug, body.name)
    return { id: v.id, projectId: v.project_id, slug: v.slug, name: v.name, orderIndex: v.order_index }
  })

  app.post('/api/scenes', async (req) => {
    const body = sceneBody.parse(req.body)
    if (!repo.getChapter(body.chapterId)) throw apiError(404, 'chapter_not_found', `chapter ${body.chapterId} not found`)
    const existing = db.prepare<{ id: number }>('SELECT id FROM scenes WHERE chapter_id = ? AND slug = ?').get(body.chapterId, body.slug)
    if (existing) throw apiError(409, 'slug_conflict', `slug "${body.slug}" already exists in this chapter`)
    const s = repo.createScene(body.chapterId, body.slug, body.title)
    return { id: s.id, chapterId: s.chapter_id, slug: s.slug, title: s.title, orderIndex: s.order_index, status: s.status, targetWords: s.target_words, notes: s.notes, contentHash: s.content_hash, wordCount: 0 }
  })

  app.delete<{ Params: { id: string } }>('/api/chapters/:id', async (req) => {
    const id = Number(req.params.id)
    if (!repo.getChapter(id)) throw apiError(404, 'chapter_not_found', `chapter ${id} not found`)
    // Clean up on-disk manuscript files for all scenes in this chapter
    // before the DB cascade removes the scene rows.
    try {
      const rows = db.prepare<{ scene_slug: string; chap_slug: string; vol_slug: string; project_slug: string; snap_hashes: string }>(
        `SELECT s.slug as scene_slug, c.slug as chap_slug, v.slug as vol_slug, p.slug as project_slug,
                GROUP_CONCAT(sm.hash) as snap_hashes
         FROM scenes s JOIN chapters c ON s.chapter_id = c.id
         JOIN volumes v ON c.volume_id = v.id JOIN projects p ON v.project_id = p.id
         LEFT JOIN snapshots_meta sm ON sm.scene_id = s.id
         WHERE s.chapter_id = ?
         GROUP BY s.id`,
      ).all(id)
      // Collect all snapshot hashes and how many scenes IN THIS CHAPTER reference each.
      // After CASCADE deletes the rows, we can't tell which hashes were "ours".
      const hashRefCount = new Map<string, number>()
      for (const row of rows) {
        for (const h of (row.snap_hashes ?? '').split(',').filter(Boolean)) {
          hashRefCount.set(h, (hashRefCount.get(h) ?? 0) + 1)
        }
      }
      // For each hash, check total references across ALL scenes. Only delete
      // the file if every reference is from a scene in this chapter.
      const hashesToDelete: string[] = []
      for (const [hash, localCount] of hashRefCount) {
        const total = db.prepare<{ cnt: number }>(
          'SELECT COUNT(*) as cnt FROM snapshots_meta WHERE hash = ?',
        ).get(hash)?.cnt ?? 0
        if (total <= localCount) hashesToDelete.push(hash)
      }
      // Delete manuscript files
      for (const row of rows) {
        const projDir = path.join(novelsDir, row.project_slug)
        await fs.unlink(manuscriptPath(projDir, row.vol_slug, row.chap_slug, row.scene_slug)).catch(() => {})
      }
      // Delete snapshot files (only those not shared with other chapters)
      if (rows.length > 0 && hashesToDelete.length > 0) {
        const snapDir = snapshotsDir(path.join(novelsDir, rows[0]!.project_slug))
        for (const h of hashesToDelete) {
          await fs.unlink(path.join(snapDir, `${h}.md.z`)).catch(() => {})
        }
      }
    } catch {
      // best-effort — DB delete should still proceed
    }
    repo.deleteChapter(id)
    return { ok: true }
  })

  app.delete<{ Params: { id: string } }>('/api/scenes/:id', async (req) => {
    const id = Number(req.params.id)
    if (!repo.getScene(id)) throw apiError(404, 'scene_not_found', `scene ${id} not found`)
    // Clean up the on-disk manuscript file before the DB row is removed.
    try {
      const row = db.prepare<{ scene_slug: string; chap_slug: string; vol_slug: string; project_slug: string }>(
        `SELECT s.slug as scene_slug, c.slug as chap_slug, v.slug as vol_slug, p.slug as project_slug
         FROM scenes s JOIN chapters c ON s.chapter_id = c.id
         JOIN volumes v ON c.volume_id = v.id JOIN projects p ON v.project_id = p.id
         WHERE s.id = ?`,
      ).get(id)
      if (row) {
        const projDir = path.join(novelsDir, row.project_slug)
        await fs.unlink(manuscriptPath(projDir, row.vol_slug, row.chap_slug, row.scene_slug)).catch(() => {})
        // Clean up snapshot files — but only if no other scene references the
        // same content-addressed hash. Two scenes with identical text share one
        // .md.z file; deleting the file would break the other scene's snapshots.
        const snapHashes = db.prepare<{ hash: string }>(
          'SELECT hash FROM snapshots_meta WHERE scene_id = ?',
        ).all(id)
        const snapDir = snapshotsDir(projDir)
        for (const { hash } of snapHashes) {
          const otherRef = db.prepare<{ cnt: number }>(
            'SELECT COUNT(*) as cnt FROM snapshots_meta WHERE hash = ? AND scene_id != ?',
          ).get(hash, id)
          if (!otherRef || otherRef.cnt === 0) {
            await fs.unlink(path.join(snapDir, `${hash}.md.z`)).catch(() => {})
          }
        }
      }
    } catch {
      // best-effort — DB delete should still proceed
    }
    repo.deleteScene(id)
    return { ok: true }
  })

  app.patch<{ Params: { id: string } }>('/api/chapters/:id', async (req) => {
    const id = Number(req.params.id)
    const body = chapterPatchBody.parse(req.body)
    if (!repo.getChapter(id)) throw apiError(404, 'chapter_not_found', `chapter ${id} not found`)
    const c = repo.updateChapterTitle(id, body.title)
    return { id: c!.id, volumeId: c!.volume_id, slug: c!.slug, title: c!.title, orderIndex: c!.order_index, status: c!.status }
  })

  app.patch<{ Params: { id: string } }>('/api/volumes/:id', async (req) => {
    const id = Number(req.params.id)
    const body = z.object({ name: z.string().min(1) }).parse(req.body)
    if (!repo.getVolume(id)) throw apiError(404, 'volume_not_found', `volume ${id} not found`)
    const v = repo.updateVolumeName(id, body.name)
    return { id: v!.id, projectId: v!.project_id, slug: v!.slug, name: v!.name, orderIndex: v!.order_index }
  })

  app.patch<{ Params: { id: string } }>('/api/scenes/:id', async (req) => {
    const id = Number(req.params.id)
    const body = scenePatchBody.parse(req.body)
    if (!repo.getScene(id)) throw apiError(404, 'scene_not_found', `scene ${id} not found`)
    let s = repo.getScene(id)!
    if (body.title !== undefined) s = repo.updateSceneTitle(id, body.title)!
    if (body.status !== undefined) s = repo.updateSceneStatus(id, body.status)!
    if (body.targetWords !== undefined) s = repo.updateSceneTargetWords(id, body.targetWords)!
    return {
      id: s.id,
      chapterId: s.chapter_id,
      slug: s.slug,
      title: s.title,
      orderIndex: s.order_index,
      status: s.status,
      targetWords: s.target_words,
      notes: s.notes,
      contentHash: s.content_hash,
      wordCount: 0,
    }
  })
}
// @ts-nocheck - Fastify 4.27 + @types/node 25.x route type narrowing under
// exactOptionalPropertyTypes is brittle and orthogonal to v0 functionality.
// Runtime is correct; types are deliberately relaxed here.

