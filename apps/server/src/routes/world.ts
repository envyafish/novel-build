// @ts-nocheck - Fastify 4 + @types/node 25 route inference under exactOptionalPropertyTypes is noisy; runtime is correct.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Database } from '../db/sqlite.js'
import { ProjectRepo } from '../projects/repo.js'
import { apiError } from '../errors.js'

// --- Schemas ---

const characterBody = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  appearance: z.string().default(''),
  personality: z.string().default(''),
  background: z.string().default(''),
  relationships: z.string().default(''),
  voiceProfile: z.string().default(''),
  notes: z.string().default(''),
})

const worldElementBody = z.object({
  name: z.string().min(1),
  category: z.enum(['location', 'organization', 'item', 'concept', 'rule']).default('concept'),
  description: z.string().default(''),
  notes: z.string().default(''),
})

const timelineEventBody = z.object({
  title: z.string().min(1),
  era: z.string().default(''),
  description: z.string().default(''),
  relatedCharacterIds: z.array(z.number().int()).default([]),
  relatedWorldIds: z.array(z.number().int()).default([]),
  notes: z.string().default(''),
  orderIndex: z.number().int().default(0),
})

const foreshadowBody = z.object({
  title: z.string().min(1),
  description: z.string().default(''),
  status: z.enum(['planted', 'revealed', 'resolved']).default('planted'),
  plantedSceneId: z.number().int().nullable().optional(),
  resolvedSceneId: z.number().int().nullable().optional(),
  notes: z.string().default(''),
})

const conflictBody = z.object({
  title: z.string().min(1),
  type: z.enum(['person_vs_person', 'person_vs_self', 'person_vs_society', 'person_vs_nature', 'person_vs_fate']).default('person_vs_person'),
  description: z.string().default(''),
  relatedCharacterIds: z.array(z.number().int()).default([]),
  setup: z.string().default(''),
  escalation: z.string().default(''),
  climax: z.string().default(''),
  resolution: z.string().default(''),
  status: z.enum(['setup', 'escalation', 'climax', 'resolution']).default('setup'),
  notes: z.string().default(''),
})

// --- Helpers ---

function now() { return new Date().toISOString() }

