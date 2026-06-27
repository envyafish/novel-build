/**
 * Shared AI output JSON parser. AI streams are not guaranteed to be clean
 * JSON: they may include markdown code fences, prose around the payload,
 * or trailing commentary. This helper:
 *
 * 1. Strips ``` fences (and `~~~` variants).
 * 2. Tries to parse the entire cleaned string.
 * 3. Falls back to extracting the first balanced top-level `{...}` block.
 * 4. Honors string boundaries (escaped quotes, etc.) while scanning.
 *
 * Two flavors:
 *   - `parseAiJson<T>` — tolerant, returns null on failure
 *   - `extractJson<T>`  — strict, throws on failure (for cases where the caller
 *     wants to surface the parse error to the user)
 *
 * Also exports `stripThinking` for defense-in-depth against reasoning models
 * that leak `<think>...</think>`-style blocks into the streamed content.
 *
 * Used by both web (`apps/web`) and server (`apps/server`) — kept here so the
 * two sides cannot drift in how they interpret AI output.
 */

export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/【思考】[\s\S]*?【\/思考】/g, '')
}

export function parseAiJson<T = unknown>(text: string): T | null {
  if (!text) return null
  // 1. Strip common code fences
  let s = text
    .replace(/```(?:json)?\s*\n?/gi, '')
    .replace(/```/g, '')
    .replace(/~~~(?:json)?\s*\n?/gi, '')
    .replace(/~~~/g, '')
  // 2. Try direct parse
  try {
    return JSON.parse(s.trim()) as T
  } catch {
    // fall through
  }
  // 3. Walk the string, picking out balanced `{...}` blocks (honoring
  // string boundaries). The text may contain stray braces before the real
  // JSON object (e.g. `"note: {comment}"` or even an unbalanced `{`); if
  // the first balanced slice we extract doesn't parse, we keep scanning
  // past it and try the next one instead of giving up.
  let searchFrom = 0
  while (searchFrom < s.length) {
    const start = s.indexOf('{', searchFrom)
    if (start < 0) return null
    let depth = 0
    let inStr = false
    let escape = false
    let end = -1
    for (let i = start; i < s.length; i++) {
      const ch = s[i]
      if (inStr) {
        if (escape) {
          escape = false
        } else if (ch === '\\') {
          escape = true
        } else if (ch === '"') {
          inStr = false
        }
        continue
      }
      if (ch === '"') {
        inStr = true
      } else if (ch === '{') {
        depth++
      } else if (ch === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end < 0) return null
    const candidate = s.slice(start, end + 1)
    try {
      return JSON.parse(candidate) as T
    } catch {
      // Skip past this candidate and try the next `{...}` block.
      searchFrom = end + 1
    }
  }
  return null
}

/**
 * Strict variant of parseAiJson. Strips thinking blocks, then attempts to
 * extract JSON. Throws on failure with a descriptive message. Use this when
 * the caller wants to surface parse errors to the user (e.g. toast
 * notifications, error UI states).
 */
export function extractJson<T = unknown>(text: string): T {
  const cleaned = stripThinking(text)
  const result = parseAiJson<T>(cleaned)
  if (result === null) {
    throw new Error('无法解析 AI 输出的 JSON')
  }
  return result
}