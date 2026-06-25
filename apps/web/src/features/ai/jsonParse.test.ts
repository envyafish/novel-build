import { describe, it, expect } from 'vitest'
import { parseAiJson } from './jsonParse.js'

describe('parseAiJson', () => {
  it('parses clean JSON', () => {
    expect(parseAiJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('parses JSON inside markdown code fences', () => {
    expect(parseAiJson('```json\n{"a":2}\n```')).toEqual({ a: 2 })
    expect(parseAiJson('```\n{"a":3}\n```')).toEqual({ a: 3 })
  })

  it('parses JSON embedded in prose around it', () => {
    const text = 'Here you go:\n\n{"name":"李逍遥","power":99}\n\nHope it helps!'
    expect(parseAiJson(text)).toEqual({ name: '李逍遥', power: 99 })
  })

  it('extracts first balanced object from multi-object text', () => {
    const text = 'First: {"a":1}\nThen: {"b":2}'
    expect(parseAiJson(text)).toEqual({ a: 1 })
  })

  it('handles strings containing braces', () => {
    const text = '{"text":"hello {world}","n":1}'
    expect(parseAiJson(text)).toEqual({ text: 'hello {world}', n: 1 })
  })

  it('handles escaped quotes inside strings', () => {
    const text = '{"text":"he said \\"hi\\"","n":2}'
    expect(parseAiJson(text)).toEqual({ text: 'he said "hi"', n: 2 })
  })

  it('returns null when no JSON is present', () => {
    expect(parseAiJson('hello world')).toBeNull()
    expect(parseAiJson('')).toBeNull()
    expect(parseAiJson('not a json at all')).toBeNull()
  })

  it('returns null on truly broken JSON', () => {
    expect(parseAiJson('{a:')).toBeNull()
  })

  it('handles ~~~ fences', () => {
    expect(parseAiJson('~~~json\n{"x":1}\n~~~')).toEqual({ x: 1 })
  })

  it('handles nested objects', () => {
    expect(parseAiJson('{"outer":{"inner":{"x":1}}}')).toEqual({ outer: { inner: { x: 1 } } })
  })
})