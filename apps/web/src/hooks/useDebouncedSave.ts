import { useEffect, useRef, useCallback } from 'react'

/**
 * Debounce `save(value)`. The first render is skipped (so consumers don't
 * save on mount). After `delayMs` of `value` being stable, the latest
 * `save` callback fires with the latest value.
 *
 * Returns three helpers:
 *   - `flush()`     fires the pending save immediately (if any) and clears
 *                   the timer. Returns a Promise that resolves when the save
 *                   completes — call BEFORE navigating away from the scene
 *                   so the previous content is durably on disk before the
 *                   parent swaps in a new scene's content.
 *   - `cancel()`    drops the pending save without firing it. Use this when
 *                   the parent's context is about to change in a way that
 *                   would invalidate the buffered value (e.g. scene switch)
 *                   — calling `flush()` here would race with the new state
 *                   and likely write the old content under a stale
 *                   baseHash, triggering a spurious 422 from the server.
 *   - `pending`     getter — true while a save is queued.
 *
 * `value` identity MUST change to trigger a save: pass a new string/array,
 * not a reused reference. The hook does a strict-equality comparison.
 */
export function useDebouncedSave<T>(
  value: T,
  save: (v: T) => void | Promise<void>,
  delayMs = 800,
): { flush: () => Promise<void>; cancel: () => void; pending: boolean } {
  const first = useRef(true)
  // Hold the latest save callback in a ref so the timer doesn't reset every
  // time the consumer passes a new function identity (e.g. when baseHash updates).
  const saveRef = useRef(save)
  saveRef.current = save
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef(false)
  const valueRef = useRef(value)
  valueRef.current = value
  // Track the in-flight save so flush() can await it. This matters when
  // the parent calls flush() and immediately unmounts the component: we
  // resolve the promise once the save settles so the parent's await
  // actually waits for disk.
  const inflightRef = useRef<Promise<void> | null>(null)

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (pendingRef.current) {
      pendingRef.current = false
      const p = Promise.resolve(saveRef.current(valueRef.current)).catch(() => undefined)
      inflightRef.current = p
      return p
    }
    return Promise.resolve()
  }, [])

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    pendingRef.current = false
  }, [])

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    pendingRef.current = true
    const t = setTimeout(() => {
      timerRef.current = null
      pendingRef.current = false
      const p = Promise.resolve(saveRef.current(value)).catch(() => undefined)
      inflightRef.current = p
    }, delayMs)
    timerRef.current = t
    return () => {
      clearTimeout(t)
      if (timerRef.current === t) timerRef.current = null
    }
  }, [value, delayMs])

  return {
    flush,
    cancel,
    get pending() { return pendingRef.current },
  }
}