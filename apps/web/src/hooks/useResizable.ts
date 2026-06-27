import { useCallback, useEffect, useRef, useState } from 'react'

interface UseResizableOptions {
  /** localStorage key for persisting the width. Pass `null` to skip. */
  storageKey: string | null
  defaultWidth: number
  min: number
  /** Upper bound — defaults to a percentage of the parent width so the
   *  sidebar can't squeeze the main content to nothing. */
  max?: number
  /** Which side the handle is on.
   *  - `right`: sidebar is on the LEFT of the screen, handle on its right edge;
   *    dragging right widens.
   *  - `left`:  sidebar is on the RIGHT of the screen, handle on its left edge;
   *    dragging right shrinks. */
  side: 'right' | 'left'
}

/**
 * Pointer-event-driven width resizer. Persists the final width on pointer up.
 * Tracks the parent width so the max bound updates if the window is resized.
 */
export function useResizable(opts: UseResizableOptions): {
  width: number
  setWidth: (w: number) => void
  handleProps: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
    role: 'separator'
    'aria-orientation': 'vertical'
  }
} {
  const { storageKey, defaultWidth, min, side } = opts
  const max = opts.max ?? Infinity
  const [width, setWidthState] = useState<number>(() => {
    if (storageKey === null || typeof window === 'undefined') return defaultWidth
    const raw = window.localStorage.getItem(storageKey)
    const n = Number(raw)
    return Number.isFinite(n) && n >= min ? n : defaultWidth
  })

  const setWidth = useCallback(
    (w: number) => {
      setWidthState(w)
      if (storageKey !== null) {
        try {
          window.localStorage.setItem(storageKey, String(Math.round(w)))
        } catch {
          // Storage full / disabled — silent.
        }
      }
    },
    [storageKey],
  )

  const dragRef = useRef<{ startX: number; startWidth: number; parentWidth: number } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const handle = e.currentTarget
      handle.setPointerCapture(e.pointerId)
      // Measure the closest flex parent (marked with `data-resizable-parent`).
      const parent = handle.closest('[data-resizable-parent]') as HTMLElement | null
      const parentWidth = parent?.clientWidth || window.innerWidth
      dragRef.current = { startX: e.clientX, startWidth: width, parentWidth }
      e.preventDefault()
    },
    [width],
  )

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current
      if (!drag) return
      const delta = e.clientX - drag.startX
      const sign = side === 'right' ? 1 : -1
      const next = drag.startWidth + sign * delta
      const effectiveMax = Math.min(max, drag.parentWidth * 0.5)
      setWidth(Math.max(min, Math.min(effectiveMax, next)))
    }
    function onUp() {
      dragRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [max, min, side, setWidth])

  return {
    width,
    setWidth,
    handleProps: {
      onPointerDown,
      role: 'separator' as const,
      'aria-orientation': 'vertical' as const,
    },
  }
}

/** Mark a flex parent so the resizer can measure its width for the max bound. */
export const RESIZABLE_PARENT_ATTR = 'data-resizable-parent'
