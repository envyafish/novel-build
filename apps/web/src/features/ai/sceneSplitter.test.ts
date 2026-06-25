import { describe, it, expect } from 'vitest'
import { splitChapterToScenes, titleToSlug } from './sceneSplitter.js'

describe('splitChapterToScenes', () => {
  it('returns empty array for empty input', () => {
    expect(splitChapterToScenes('')).toEqual([])
    expect(splitChapterToScenes('   \n\n  ')).toEqual([])
  })

  it('returns single scene when no markers present', () => {
    const text = '这是第一段内容。\n\n这是第二段内容。'
    const result = splitChapterToScenes(text)
    expect(result).toHaveLength(1)
    expect(result.at(0)?.title).toBe('场景 1')
    expect(result.at(0)?.markdown).toBe(text)
  })

  it('extracts title from leading # heading in fallback', () => {
    const text = '# 客栈初见\n\n第一段内容。\n\n第二段。'
    const result = splitChapterToScenes(text)
    expect(result).toHaveLength(1)
    expect(result.at(0)?.title).toBe('客栈初见')
    expect(result.at(0)?.markdown).toContain('第一段内容')
  })

  it('splits text on ### markers', () => {
    const text = `### 客栈初见

狂风卷着黄沙。

### 暗流涌动

掌柜的嘴角上扬。

### 决战

最终对决开始。`
    const result = splitChapterToScenes(text)
    expect(result).toHaveLength(3)
    expect(result.at(0)?.title).toBe('客栈初见')
    expect(result.at(0)?.markdown).toContain('狂风卷着黄沙')
    expect(result.at(1)?.title).toBe('暗流涌动')
    expect(result.at(1)?.markdown).toContain('掌柜的嘴角上扬')
    expect(result.at(2)?.title).toBe('决战')
    expect(result.at(2)?.markdown).toContain('最终对决开始')
  })

  it('handles single ### marker', () => {
    const text = '### 唯一场景\n\n内容在这里。'
    const result = splitChapterToScenes(text)
    expect(result).toHaveLength(1)
    expect(result.at(0)?.title).toBe('唯一场景')
    expect(result.at(0)?.markdown).toBe('内容在这里。')
  })

  it('preserves blank lines within scene body', () => {
    const text = `### 场景一

第一段。

第二段。

### 场景二

第三段。`
    const result = splitChapterToScenes(text)
    expect(result).toHaveLength(2)
    expect(result.at(0)?.markdown).toContain('第一段。')
    expect(result.at(0)?.markdown).toContain('第二段。')
    expect(result.at(1)?.markdown).toContain('第三段。')
  })
})

describe('titleToSlug', () => {
  it('uses scene-N-rand for Chinese-only titles', () => {
    const s1 = titleToSlug('客栈初见', 0)
    expect(s1).toMatch(/^scene-1-[a-z0-9]+$/)
    const s2 = titleToSlug('暗流涌动', 2)
    expect(s2).toMatch(/^scene-3-[a-z0-9]+$/)
  })

  it('converts ASCII titles to hyphenated slug with suffix', () => {
    const s = titleToSlug('The Dark Inn', 0)
    expect(s).toMatch(/^the-dark-inn-[a-z0-9]+$/)
  })

  it('strips special characters from ASCII titles', () => {
    const s = titleToSlug('Hello, World! (1)', 0)
    expect(s).toMatch(/^hello-world-1-[a-z0-9]+$/)
  })

  it('falls back to scene-N-rand for empty/special-only titles', () => {
    const s1 = titleToSlug('!!!', 0)
    expect(s1).toMatch(/^scene-1-[a-z0-9]+$/)
    const s2 = titleToSlug('', 2)
    expect(s2).toMatch(/^scene-3-[a-z0-9]+$/)
  })

  it('truncates long ASCII titles', () => {
    const long = 'a'.repeat(100)
    expect(titleToSlug(long, 0).length).toBeLessThanOrEqual(60)
  })

  it('handles mixed CJK+ASCII titles as ASCII slug', () => {
    const s = titleToSlug('Chapter 5 客栈', 0)
    expect(s).toMatch(/^chapter-5-[a-z0-9]+$/)
  })

  it('produces unique slugs for same title at different indices', () => {
    const s1 = titleToSlug('测试', 0)
    const s2 = titleToSlug('测试', 0)
    // Both should have random suffixes, making them unique
    expect(s1).not.toBe(s2)
  })
})
