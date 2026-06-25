/**
 * In-process registry of "self-writes" — files the server itself wrote within
 * the last few seconds. Used by `syncDiskHashes` to distinguish a hash
 * mismatch caused by the server's own `writeManuscript` from a real external
 * edit. Without this guard, the periodic scanner would silently overwrite
 * `scenes.content_hash` to the value on disk and the user's next PUT would
 * see a stale `baseHash`, triggering a spurious 422 `external_change`.
 *
 * Window rationale: `syncDiskHashes` runs every ~60s. A 5s window is long
 * enough to cover any "wrote the file just before the scanner ticked" race,
 * and short enough that a user's subsequent intentional save is not masked
 * by a stale entry.
 */

const TTL_MS = 5_000

interface SelfWriteEntry {
  hash: string
  writtenAt: number
}

const SELF_WRITES = new Map<string, SelfWriteEntry>()

export function recordSelfWrite(filePath: string, hash: string, now = Date.now()): void {
  SELF_WRITES.set(filePath, { hash, writtenAt: now })
}

/**
 * Returns true if `filePath` was written by the server within the TTL window
 * AND the disk hash still matches what we wrote. In that case the caller
 * should skip updating `scenes.content_hash` because the DB row was already
 * updated atomically with the file write in `ManuscriptService.saveScene`.
 */
export function consumeSelfWrite(filePath: string, diskHash: string, now = Date.now()): boolean {
  const rec = SELF_WRITES.get(filePath)
  if (!rec) return false
  if (now - rec.writtenAt > TTL_MS) {
    SELF_WRITES.delete(filePath)
    return false
  }
  if (rec.hash !== diskHash) return false
  return true
}

/** Test-only: reset all recorded entries so cases don't leak between tests. */
export function _clearSelfWrites(): void {
  SELF_WRITES.clear()
}