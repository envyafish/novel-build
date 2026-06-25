/**
 * Scene splitter — parses AI-generated chapter text into multiple scenes.
 *
 * Primary mode: split on `### <title>` markers
 * Fallback mode: if no markers found, treat the whole text as a single scene
 *                 (the editor accepts whatever structure AI produces)
 */

export interface ParsedScene {
  title: string
  markdown: string
}

const SCENE_MARKER = /^###\s+(.+?)$/m

export function splitChapterToScenes(text: string): ParsedScene[] {
  const cleaned = text.trim()
  if (!cleaned) return []

  // Find all "### Title" positions
  const matches: { index: number; title: string }[] = []
  const re = /^###\s+(.+?)\s*$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) !== null) {
    matches.push({ index: m.index, title: m[1]?.trim() ?? '' })
  }

  if (matches.length === 0) {
    // Fallback: treat as single scene, strip any leading #/##/### line as title
    return [extractTitleFromFallback(cleaned)]
  }

  if (matches.length === 1) {
    const first = matches[0]!
    const headerEnd = cleaned.indexOf('\n', first.index)
    const content = cleaned.slice(headerEnd + 1).trim()
    return [{ title: first.title, markdown: content }]
  }

  // Multiple markers — split text between them
  const scenes: ParsedScene[] = []
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]!
    const next = matches[i + 1]
    const headerEnd = cleaned.indexOf('\n', cur.index)
    const end = next ? next.index : cleaned.length
    const block = cleaned.slice(headerEnd + 1, end).trim()
    scenes.push({ title: cur.title, markdown: block })
  }
  return scenes
}

function extractTitleFromFallback(text: string): ParsedScene {
  // Try to extract a title from a leading # or ## or ### line
  const lines = text.split('\n')
  const titleRe = /^#{1,3}\s+(.+?)\s*$/
  for (let i = 0; i < Math.min(3, lines.length); i++) {
    const match = lines[i]?.match(titleRe)
    if (match) {
      const rest = lines.slice(i + 1).join('\n').replace(/^\s+/, '').trim()
      return { title: (match[1] ?? '').trim(), markdown: rest }
    }
  }
  // No title found — generate default
  return { title: '场景 1', markdown: text }
}

/**
 * Sanitize a scene title to be used as a slug.
 * Backend regex requires `^[a-z0-9][a-z0-9-]{0,63}$` (ASCII only).
 * Appends a short random suffix to avoid UNIQUE constraint collisions.
 */
export function titleToSlug(title: string, index: number): string {
  const rand = Math.random().toString(36).slice(2, 8)
  const hasAscii = /[a-z0-9]/i.test(title)
  if (!hasAscii) {
    return `scene-${index + 1}-${rand}`
  }
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  if (!slug) return `scene-${index + 1}-${rand}`
  const base = /^[a-z0-9]/.test(slug) ? slug : `scene-${index + 1}`
  return `${base}-${rand}`
}
