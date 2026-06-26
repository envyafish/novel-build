import type { Database } from '../db/sqlite.js'
import { writeObject, readObject } from './store.js'
import { snapshotsDir } from '../projects/paths.js'

export class SnapshotService {
  constructor(private db: Database, private projectDirAbs: string) {}

  async snapshotScene(sceneId: number, text: string, kind: 'auto' | 'manual'): Promise<string> {
    const hash = await writeObject(snapshotsDir(this.projectDirAbs), text)
    const last = this.db
      .prepare<{ hash: string | null }>('SELECT hash FROM snapshots_meta WHERE scene_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(sceneId)
    this.db
      .prepare('INSERT OR IGNORE INTO snapshots_meta (hash, kind, scene_id, created_at, parent_hash) VALUES (?, ?, ?, ?, ?)')
      .run(hash, kind, sceneId, new Date().toISOString(), last?.hash ?? null)
    return hash
  }

  /**
   * Write the snapshot object file only — does NOT touch the DB. The caller
   * is expected to insert the `snapshots_meta` row inside the surrounding
   * DB transaction so that the file write and the meta row commit atomically.
   *
   * `parent_hash` for the new row should be computed by the caller (the
   * previous-most-recent row for this scene), since that lookup should
   * happen inside the same transaction.
   */
  async writeSnapshotOnly(text: string): Promise<string> {
    return writeObject(snapshotsDir(this.projectDirAbs), text)
  }

  async restoreScene(sceneId: number, hash: string): Promise<string> {
    const text = await readObject(snapshotsDir(this.projectDirAbs), hash)
    const row = this.db
      .prepare<{ found: number }>('SELECT 1 as found FROM snapshots_meta WHERE scene_id = ? AND hash = ?')
      .get(sceneId, hash)
    if (!row) throw new Error('snapshot not found for this scene')
    return text
  }
}
