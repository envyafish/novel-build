// @ts-nocheck - Fastify 4 + @types/node 25 route inference under exactOptionalPropertyTypes is noisy; runtime is correct.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ProjectRepo } from '../projects/repo.js'
import type { Database } from '../db/sqlite.js'
import { apiError } from '../errors.js'
import { manuscriptPath } from '../projects/paths.js'
import { extractJson, stripThinking } from '../util/jsonExtract.js'

const createBody = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
})

async function projectWordCount(
  novelsDir: string,
  projectSlug: string,
  paths: Array<{ volSlug: string; chapSlug: string; sceneSlug: string }>,
): Promise<number> {
  // Parallel read with allSettled so a single failure (other than ENOENT)
  // doesn't 500 the whole /stats endpoint.
  const results = await Promise.allSettled(
    paths.map(async ({ volSlug, chapSlug, sceneSlug }) => {
      const file = manuscriptPath(path.join(novelsDir, projectSlug), volSlug, chapSlug, sceneSlug)
      const text = await fs.readFile(file, 'utf8')
      return text.replace(/\s+/g, '').length
    }),
  )
  let total = 0
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.status === 'fulfilled') {
      total += r.value
      continue
    }
    const code = (r.reason as NodeJS.ErrnoException | undefined)?.code
    if (code !== 'ENOENT') throw r.reason
  }
  return total
}


export function registerProjectRoutes(app: any, db: Database, novelsDir: string) {
  const repo = new ProjectRepo(db)

  app.get('/api/projects', async () => repo.listProjectsDto())

  app.post('/api/projects', async (req) => {
    const body = createBody.parse(req.body)
    if (repo.getProjectBySlug(body.slug)) throw apiError(409, 'slug_taken', `project ${body.slug} exists`)
    return repo.toDto(repo.createProject(body.name, body.slug))
  })

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const id = Number(req.params.id)
    const p = repo.getProjectDto(id)
    if (!p) throw apiError(404, 'project_not_found', `project ${id} not found`)
    return p
  })

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const id = Number(req.params.id)
    const p = repo.getProject(id)
    if (!p) throw apiError(404, 'project_not_found', `project ${id} not found`)
    const ok = repo.deleteProject(id)
    if (!ok) throw apiError(404, 'project_not_found', `project ${id} not found`)
    // Best-effort cleanup of the on-disk project directory.
    const projectDir = path.join(novelsDir, p.slug)
    try {
      await fs.rm(projectDir, { recursive: true, force: true })
    } catch (e) {
      req.log.warn({ err: e, projectDir }, 'failed to remove project directory')
    }
    return { ok: true }
  })

  const renameBody = z.object({ name: z.string().min(1) })
  app.patch<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const id = Number(req.params.id)
    const body = renameBody.parse(req.body)
    if (!repo.getProject(id)) throw apiError(404, 'project_not_found', `project ${id} not found`)
    return repo.renameProject(id, body.name)
  })

  const themeBody = z.object({ theme: z.string() })
  app.patch<{ Params: { id: string } }>('/api/projects/:id/theme', async (req) => {
    const id = Number(req.params.id)
    const body = themeBody.parse(req.body)
    if (!repo.getProject(id)) throw apiError(404, 'project_not_found', `project ${id} not found`)
    return repo.updateTheme(id, body.theme)
  })

  const storyArcBody = z.object({ storyArcNotes: z.string() })
  app.patch<{ Params: { id: string } }>('/api/projects/:id/story-arc', async (req) => {
    const id = Number(req.params.id)
    const body = storyArcBody.parse(req.body)
    const p = repo.getProject(id)
    if (!p) throw apiError(404, 'project_not_found', `project ${id} not found`)
    db.prepare('UPDATE projects SET story_arc_notes = ?, updated_at = ? WHERE id = ?')
      .run(body.storyArcNotes, new Date().toISOString(), id)
    return repo.getProjectDto(id)
  })

  app.get<{ Params: { id: string } }>('/api/projects/:id/stats', async (req) => {
    const id = Number(req.params.id)
    const p = repo.getProject(id)
    if (!p) throw apiError(404, 'project_not_found', `project ${id} not found`)
    const stats = repo.getProjectStats(id)
    const outline = repo.getOutline(id)
    const words = await projectWordCount(
      novelsDir,
      p.slug,
      outline.scenes.map((s) => {
        const c = outline.chapters.find((c) => c.id === s.chapter_id)
        const v = c ? outline.volumes.find((v) => v.id === c.volume_id) : undefined
        return { sceneSlug: s.slug, chapSlug: c?.slug ?? '', volSlug: v?.slug ?? '' }
      }),
    )

    // Writing goals
    const goal = db.prepare<{ daily_target_words: number; weekly_target_scenes: number }>(
      'SELECT daily_target_words, weekly_target_scenes FROM writing_goals WHERE project_id = ?'
    ).get(id)

    // Today's word count from daily_word_log
    const today = new Date().toISOString().slice(0, 10)
    const todayWordsRow = db.prepare<{ words_added: number }>(
      'SELECT COALESCE(SUM(words_added), 0) as words_added FROM daily_word_log WHERE project_id = ? AND date = ?'
    ).get(id, today)
    const todayWords = todayWordsRow?.words_added ?? 0

    return { ...stats, words, todayWords, goal: goal ?? { daily_target_words: 2000, weekly_target_scenes: 5 } }
  })

  // ========== WRITING GOALS ==========
  const goalBody = z.object({
    dailyTargetWords: z.number().int().min(0).default(2000),
    weeklyTargetScenes: z.number().int().min(0).default(5),
  })

  app.put<{ Params: { id: string } }>('/api/projects/:id/writing-goal', async (req) => {
    const id = Number(req.params.id)
    if (!repo.getProject(id)) throw apiError(404, 'project_not_found', `project ${id} not found`)
    const body = goalBody.parse(req.body)
    const t = new Date().toISOString()
    const existing = db.prepare('SELECT id FROM writing_goals WHERE project_id = ?').get(id)
    if (existing) {
      db.prepare('UPDATE writing_goals SET daily_target_words=?, weekly_target_scenes=?, updated_at=? WHERE project_id=?')
        .run(body.dailyTargetWords, body.weeklyTargetScenes, t, id)
    } else {
      db.prepare('INSERT INTO writing_goals (project_id, daily_target_words, weekly_target_scenes, created_at, updated_at) VALUES (?,?,?,?,?)')
        .run(id, body.dailyTargetWords, body.weeklyTargetScenes, t, t)
    }
    return { ok: true }
  })
}
