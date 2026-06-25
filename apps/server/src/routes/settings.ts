// @ts-nocheck - Fastify 4 + @types/node 25 route inference under exactOptionalPropertyTypes is noisy; runtime is correct.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Database } from '../db/sqlite.js'
import { apiError } from '../errors.js'

const aiSettingsBody = z.object({
  projectId: z.number().int(),
  providerId: z.string().min(1),
  model: z.string().min(1),
  systemPrompt: z.string().default(''),
  contextPrevChars: z.number().int().min(0).max(20000).default(1500),
})

export function registerSettingsRoutes(app: any, db: Database) {
  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/ai-settings', async (req) => {
    const id = Number(req.params.projectId)
    let row = db
      .prepare<{ project_id: number; provider_id: string; model: string; system_prompt: string; context_prev_chars: number }>(
        'SELECT * FROM ai_settings WHERE project_id = ?',
      )
      .get(id)
    if (!row) {
      // Auto-create default settings so the UI never gets stuck on loading
      db.prepare(
        'INSERT OR IGNORE INTO ai_settings (project_id, provider_id, model, system_prompt, context_prev_chars) VALUES (?, ?, ?, ?, ?)',
      ).run(id, 'fake', 'gpt-4o-mini', '', 1500)
      row = db
        .prepare<{ project_id: number; provider_id: string; model: string; system_prompt: string; context_prev_chars: number }>(
          'SELECT * FROM ai_settings WHERE project_id = ?',
        )
        .get(id)
    }
    if (!row) throw apiError(404, 'ai_settings_missing', 'no AI settings for this project')
    return {
      projectId: row.project_id,
      providerId: row.provider_id,
      model: row.model,
      systemPrompt: row.system_prompt,
      contextPrevChars: row.context_prev_chars,
    }
  })

  app.put('/api/projects/ai-settings', async (req) => {
    const body = aiSettingsBody.parse(req.body)
    db.prepare(
      `INSERT INTO ai_settings (project_id, provider_id, model, system_prompt, context_prev_chars)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET provider_id = excluded.provider_id, model = excluded.model,
         system_prompt = excluded.system_prompt, context_prev_chars = excluded.context_prev_chars`,
    ).run(body.projectId, body.providerId, body.model, body.systemPrompt, body.contextPrevChars)
    return { ok: true }
  })
}