function toCharacterDto(row: any) {
  return {
    id: row.id, projectId: row.project_id, name: row.name,
    aliases: JSON.parse(row.aliases), appearance: row.appearance,
    personality: row.personality, background: row.background,
    relationships: row.relationships, voiceProfile: row.voice_profile,
    notes: row.notes,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function toWorldDto(row: any) {
  return {
    id: row.id, projectId: row.project_id, name: row.name,
    category: row.category, description: row.description,
    notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function toTimelineDto(row: any) {
  return {
    id: row.id, projectId: row.project_id, title: row.title,
    era: row.era, description: row.description,
    relatedCharacterIds: JSON.parse(row.related_character_ids),
    relatedWorldIds: JSON.parse(row.related_world_ids),
    notes: row.notes, orderIndex: row.order_index,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function toForeshadowDto(row: any) {
  return {
    id: row.id, projectId: row.project_id, title: row.title,
    description: row.description, status: row.status,
    plantedSceneId: row.planted_scene_id,
    resolvedSceneId: row.resolved_scene_id,
    notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function toConflictDto(row: any) {
  return {
    id: row.id, projectId: row.project_id, title: row.title,
    type: row.type, description: row.description,
    relatedCharacterIds: JSON.parse(row.related_character_ids),
    setup: row.setup, escalation: row.escalation,
    climax: row.climax, resolution: row.resolution,
    status: row.status, notes: row.notes,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

// --- Route Registration ---

export function registerWorldRoutes(app: any, db: Database) {
  const repo = new ProjectRepo(db)
  const requireProject = (projectIdRaw: string): number => {
    const pid = Number(projectIdRaw)
    if (!repo.getProject(pid)) throw apiError(404, 'project_not_found', `project ${pid} not found`)
    return pid
  }

  // ========== CHARACTERS ==========

  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/characters', async (req) => {
    requireProject(req.params.projectId)
    const rows = db.prepare('SELECT * FROM characters WHERE project_id = ? ORDER BY name').all(Number(req.params.projectId))
    return rows.map(toCharacterDto)
  })

  app.post<{ Params: { projectId: string } }>('/api/projects/:projectId/characters', async (req) => {
    requireProject(req.params.projectId)
    const body = characterBody.parse(req.body)
    const t = now()
    const info = db.prepare(
      'INSERT INTO characters (project_id, name, aliases, appearance, personality, background, relationships, voice_profile, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).run(Number(req.params.projectId), body.name, JSON.stringify(body.aliases), body.appearance, body.personality, body.background, body.relationships, body.voiceProfile, body.notes, t, t)
    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(info.lastInsertRowid)
    return toCharacterDto(row)
  })

  app.put<{ Params: { id: string } }>('/api/characters/:id', async (req) => {
    const body = characterBody.parse(req.body)
    const t = now()
    db.prepare(
      'UPDATE characters SET name=?, aliases=?, appearance=?, personality=?, background=?, relationships=?, voice_profile=?, notes=?, updated_at=? WHERE id=?'
    ).run(body.name, JSON.stringify(body.aliases), body.appearance, body.personality, body.background, body.relationships, body.voiceProfile, body.notes, t, Number(req.params.id))
    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(req.params.id))
    if (!row) throw apiError(404, 'not_found', 'character not found')
    return toCharacterDto(row)
  })

  app.delete<{ Params: { id: string } }>('/api/characters/:id', async (req) => {
    const info = db.prepare('DELETE FROM characters WHERE id = ?').run(Number(req.params.id))
    if (info.changes === 0) throw apiError(404, 'not_found', 'character not found')
    return { ok: true }
  })

  // ========== WORLD ELEMENTS ==========

  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/world-elements', async (req) => {
    requireProject(req.params.projectId)
    const rows = db.prepare('SELECT * FROM world_elements WHERE project_id = ? ORDER BY category, name').all(Number(req.params.projectId))
    return rows.map(toWorldDto)
  })

  app.post<{ Params: { projectId: string } }>('/api/projects/:projectId/world-elements', async (req) => {
    requireProject(req.params.projectId)
    const body = worldElementBody.parse(req.body)
    const t = now()
    const info = db.prepare(
      'INSERT INTO world_elements (project_id, name, category, description, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
    ).run(Number(req.params.projectId), body.name, body.category, body.description, body.notes, t, t)
    const row = db.prepare('SELECT * FROM world_elements WHERE id = ?').get(info.lastInsertRowid)
    return toWorldDto(row)
  })

  app.put<{ Params: { id: string } }>('/api/world-elements/:id', async (req) => {
    const body = worldElementBody.parse(req.body)
    const t = now()
    db.prepare(
      'UPDATE world_elements SET name=?, category=?, description=?, notes=?, updated_at=? WHERE id=?'
    ).run(body.name, body.category, body.description, body.notes, t, Number(req.params.id))
    const row = db.prepare('SELECT * FROM world_elements WHERE id = ?').get(Number(req.params.id))
    if (!row) throw apiError(404, 'not_found', 'world element not found')
    return toWorldDto(row)
  })

  app.delete<{ Params: { id: string } }>('/api/world-elements/:id', async (req) => {
    const info = db.prepare('DELETE FROM world_elements WHERE id = ?').run(Number(req.params.id))
    if (info.changes === 0) throw apiError(404, 'not_found', 'world element not found')
    return { ok: true }
  })

  // ========== TIMELINE EVENTS ==========

  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/timeline', async (req) => {
    requireProject(req.params.projectId)
    const rows = db.prepare('SELECT * FROM timeline_events WHERE project_id = ? ORDER BY order_index').all(Number(req.params.projectId))
    return rows.map(toTimelineDto)
  })

  app.post<{ Params: { projectId: string } }>('/api/projects/:projectId/timeline', async (req) => {
    requireProject(req.params.projectId)
    const body = timelineEventBody.parse(req.body)
    const t = now()
    const info = db.prepare(
      'INSERT INTO timeline_events (project_id, title, era, description, related_character_ids, related_world_ids, notes, order_index, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(Number(req.params.projectId), body.title, body.era, body.description, JSON.stringify(body.relatedCharacterIds), JSON.stringify(body.relatedWorldIds), body.notes, body.orderIndex, t, t)
    const row = db.prepare('SELECT * FROM timeline_events WHERE id = ?').get(info.lastInsertRowid)
    return toTimelineDto(row)
  })

  app.put<{ Params: { id: string } }>('/api/timeline/:id', async (req) => {
    const body = timelineEventBody.parse(req.body)
    const t = now()
    db.prepare(
      'UPDATE timeline_events SET title=?, era=?, description=?, related_character_ids=?, related_world_ids=?, notes=?, order_index=?, updated_at=? WHERE id=?'
    ).run(body.title, body.era, body.description, JSON.stringify(body.relatedCharacterIds), JSON.stringify(body.relatedWorldIds), body.notes, body.orderIndex, t, Number(req.params.id))
    const row = db.prepare('SELECT * FROM timeline_events WHERE id = ?').get(Number(req.params.id))
    if (!row) throw apiError(404, 'not_found', 'timeline event not found')
    return toTimelineDto(row)
  })

  app.delete<{ Params: { id: string } }>('/api/timeline/:id', async (req) => {
    const info = db.prepare('DELETE FROM timeline_events WHERE id = ?').run(Number(req.params.id))
    if (info.changes === 0) throw apiError(404, 'not_found', 'timeline event not found')
    return { ok: true }
  })

  // ========== FORESHADOWS ==========

  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/foreshadows', async (req) => {
    requireProject(req.params.projectId)
    const rows = db.prepare('SELECT * FROM foreshadows WHERE project_id = ? ORDER BY created_at DESC').all(Number(req.params.projectId))
    return rows.map(toForeshadowDto)
  })

  app.post<{ Params: { projectId: string } }>('/api/projects/:projectId/foreshadows', async (req) => {
    requireProject(req.params.projectId)
    const body = foreshadowBody.parse(req.body)
    const t = now()
    const info = db.prepare(
      'INSERT INTO foreshadows (project_id, title, description, status, planted_scene_id, resolved_scene_id, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(Number(req.params.projectId), body.title, body.description, body.status, body.plantedSceneId ?? null, body.resolvedSceneId ?? null, body.notes, t, t)
    const row = db.prepare('SELECT * FROM foreshadows WHERE id = ?').get(info.lastInsertRowid)
    return toForeshadowDto(row)
  })

  app.put<{ Params: { id: string } }>('/api/foreshadows/:id', async (req) => {
    const body = foreshadowBody.parse(req.body)
    const t = now()
    db.prepare(
      'UPDATE foreshadows SET title=?, description=?, status=?, planted_scene_id=?, resolved_scene_id=?, notes=?, updated_at=? WHERE id=?'
    ).run(body.title, body.description, body.status, body.plantedSceneId ?? null, body.resolvedSceneId ?? null, body.notes, t, Number(req.params.id))
    const row = db.prepare('SELECT * FROM foreshadows WHERE id = ?').get(Number(req.params.id))
    if (!row) throw apiError(404, 'not_found', 'foreshadow not found')
    return toForeshadowDto(row)
  })

  app.delete<{ Params: { id: string } }>('/api/foreshadows/:id', async (req) => {
    const info = db.prepare('DELETE FROM foreshadows WHERE id = ?').run(Number(req.params.id))
    if (info.changes === 0) throw apiError(404, 'not_found', 'foreshadow not found')
    return { ok: true }
  })

  // ========== CONFLICTS ==========

  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/conflicts', async (req) => {
    requireProject(req.params.projectId)
    const rows = db.prepare('SELECT * FROM conflicts WHERE project_id = ? ORDER BY created_at DESC').all(Number(req.params.projectId))
    return rows.map(toConflictDto)
  })

  app.post<{ Params: { projectId: string } }>('/api/projects/:projectId/conflicts', async (req) => {
    requireProject(req.params.projectId)
    const body = conflictBody.parse(req.body)
    const t = now()
    const info = db.prepare(
      'INSERT INTO conflicts (project_id, title, type, description, related_character_ids, setup, escalation, climax, resolution, status, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(Number(req.params.projectId), body.title, body.type, body.description, JSON.stringify(body.relatedCharacterIds), body.setup, body.escalation, body.climax, body.resolution, body.status, body.notes, t, t)
    const row = db.prepare('SELECT * FROM conflicts WHERE id = ?').get(info.lastInsertRowid)
    return toConflictDto(row)
  })

  app.put<{ Params: { id: string } }>('/api/conflicts/:id', async (req) => {
    const body = conflictBody.parse(req.body)
    const t = now()
    db.prepare(
      'UPDATE conflicts SET title=?, type=?, description=?, related_character_ids=?, setup=?, escalation=?, climax=?, resolution=?, status=?, notes=?, updated_at=? WHERE id=?'
    ).run(body.title, body.type, body.description, JSON.stringify(body.relatedCharacterIds), body.setup, body.escalation, body.climax, body.resolution, body.status, body.notes, t, Number(req.params.id))
    const row = db.prepare('SELECT * FROM conflicts WHERE id = ?').get(Number(req.params.id))
    if (!row) throw apiError(404, 'not_found', 'conflict not found')
    return toConflictDto(row)
  })

  app.delete<{ Params: { id: string } }>('/api/conflicts/:id', async (req) => {
    const info = db.prepare('DELETE FROM conflicts WHERE id = ?').run(Number(req.params.id))
    if (info.changes === 0) throw apiError(404, 'not_found', 'conflict not found')
    return { ok: true }
  })

  // ========== WORLD SUMMARY (for AI context injection) ==========

  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/world-summary', async (req) => {
    const pid = requireProject(req.params.projectId)
    const project = db.prepare('SELECT theme FROM projects WHERE id = ?').get(pid) as { theme: string } | undefined
    const chars = db.prepare('SELECT name, personality, appearance FROM characters WHERE project_id = ?').all(pid)
    const worlds = db.prepare('SELECT name, category, description FROM world_elements WHERE project_id = ?').all(pid)
    const timeline = db.prepare('SELECT title, era, description FROM timeline_events WHERE project_id = ? ORDER BY order_index').all(pid)
    const foreshadows = db.prepare('SELECT title, description, status FROM foreshadows WHERE project_id = ?').all(pid)
    const conflicts = db.prepare('SELECT title, type, description, status FROM conflicts WHERE project_id = ?').all(pid)

    let summary = ''
    if (project?.theme) {
      summary += `## Theme\n${project.theme}\n`
    }
    if (chars.length > 0) {
      summary += '## Characters\n'
      for (const c of chars) {
        summary += `- **${c.name}**${c.personality ? ': ' + c.personality : ''}${c.appearance ? ' | Appearance: ' + c.appearance : ''}\n`
      }
    }
    if (worlds.length > 0) {
      summary += '\n## World\n'
      for (const w of worlds) {
        summary += `- **${w.name}** [${w.category}]${w.description ? ': ' + w.description : ''}\n`
      }
    }
    if (timeline.length > 0) {
      summary += '\n## Timeline\n'
      for (const t of timeline) {
        summary += `- ${t.era ? `[${t.era}] ` : ''}${t.title}${t.description ? ': ' + t.description : ''}\n`
      }
    }
    if (foreshadows.length > 0) {
      summary += '\n## Foreshadowing\n'
      for (const f of foreshadows) {
        const statusLabel = f.status === 'planted' ? '🌱埋设' : f.status === 'revealed' ? '👁️揭示' : '✅回收'
        summary += `- **${f.title}** (${statusLabel})${f.description ? ': ' + f.description : ''}\n`
      }
    }
    if (conflicts.length > 0) {
      summary += '\n## Conflicts\n'
      for (const c of conflicts) {
        const phaseLabel = c.status === 'setup' ? '铺垫' : c.status === 'escalation' ? '升级' : c.status === 'climax' ? '高潮' : '解决'
        summary += `- **${c.title}** [${c.type}] (${phaseLabel})${c.description ? ': ' + c.description : ''}\n`
      }
    }

    return { summary, counts: { characters: chars.length, worldElements: worlds.length, timeline: timeline.length, foreshadows: foreshadows.length, conflicts: conflicts.length } }
  })
}
