import { describe, it, expect } from 'vitest'
import { mdastToMd, mdToMdast, wordCount } from './markdown.js'

describe('markdown utilities', () => {
  it('round-trips simple markdown', () => {
    const md = 'Hello **world**.\n\n- one\n- two\n'
    const tree = mdToMdast(md)
    const out = mdastToMd(tree)
    expect(out.replace(/\n+/g, '\n').trim()).toContain('Hello **world**')
  })
  it('counts words without whitespace', () => {
    expect(wordCount('a b  c\n\nd')).toBe(4)
  })
})
