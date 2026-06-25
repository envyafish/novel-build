import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedSave } from './useDebouncedSave.js'

describe('useDebouncedSave', () => {
  it('saves after the delay and skips the first call', async () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const { rerender } = renderHook(({ v }) => useDebouncedSave(v, save, 100), { initialProps: { v: 'a' } })
    rerender({ v: 'b' })
    rerender({ v: 'c' })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(save).toHaveBeenCalledWith('c')
    vi.useRealTimers()
  })
})
