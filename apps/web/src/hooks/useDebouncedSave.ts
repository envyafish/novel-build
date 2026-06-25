import { useEffect, useRef } from 'react'

export function useDebouncedSave<T>(value: T, save: (v: T) => void, delayMs = 800) {
  const first = useRef(true)
  // Hold the latest save callback in a ref so the timer doesn't reset every
  // time the consumer passes a new function identity (e.g. when baseHash updates).
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const t = setTimeout(() => saveRef.current(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
}
