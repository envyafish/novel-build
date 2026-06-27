import type { Database } from '../db/sqlite.js'
import path from 'node:path'
import { writeManuscript, readManuscript } from './io.js'
import { manuscriptPath, projectDir } from '../projects/paths.js'
import { apiError } from '../errors.js'
import { SnapshotService } from '../snapshots/service.js'
import { withProjectLock } from './mutex.js'

interface SaveSceneInput {
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
    // Pre-transaction lookups: resolve scene + project_id so we can scope the lock.
    const scene = this.db
      .prepare<{ id: number; content_hash: string; project_id: number }>(
        `SELECT s.id, s.content_hash, v.project_id as project_id
         FROM scenes s JOIN chapters c ON s.chapter_id = c.id
         JOIN volumes v ON c.volume_id = v.id WHERE s.id = ?`,
      )
      .get(input.sceneId)
    if (!scene) throw apiError(404, 'scene_not_found', `scene ${input.sceneId} not found`)

    const projectId = scene.project_id

    return withProjectLock(projectId, async () => {
      // Re-read content_hash from DB under the lock. The pre-lock read above
      // may be stale if a concurrent save completed between the initial query
      // and acquiring the per-project mutex.
      const freshHash = this.db
        .prepare<{ content_hash: string }>('SELECT content_hash FROM scenes WHERE id = ?')
        .get(input.sceneId)
      if (!freshHash) throw apiError(404, 'scene_not_found', `scene ${input.sceneId} not found`)

      // Re-read the file under the per-project lock. This is the canonical
      // baseHash check and the source of the old text for the word-count delta.
      // If a concurrent save raced us, we'll see the new content here and either
      // throw 422 (baseHash mismatch) or compute delta against the new baseline.
      const onDisk = await this.readScene(input.sceneId)

      if (!input.force && freshHash.content_hash !== input.baseHash) {
        throw apiError(422, 'external_change', 'manuscript changed on disk', 'reload the scene', { externalHash: onDisk.hash })
      }

      // Compute word counts from in-memory strings — no extra file read.
      const oldWords = onDisk.text.replace(/\s+/g, '').length
      const newWords = input.markdown.replace(/\s+/g, '').length
      const delta = newWords - oldWords

      const loc = this.getProjectDirForScene(input.sceneId)
      const file = manuscriptPath(input.projectDirAbs, loc.volSlug, loc.chapSlug, loc.sceneSlug)

      // File writes happen OUTSIDE the DB transaction:
      //   - writeManuscript is already atomic (temp + fsync + rename + recordSelfWrite).
      //   - The snapshot object is content-addressed; if the subsequent DB write
      //     fails we leave an orphan snapshot file behind, which is harmless
      //     (no DB row references it; existing GC will reclaim it).
      // Doing these outside the transaction means the transaction body stays
      // purely synchronous, so BEGIN IMMEDIATE works as intended.
      const newHash = await writeManuscript(file, input.markdown)

      let snapshotHash: string | null = null
      if (input.createSnapshot ?? true) {
        const snaps = new SnapshotService(this.db, input.projectDirAbs)
        // Snapshot the OLD text so the user can restore to the pre-save state.
        snapshotHash = await snaps.writeSnapshotOnly(onDisk.text)
      }

      // All DB writes commit atomically. BEGIN IMMEDIATE acquires the write
      // lock at the start, which combined with the per-project mutex above
      // means we cannot race with another saveScene on the same project.
      const now = new Date().toISOString()
      this.db.runInWriteTx(() => {
        this.db
          .prepare('UPDATE scenes SET content_hash = ? WHERE id = ?')
          .run(newHash, input.sceneId)

        if (snapshotHash) {
          const last = this.db
            .prepare<{ hash: string | null }>('SELECT hash FROM snapshots_meta WHERE scene_id = ? ORDER BY created_at DESC LIMIT 1')
            .get(input.sceneId)
          this.db
            .prepare('INSERT OR IGNORE INTO snapshots_meta (hash, kind, scene_id, created_at, parent_hash) VALUES (?, ?, ?, ?, ?)')
            .run(snapshotHash, 'auto', input.sceneId, now, last?.hash ?? null)
        }

        if (delta !== 0) {
          const today = now.slice(0, 10) // YYYY-MM-DD
          this.db
            .prepare(
              `INSERT INTO daily_word_log (project_id, date, words_added) VALUES (?, ?, ?)
               ON CONFLICT(project_id, date) DO UPDATE SET words_added = words_added + excluded.words_added`,
            )
            .run(projectId, today, delta)
        }
      })

      return { hash: newHash }
    })
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
