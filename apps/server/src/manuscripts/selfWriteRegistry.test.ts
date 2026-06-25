import { describe, it, expect, beforeEach } from 'vitest'
import { recordSelfWrite, consumeSelfWrite, _clearSelfWrites } from './selfWriteRegistry.js'

describe('selfWriteRegistry', () => {
  beforeEach(() => _clearSelfWrites())

  it('returns true within TTL when disk hash matches the recorded write', () => {
    const filePath = '/tmp/scene.md'
    recordSelfWrite(filePath, 'hash-A', 1_000)
    expect(consumeSelfWrite(filePath, 'hash-A', 1_000)).toBe(true)
    expect(consumeSelfWrite(filePath, 'hash-A', 5_999)).toBe(true)
  })

  it('returns false within TTL when disk hash differs (file was changed externally)', () => {
    const filePath = '/tmp/scene.md'
    recordSelfWrite(filePath, 'hash-A', 1_000)
    expect(consumeSelfWrite(filePath, 'hash-OTHER', 2_000)).toBe(false)
  })

  it('returns false once the entry has aged past the TTL window', () => {
    const filePath = '/tmp/scene.md'
    recordSelfWrite(filePath, 'hash-A', 1_000)
    expect(consumeSelfWrite(filePath, 'hash-A', 6_001)).toBe(false)
  })

  it('returns false for a path that was never recorded', () => {
    expect(consumeSelfWrite('/tmp/never-touched.md', 'hash-X', Date.now())).toBe(false)
  })

  it('a stale entry is dropped on first read so subsequent real external writes are detected', () => {
    const filePath = '/tmp/scene.md'
    recordSelfWrite(filePath, 'hash-A', 1_000)
    // First read after TTL: returns false AND removes the entry.
    expect(consumeSelfWrite(filePath, 'hash-A', 7_000)).toBe(false)
    // Next read — even within a fresh window — sees nothing.
    expect(consumeSelfWrite(filePath, 'hash-A', 7_500)).toBe(false)
  })

  it('overwrites the recorded hash when the same path is written again', () => {
    const filePath = '/tmp/scene.md'
    recordSelfWrite(filePath, 'hash-A', 1_000)
    recordSelfWrite(filePath, 'hash-B', 2_000)
    // The new hash is the one matched now.
    expect(consumeSelfWrite(filePath, 'hash-B', 2_500)).toBe(true)
    expect(consumeSelfWrite(filePath, 'hash-A', 2_500)).toBe(false)
  })
})