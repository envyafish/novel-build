/**
 * Per-project async mutex. Used by `ManuscriptService.saveScene` so that
 * concurrent saves to the same project serialize, which prevents the
 * `daily_word_log` double-count race documented in `business-logic.md §2.3`.
 *
 * Different projects proceed in parallel. The lock is fair (FIFO) in the
 * sense that each new caller chains onto the previous tail; under contention
 * each `fn()` is invoked strictly after the previous one resolves.
 *
 * If `fn()` throws, the lock is still released (the chain stays alive so the
 * NEXT caller can proceed) and the error is re-thrown to the caller.
 */

const locks = new Map<number, Promise<unknown>>()

export async function withProjectLock<T>(projectId: number, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(projectId) ?? Promise.resolve()
  let release!: () => void
  const next = new Promise<void>((resolve) => {
    release = resolve
  })
  // The chain tail for the NEXT caller. We deliberately store `prev.then(() => next)`
  // so callers arriving later see this caller's tail, not the original prev.
  locks.set(projectId, prev.then(() => next))
  try {
    await prev
    return await fn()
  } finally {
    release()
  }
}

/** Test-only: clear all locks. */
export function _clearLocks(): void {
  locks.clear()
}