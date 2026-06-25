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
 * Returns null if no JSON object can be found.
 */
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
  // 3. Find the first balanced {...} block
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let escape = false
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
        const candidate = s.slice(start, i + 1)
        try {
          return JSON.parse(candidate) as T
        } catch {
          return null
        }
      }
    }
  }
  return null
}