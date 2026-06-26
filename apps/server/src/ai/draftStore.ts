import crypto from 'node:crypto'
import type { Database } from '../db/sqlite.js'

export type DraftStatus = 'streaming' | 'done' | 'error' | 'aborted'

export interface DraftRow {
  id: string
  project_id: number
  scene_id: number | null
  mode: string
  model: string
  text: string
  status: DraftStatus
  error_message: string | null
  max_output_tokens: number
  usage_prompt_tokens: number
  usage_completion_tokens: number
  created_at: string
  updated_at: string
  expires_at: string
}

interface CreateDraftInput {
  projectId: number
  sceneId?: number | null
  mode: string
  model: string
  maxOutputTokens?: number
  ttlMs?: number
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export class DraftStore {
  constructor(private db: Database) {}

  create(input: CreateDraftInput): DraftRow {
    const now = new Date().toISOString()
    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS
    const expiresAt = new Date(Date.now() + ttlMs).toISOString()
    const id = crypto.randomUUID()
    this.db
      .prepare(
        `INSERT INTO ai_drafts (id, project_id, scene_id, mode, model, text, status, max_output_tokens, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, '', 'streaming', ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.sceneId ?? null,
        input.mode,
        input.model,
        input.maxOutputTokens ?? 0,
        now,
        now,
        expiresAt,
      )
    return this.get(id)!
  }

  get(id: string): DraftRow | undefined {
    return this.db.prepare<DraftRow>('SELECT * FROM ai_drafts WHERE id = ?').get(id)
  }

  listActiveByScene(sceneId: number): DraftRow[] {
    return this.db
      .prepare<DraftRow>(
        `SELECT * FROM ai_drafts WHERE scene_id = ? AND status = 'streaming' ORDER BY created_at DESC`,
      )
      .all(sceneId)
  }

  listActiveByProject(projectId: number): DraftRow[] {
    return this.db
      .prepare<DraftRow>(
        `SELECT * FROM ai_drafts WHERE project_id = ? AND status = 'streaming' ORDER BY created_at DESC`,
      )
      .all(projectId)
  }

  appendText(id: string, delta: string): void {
    const now = new Date().toISOString()
    this.db
      .prepare(`UPDATE ai_drafts SET text = text || ?, updated_at = ? WHERE id = ?`)
      .run(delta, now, id)
  }

  setStatus(id: string, status: DraftStatus, errorMessage?: string | null): void {
    const now = new Date().toISOString()
    this.db
      .prepare(`UPDATE ai_drafts SET status = ?, error_message = ?, updated_at = ? WHERE id = ?`)
      .run(status, errorMessage ?? null, now, id)
  }

  setUsage(id: string, promptTokens: number, completionTokens: number): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE ai_drafts SET usage_prompt_tokens = ?, usage_completion_tokens = ?, updated_at = ? WHERE id = ?`,
      )
      .run(promptTokens, completionTokens, now, id)
  }

  delete(id: string): boolean {
    const r = this.db.prepare(`DELETE FROM ai_drafts WHERE id = ?`).run(id)
    return r.changes > 0
  }

  /** Periodic cleanup of expired drafts. */
  purgeExpired(now = Date.now()): number {
    const iso = new Date(now).toISOString()
    const r = this.db.prepare(`DELETE FROM ai_drafts WHERE expires_at < ?`).run(iso)
    return r.changes
  }
}

export interface DraftDto {
  id: string
  projectId: number
  sceneId: number | null
  mode: string
  model: string
  text: string
  status: DraftStatus
  errorMessage: string | null
  maxOutputTokens: number
  usage: { promptTokens: number; completionTokens: number }
  createdAt: string
  updatedAt: string
  expiresAt: string
}

export function toDraftDto(r: DraftRow): DraftDto {
  return {
    id: r.id,
    projectId: r.project_id,
    sceneId: r.scene_id,
    mode: r.mode,
    model: r.model,
    text: r.text,
    status: r.status,
    errorMessage: r.error_message,
    maxOutputTokens: r.max_output_tokens,
    usage: {
      promptTokens: r.usage_prompt_tokens,
      completionTokens: r.usage_completion_tokens,
    },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    expiresAt: r.expires_at,
  }
}