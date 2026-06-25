import { describe, it, expect } from 'vitest'
import { diffLines } from './diff.js'

describe('diffLines', () => {
  it('marks additions and deletions', () => {
    const d = diffLines('the quick brown fox', 'the slow brown fox')
    expect(d.some((x) => x.kind === 'del' && x.text.includes('quick'))).toBe(true)
    expect(d.some((x) => x.kind === 'add' && x.text.includes('slow'))).toBe(true)
  })
})
