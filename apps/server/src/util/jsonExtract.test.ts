import { describe, it, expect } from 'vitest'
import { extractJson, stripThinking } from '@novel/shared'

describe('extractJson (server)', () => {
  it('parses pure JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('parses JSON inside a markdown code fence', () => {
    const text = '好的,以下是 JSON:\n```json\n{"title":"x","count":3}\n```\n请查收'
    expect(extractJson(text)).toEqual({ title: 'x', count: 3 })
  })

  it('finds the first balanced JSON object when preamble has stray braces', () => {
    const text = '好的,这是设定:{注释}...更多解释...\n{"title":"ok","nested":{"a":1}}\n结束'
    expect(extractJson(text)).toEqual({ title: 'ok', nested: { a: 1 } })
  })

  it('handles JSON with embedded strings containing braces', () => {
    const text = '{"key":"value with } brace","other":2}'
    expect(extractJson(text)).toEqual({ key: 'value with } brace', other: 2 })
  })

  it('handles nested arrays and objects', () => {
    const text = 'preamble {"arr":[{"x":1},{"x":2}],"obj":{"k":"v"}} trailer'
    expect(extractJson(text)).toEqual({ arr: [{ x: 1 }, { x: 2 }], obj: { k: 'v' } })
  })

  it('throws when input has no JSON', () => {
    expect(() => extractJson('hello world')).toThrow(/无法解析/)
  })

  it('throws on empty input', () => {
    expect(() => extractJson('')).toThrow()
  })
})

describe('stripThinking', () => {
  it('strips <think> blocks', () => {
    expect(stripThinking('a<think>secret</think>b')).toBe('ab')
  })

  it('strips <thinking> blocks', () => {
    expect(stripThinking('a<thinking>x</thinking>b')).toBe('ab')
  })

  it('strips <reasoning> blocks', () => {
    expect(stripThinking('a<reasoning>r</reasoning>b')).toBe('ab')
  })

  it('strips 【思考】 blocks', () => {
    expect(stripThinking('a【思考】思【/思考】b')).toBe('ab')
  })

  it('passes through plain text unchanged', () => {
    expect(stripThinking('no thinking here')).toBe('no thinking here')
  })
})