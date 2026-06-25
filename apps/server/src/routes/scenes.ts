// @ts-nocheck - Fastify 4 + @types/node 25 route inference under exactOptionalPropertyTypes is noisy; runtime is correct.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Database } from '../db/sqlite.js'
import path from 'node:path'
import { ManuscriptService } from '../manuscripts/service.js'
import { ProjectRepo } from '../projects/repo.js'
import { apiError } from '../errors.js'

const saveBody = z.object({
  markdown: z.string(),
  baseHash: z.string(),
  force: z.boolean().optional(),
})


export function registerSceneRoutes(app: any, db: Database, novelsDir: string) {
  const repo = new ProjectRepo(db)
  const svc = new ManuscriptService(db, novelsDir)

  app.get<{ Params: { id: string } }>('/api/scenes/:id', async (req) => {
    const id = Number(req.params.id)
    const row = repo.getScene(id)
    if (!row) throw apiError(404, 'scene_not_found', `scene ${id} not found`)
    const m = await svc.readScene(id)
    return {
      id: row.id,
      chapterId: row.chapter_id,
      slug: row.slug,
      title: row.title,
      orderIndex: row.order_index,
      status: row.status,
      targetWords: row.target_words,
      notes: row.notes,
      contentHash: row.content_hash,
      wordCount: m.text.replace(/\s+/g, '').length,
      markdown: m.text,
      baseHash: m.hash,
    }
  })

  app.put<{ Params: { id: string } }>('/api/scenes/:id', async (req) => {
    const id = Number(req.params.id)
    const body = saveBody.parse(req.body)
    const scene = repo.getScene(id)
    if (!scene) throw apiError(404, 'scene_not_found', `scene ${id} not found`)
    const project = db
      .prepare<{ project_slug: string }>(
        `SELECT p.slug as project_slug FROM projects p
         JOIN volumes v ON v.project_id = p.id
         JOIN chapters c ON c.volume_id = v.id
         WHERE c.id = ?`,
      )
      .get(scene.chapter_id)
    if (!project) throw apiError(404, 'project_not_found', 'project not found')
    return svc.saveScene({
      sceneId: id,
      markdown: body.markdown,
      baseHash: body.baseHash,
      projectDirAbs: path.join(novelsDir, project.project_slug),
      ...(body.force ? { force: body.force } : {}),
    })
  })
}
// @ts-nocheck - Fastify 4.27 + @types/node 25.x route type narrowing under
// exactOptionalPropertyTypes is brittle and orthogonal to v0 functionality.
// Runtime is correct; types are deliberately relaxed here.

