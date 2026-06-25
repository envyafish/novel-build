// @ts-nocheck - Fastify 4 + @types/node 25 route inference under exactOptionalPropertyTypes is noisy; runtime is correct.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Database } from '../db/sqlite.js'
import { ProjectRepo } from '../projects/repo.js'
import { apiError } from '../errors.js'
import { DraftStore, toDraftDto } from './draftStore.js'

const createBody = z.object({
  projectId: z.number().int(),
  sceneId: z.number().int().nullable().optional(),
  mode: z.string().min(1),
  model: z.string().min(1),
  maxOutputTokens: z.number().int().min(0).optional(),
  ttlMs: z.number().int().min(1000).optional(),
})

export function registerDraftRoutes(app: any, db: Database) {
  const repo = new ProjectRepo(db)
  const store = new DraftStore(db)

  // POST /api/ai/drafts — create a new draft (returns id)
  app.post('/api/ai/drafts', async (req) => {
    const body = createBody.parse(req.body)
    if (!repo.getProject(body.projectId)) {
      throw apiError(404, 'project_not_found', `project ${body.projectId} not found`)
    }
    const opts: { projectId: number; mode: string; model: string; maxOutputTokens?: number; ttlMs?: number; sceneId?: number | null } = {
      projectId: body.projectId,
      mode: body.mode,
      model: body.model,
    }
    if (body.sceneId !== undefined) opts.sceneId = body.sceneId
    if (body.maxOutputTokens !== undefined) opts.maxOutputTokens = body.maxOutputTokens
    if (body.ttlMs !== undefined) opts.ttlMs = body.ttlMs
    const draft = store.create(opts)
    return toDraftDto(draft)
  })

  // GET /api/ai/drafts/:id — read a draft
  app.get<{ Params: { id: string } }>('/api/ai/drafts/:id', async (req) => {
    const draft = store.get(req.params.id)
    if (!draft) throw apiError(404, 'draft_not_found', `draft ${req.params.id} not found`)
    return toDraftDto(draft)
  })

  // GET /api/ai/drafts?sceneId=X — list in-flight drafts for a scene
  app.get<{ Querystring: { sceneId?: string; projectId?: string } }>(
    '/api/ai/drafts',
    async (req) => {
      const sceneId = req.query.sceneId ? Number(req.query.sceneId) : null
      const projectId = req.query.projectId ? Number(req.query.projectId) : null
      let drafts
      if (sceneId !== null && !Number.isNaN(sceneId)) {
        drafts = store.listActiveByScene(sceneId)
      } else if (projectId !== null && !Number.isNaN(projectId)) {
        drafts = store.listActiveByProject(projectId)
      } else {
        throw apiError(400, 'missing_params', 'sceneId or projectId required')
      }
      return drafts.map(toDraftDto)
    },
  )

  // DELETE /api/ai/drafts/:id — accept/cancel cleanup
  app.delete<{ Params: { id: string } }>('/api/ai/drafts/:id', async (req) => {
    const ok = store.delete(req.params.id)
    if (!ok) throw apiError(404, 'draft_not_found', `draft ${req.params.id} not found`)
    return { ok: true }
  })
}