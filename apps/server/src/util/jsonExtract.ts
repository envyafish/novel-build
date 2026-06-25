// Server-side port of the web's jsonExtract utility. The web app strips thinking
// blocks and tries to parse before POSTing, but the server applies the same
// logic as defense-in-depth so an unfiltered client (curl, future API, bug)
// can't sneak prose into the database.

export function extractJson(text: string): unknown {
  const tryParse = (s: string): unknown | null => {
    try { return JSON.parse(s) } catch { return null }
  }

  const trimmed = text.trim()
  if (!trimmed) throw new Error('empty input')

  const direct = tryParse(trimmed)
  if (direct !== null) return direct

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fence) {
    const inner = tryParse(fence[1]!.trim())
    if (inner !== null) return inner
  }

  let depth = 0
  let start = -1
  let inString = false
  let escape = false
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (inString) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      if (depth === 0) continue
      depth--
      if (depth === 0 && start >= 0) {
        const candidate = tryParse(trimmed.slice(start, i + 1))
        if (candidate !== null) return candidate
        start = -1
      }
    }
  }

  throw new Error('无法解析 AI 输出的 JSON')
}

export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/【思考】[\s\S]*?【\/思考】/g, '')
}