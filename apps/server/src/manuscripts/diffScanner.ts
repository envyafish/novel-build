import path from 'node:path'
import { scanManuscripts } from './watcher.js'
import type { ManuscriptFingerprint } from './watcher.js'
import { readManuscript } from './io.js'
import { consumeSelfWrite } from './selfWriteRegistry.js'
import { ProjectRepo } from '../projects/repo.js'
import type { Database } from '../db/sqlite.js'

/**
 * Periodically compare on-disk manuscript files against `scenes.content_hash`
 * and update the DB to match disk. Closes the gap from spec §6.4 so the
 * next PUT can detect a real external change instead of always triggering 422.
 *
 * Strategy: if a scene's file exists on disk with a different hash than
 * `scenes.content_hash`, we treat the disk as authoritative and update the
 * DB. We never overwrite the on-disk file from this routine — the user's
 * external edits are preserved, and the editor will see them on next GET.
 *
 * To avoid a TOCTOU race with concurrent `saveScene` calls, we re-read
 * the disk file when a mismatch is detected rather than relying on the
 * initial scan snapshot.
 *
 * Best-effort: any IO or DB error is swallowed so the timer keeps running.
 */

/**
 * In-memory cache of last-seen disk fingerprints, keyed by absolute file path.
 * On subsequent scans we only re-hash + DB-update files whose fingerprint
 * changed since the previous scan. This is the common case for "no external
 * edits happened in the last 60s" — without this cache, every scan re-reads
 * and re-SHA256s every scene, which is O(total scenes) per tick.
 */
const lastSeen = new Map<string, ManuscriptFingerprint>()

function fingerprintsEqual(a: ManuscriptFingerprint, b: ManuscriptFingerprint): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs
}

export async function syncDiskHashes(db: Database, novelsDir: string): Promise<{ scanned: number; updated: number }> {
  const repo = new ProjectRepo(db)
  let scanned = 0
  let updated = 0
  const projects = repo.listProjects()
  const updateStmt = db.prepare<{ lastInsertRowid: number; changes: number }>(
    'UPDATE scenes SET content_hash = ? WHERE id = ?',
  )
  for (const proj of projects) {
    const root = path.join(novelsDir, proj.slug, 'manuscripts')
    const fingerprints: Record<string, ManuscriptFingerprint> = await scanManuscripts(root)
    const outline = repo.getOutline(proj.id)
    for (const scene of outline.scenes) {
      const chap = outline.chapters.find((c) => c.id === scene.chapter_id)
      if (!chap) continue
      const vol = outline.volumes.find((v) => v.id === chap.volume_id)
      if (!vol) continue
      const filePath = path.join(root, vol.slug, chap.slug, `${scene.slug}.md`)
      scanned++
      const fp = fingerprints[filePath]
      if (!fp) continue
      // Fast path: if the disk fingerprint hasn't changed since the last scan,
      // skip the file read and hash. This is the steady-state for an idle
      // editor (no external edits). After processing, update the cache for
      // next time.
      const prev = lastSeen.get(filePath)
      if (prev && fingerprintsEqual(prev, fp)) continue

      // Fingerprint changed (or first scan): hash the file and compare to DB.
      try {
        const fresh = await readManuscript(filePath)
        if (fresh.hash !== scene.content_hash) {
          // Skip if this mismatch is the server's own recent write echoing back.
          if (consumeSelfWrite(filePath, fresh.hash)) {
            lastSeen.set(filePath, fp)
            continue
          }
          updateStmt.run(fresh.hash, scene.id)
          updated++
        }
        lastSeen.set(filePath, fp)
      } catch {
        // Best-effort: skip on IO error; don't update the cache so we retry next tick.
      }
    }
  }
  return { scanned, updated }
}

/** Test-only: clear the in-memory fingerprint cache. */
export function _clearFingerprintCache(): void {
  lastSeen.clear()
}