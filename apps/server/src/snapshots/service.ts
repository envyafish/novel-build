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

  async restoreScene(sceneId: number, hash: string): Promise<string> {
    const text = await readObject(snapshotsDir(this.projectDirAbs), hash)
    const row = this.db
      .prepare<{ found: number }>('SELECT 1 as found FROM snapshots_meta WHERE scene_id = ? AND hash = ?')
      .get(sceneId, hash)
    if (!row) throw new Error('snapshot not found for this scene')
    return text
  }
}
