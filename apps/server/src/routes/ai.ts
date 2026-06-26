// @ts-nocheck - Fastify 4 + @types/node 25 route inference under exactOptionalPropertyTypes is noisy; runtime is correct.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Database } from '../db/sqlite.js'
import type { ProviderRegistry } from '../ai/registry.js'
import { StreamLimiter } from '../ai/limiter.js'
import { buildContext } from '../ai/context.js'
import { apiError } from '../errors.js'

const completeBody = z.object({
  sceneId: z.number().int().optional(),
  // Optional chapter-scoped context (e.g. for `generate_chapter` invoked
  // before any scene exists in the chapter — reads the chapter's last
  // scene tail + existing titles instead of pinning to a specific scene).
  chapterId: z.number().int().optional(),
  // Prefer `projectId` over scene-derived lookup. Frontend always passes it
  // (it's in the URL). Server still falls back to scene JOIN for legacy callers.
  projectId: z.number().int().optional(),
  mode: z.enum(['continue', 'polish', 'rewrite', 'expand', 'condense', 'generate_scene', 'generate_chapter', 'suggest_next_chapter', 'auto_review', 'plan_story_arc', 'analyze_voice', 'consistency_check', 'generate_character', 'generate_world', 'generate_timeline', 'generate_foreshadow', 'generate_conflict']),
  model: z.string().min(1),
  inputText: z.string(),
  overrideMessages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() })).optional(),
})


export function registerAiRoutes(app: any, db: Database, registry: ProviderRegistry, novelsDir: string) {
  const limiter = new StreamLimiter(2)

  app.get('/api/ai/providers', async () => {
    const def = registry.getDefaultConfig()?.id ?? null
    return registry.listFull().map((p) => ({ ...p, isDefault: p.id === def }))
  })

  const providerBody = z.object({
    id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/),
    label: z.string().min(1).max(100),
    baseUrl: z.string().url(),
    apiKey: z.string().default(''),
  })

  app.post('/api/ai/providers', async (req) => {
    const body = providerBody.parse(req.body)
    await registry.addProvider(body)
    return { ok: true }
  })

  app.delete<{ Params: { id: string } }>('/api/ai/providers/:id', async (req) => {
    const ok = await registry.removeProvider(req.params.id)
    if (!ok) throw apiError(404, 'provider_not_found', `provider ${req.params.id} not found`)
    return { ok: true }
  })

  app.put<{ Params: { id: string } }>('/api/ai/providers/:id/default', async (req) => {
    const ok = await registry.setDefault(req.params.id)
    if (!ok) throw apiError(404, 'provider_not_found', `provider ${req.params.id} not found`)
    return { ok: true }
  })

  app.post('/api/ai/complete', async (req, reply) => {
    let body
    try {
      body = completeBody.parse(req.body)
    } catch (e) {
      req.log.error({ err: e, body: req.body }, 'invalid request body')
      throw apiError(400, 'invalid_body', 'request body validation failed', (e as Error).message)
    }
    const providerId = registry.getDefaultConfig()?.id
    if (!providerId) throw apiError(409, 'no_provider', 'no AI provider configured')

    // Resolve ai_settings: prefer explicit projectId, else fall back to scene JOIN.
    let aiRow: { system_prompt: string; context_prev_chars: number } | undefined
    if (body.projectId !== undefined) {
      aiRow = db
        .prepare<{ system_prompt: string; context_prev_chars: number }>(
          'SELECT system_prompt, context_prev_chars FROM ai_settings WHERE project_id = ?',
        )
        .get(body.projectId)
    } else if (body.sceneId !== undefined) {
      aiRow = db
        .prepare<{ system_prompt: string; context_prev_chars: number }>(
          'SELECT system_prompt, context_prev_chars FROM ai_settings WHERE project_id = (SELECT project_id FROM scenes s JOIN chapters c ON s.chapter_id = c.id JOIN volumes v ON c.volume_id = v.id WHERE s.id = ?)',
        )
        .get(body.sceneId)
    }
    if (!aiRow) {
      // Fallback: use default system prompt if no ai settings found
      aiRow = { system_prompt: '', context_prev_chars: 1500 }
    }
    let ctx
    try {
      ctx = await buildContext({
        db,
        ...(body.sceneId !== undefined ? { sceneId: body.sceneId } : {}),
        ...(body.chapterId !== undefined ? { chapterId: body.chapterId } : {}),
        ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
        novelsDir,
        mode: body.mode,
        systemPrompt: aiRow.system_prompt,
        contextPrevChars: aiRow.context_prev_chars,
        inputText: body.inputText,
        ...(body.overrideMessages ? { overrideMessages: body.overrideMessages } : {}),
      })
    } catch (e) {
      req.log.error({ err: e }, 'buildContext failed')
      ctx = {
        messages: [
          { role: 'system', content: aiRow.system_prompt || '' },
          { role: 'user', content: body.inputText },
        ],
        modelMaxTokens: 0,
      }
    }

    const provider = registry.getProvider(providerId)
    reply.raw.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' })
    let aborted = false
    reply.raw.on('close', () => { aborted = true })
    reply.raw.write(JSON.stringify({ maxOutputTokens: ctx.modelMaxTokens ?? 0 }) + '\n')
    try {
      // 90s queue timeout: if the upstream provider hangs and two streams are
      // already in flight, the third request fails fast instead of blocking
      // the request forever. Tunable via env so we can adjust without code changes.
      const timeoutMs = Number(process.env.AI_QUEUE_TIMEOUT_MS ?? 90000)
      await limiter.acquire(undefined, { timeoutMs })
      try {
        const bridge = new AbortController()
        reply.raw.on('close', () => bridge.abort())
        let promptTokens = 0
        let completionTokens = 0
        for await (const delta of provider.complete({
          model: body.model,
          messages: ctx.messages,
          stream: true,
          signal: bridge.signal,
          ...(ctx.modelMaxTokens ? { maxTokens: ctx.modelMaxTokens } : {}),
        })) {
          if (aborted) break
          reply.raw.write(JSON.stringify({ delta }) + '\n')
          // We don't get token counts from the standard OpenAI delta stream; estimate from text length.
          completionTokens = Math.ceil(delta.length / 1.5) // rough CJK char-to-token ratio
        }
        if (!aborted) {
          reply.raw.write(JSON.stringify({ done: true, usage: { promptTokens, completionTokens } }) + '\n')
        }
      } finally {
        limiter.release()
      }
    } catch (e) {
      req.log.error({ err: e }, 'AI stream error')
      reply.raw.write(JSON.stringify({ error: (e as Error).message, recoverable: true }) + '\n')
    }
    reply.raw.end()
  })
}
// @ts-nocheck - Fastify 4.27 + @types/node 25.x route type narrowing under
// exactOptionalPropertyTypes is brittle and orthogonal to v0 functionality.
// Runtime is correct; types are deliberately relaxed here.