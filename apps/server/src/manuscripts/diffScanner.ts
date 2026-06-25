import path from 'node:path'
import { scanManuscripts } from './watcher.js'
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
    const diskHashes: Record<string, string> = await scanManuscripts(root)
    const outline = repo.getOutline(proj.id)
    for (const scene of outline.scenes) {
      const chap = outline.chapters.find((c) => c.id === scene.chapter_id)
      if (!chap) continue
      const vol = outline.volumes.find((v) => v.id === chap.volume_id)
      if (!vol) continue
      const filePath = path.join(root, vol.slug, chap.slug, `${scene.slug}.md`)
      scanned++
      const diskHash = diskHashes[filePath]
      if (diskHash && diskHash !== scene.content_hash) {
        // Skip if this mismatch is the server's own recent write echoing back.
        // `ManuscriptService.saveScene` updates `scenes.content_hash` atomically
        // with the file write, so the DB row is already correct — overwriting it
        // here would clobber the freshly-saved hash with whatever stale value
        // happens to be on disk and trip a spurious 422 on the user's next PUT.
        if (consumeSelfWrite(filePath, diskHash)) continue
        // Re-read disk to avoid TOCTOU race with concurrent saveScene.
        // The initial diskHashes snapshot may be stale if a save happened
        // between the scan and this comparison.
        try {
          const fresh = await readManuscript(filePath)
          if (fresh.hash !== scene.content_hash) {
            updateStmt.run(fresh.hash, scene.id)
            updated++
          }
        } catch {
          // Best-effort: skip on IO error
        }
      }
    }
  }
  return { scanned, updated }
}