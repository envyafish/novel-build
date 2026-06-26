import { useEffect, useRef, useCallback } from 'react'

/**
 * Debounce `save(value)`. The first render is skipped (so consumers don't
 * save on mount). After `delayMs` of `value` being stable, the latest
 * `save` callback fires with the latest value.
 *
 * Returns a `flush()` callback that fires the pending save immediately
 * (if any) and clears the timer. Call this BEFORE navigating away from
 * the scene — otherwise a debounced save that hasn't fired yet will fire
 * after the scene has changed, writing the new content into the wrong
 * scene row.
 *
 * `value` identity MUST change to trigger a save: pass a new string/array,
 * not a reused reference. The hook does a strict-equality comparison.
 */
export function useDebouncedSave<T>(
  value: T,
  save: (v: T) => void,
  delayMs = 800,
): { flush: () => void; pending: boolean } {
  const first = useRef(true)
  // Hold the latest save callback in a ref so the timer doesn't reset every
  // time the consumer passes a new function identity (e.g. when baseHash updates).
  const saveRef = useRef(save)
  saveRef.current = save
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef(false)
  const valueRef = useRef(value)
  valueRef.current = value

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (pendingRef.current) {
      pendingRef.current = false
      saveRef.current(valueRef.current)
    }
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
      saveRef.current(value)
    }, delayMs)
    timerRef.current = t
    return () => {
      clearTimeout(t)
      if (timerRef.current === t) timerRef.current = null
    }
  }, [value, delayMs])

  return { flush, get pending() { return pendingRef.current } }
}