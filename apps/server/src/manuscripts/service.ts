import type { Database } from '../db/sqlite.js'
import path from 'node:path'
import { writeManuscript, readManuscript } from './io.js'
import { manuscriptPath, projectDir } from '../projects/paths.js'
import { apiError } from '../errors.js'
import { SnapshotService } from '../snapshots/service.js'

export interface SaveSceneInput {
  sceneId: number
  markdown: string
  baseHash: string
  projectDirAbs: string
  createSnapshot?: boolean
  /** When true, skip the baseHash guard and overwrite the manuscript regardless of disk state. */
  force?: boolean
}

interface SceneLocation {
  volSlug: string
  chapSlug: string
  sceneSlug: string
  projectDirAbs: string
}

export class ManuscriptService {
  constructor(private db: Database, private novelsDir: string) {}

  private getProjectDirForScene(sceneId: number): SceneLocation {
    const row = this.db
      .prepare<{ vol_slug: string; chap_slug: string; scene_slug: string; project_slug: string }>(
        `SELECT v.slug as vol_slug, c.slug as chap_slug, s.slug as scene_slug, p.slug as project_slug
         FROM scenes s JOIN chapters c ON s.chapter_id = c.id
         JOIN volumes v ON c.volume_id = v.id
         JOIN projects p ON v.project_id = p.id WHERE s.id = ?`,
      )
      .get(sceneId)
    if (!row) throw apiError(404, 'scene_not_found', `scene ${sceneId} not found`)
    return {
      volSlug: row.vol_slug,
      chapSlug: row.chap_slug,
      sceneSlug: row.scene_slug,
      projectDirAbs: projectDir(this.novelsDir, row.project_slug),
    }
  }

  async readScene(sceneId: number): Promise<{ text: string; hash: string }> {
    const loc = this.getProjectDirForScene(sceneId)
    const file = manuscriptPath(loc.projectDirAbs, loc.volSlug, loc.chapSlug, loc.sceneSlug)
    return readManuscript(file)
  }

  async saveScene(input: SaveSceneInput): Promise<{ hash: string }> {
    const scene = this.db
      .prepare<{ id: number; content_hash: string }>('SELECT id, content_hash FROM scenes WHERE id = ?')
      .get(input.sceneId)
    if (!scene) throw apiError(404, 'scene_not_found', `scene ${input.sceneId} not found`)
    if (!input.force && scene.content_hash !== input.baseHash) {
      const onDisk = await this.readScene(input.sceneId)
      throw apiError(422, 'external_change', 'manuscript changed on disk', 'reload the scene', { externalHash: onDisk.hash })
    }

    // Calculate word count delta for daily tracking
    const oldText = await this.readScene(input.sceneId).then(r => r.text).catch(() => '')
    const oldWords = oldText.replace(/\s+/g, '').length
    const newWords = input.markdown.replace(/\s+/g, '').length
    const delta = newWords - oldWords

    const loc = this.getProjectDirForScene(input.sceneId)
    const file = manuscriptPath(input.projectDirAbs, loc.volSlug, loc.chapSlug, loc.sceneSlug)
    const newHash = await writeManuscript(file, input.markdown)
    if (input.createSnapshot ?? true) {
      const snaps = new SnapshotService(this.db, input.projectDirAbs)
      await snaps.snapshotScene(input.sceneId, input.markdown, 'auto')
    }
    this.db
      .prepare<{ lastInsertRowid: number; changes: number }>('UPDATE scenes SET content_hash = ? WHERE id = ?')
      .run(newHash, input.sceneId)

    // Track daily word count
    if (delta !== 0) {
      const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
      const projectId = this.getProjectIdForScene(input.sceneId)
      if (projectId) {
        this.db
          .prepare(
            `INSERT INTO daily_word_log (project_id, date, words_added) VALUES (?, ?, ?)
             ON CONFLICT(project_id, date) DO UPDATE SET words_added = words_added + ?`,
          )
          .run(projectId, today, delta, delta)
      }
    }

    return { hash: newHash }
  }

  private getProjectIdForScene(sceneId: number): number | null {
    const row = this.db
      .prepare<{ project_id: number }>(
        `SELECT v.project_id as project_id FROM scenes s
         JOIN chapters c ON s.chapter_id = c.id
         JOIN volumes v ON c.volume_id = v.id WHERE s.id = ?`,
      )
      .get(sceneId)
    return row?.project_id ?? null
  }

  async listSnapshots(sceneId: number, projectDirAbs: string) {
    const rows = this.db
      .prepare<{ hash: string; kind: 'auto' | 'manual'; created_at: string; parent_hash: string | null }>(
        'SELECT hash, kind, created_at, parent_hash FROM snapshots_meta WHERE scene_id = ? ORDER BY created_at DESC',
      )
      .all(sceneId)
    return rows.map((r) => ({
      hash: r.hash,
      kind: r.kind,
      sceneId: sceneId,
      createdAt: r.created_at,
      parentHash: r.parent_hash,
    }))
  }
}
