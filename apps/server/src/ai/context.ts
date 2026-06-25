import type { ChatMessage, CompletionMode } from '@novel/shared'
import { buildMessages } from '@novel/shared'
import type { Database } from '../db/sqlite.js'
import { readManuscript } from '../manuscripts/io.js'
import { manuscriptPath } from '../projects/paths.js'
import path from 'node:path'

export interface ContextInput {
  db: Database
  sceneId: number
  novelsDir: string
  mode: CompletionMode
  systemPrompt: string
  contextPrevChars: number
  inputText: string
  overrideMessages?: ChatMessage[]
}

// Modes where the AI needs to "find its place" inside the novel structure —
// these get the outline summary (volumes / chapters / scenes / story arc) so
// generated prose aligns with the planned story arc.
const NEEDS_OUTLINE: readonly CompletionMode[] = ['generate_chapter', 'generate_scene', 'suggest_next_chapter']

function buildWorldSummary(db: Database, projectId: number): string {
  // Get project theme
  const project = db.prepare<{ theme: string }>(
    'SELECT theme FROM projects WHERE id = ?'
  ).get(projectId)

  const chars = db.prepare<{ name: string; personality: string; appearance: string }>(
    'SELECT name, personality, appearance FROM characters WHERE project_id = ?'
  ).all(projectId)
  const worlds = db.prepare<{ name: string; category: string; description: string }>(
    'SELECT name, category, description FROM world_elements WHERE project_id = ?'
  ).all(projectId)
  const timeline = db.prepare<{ title: string; era: string; description: string }>(
    'SELECT title, era, description FROM timeline_events WHERE project_id = ? ORDER BY order_index'
  ).all(projectId)
  const foreshadows = db.prepare<{ title: string; description: string; status: string }>(
    'SELECT title, description, status FROM foreshadows WHERE project_id = ? AND status != \'resolved\''
  ).all(projectId)
  const conflicts = db.prepare<{ title: string; type: string; description: string; status: string }>(
    'SELECT title, type, description, status FROM conflicts WHERE project_id = ? AND status != \'resolution\''
  ).all(projectId)

  let summary = ''
  if (project?.theme) {
    summary += `[Theme]\n${project.theme}\n`
  }
  if (chars.length > 0) {
    summary += '[Characters]\n'
    for (const c of chars) {
      summary += `- ${c.name}${c.personality ? ': ' + c.personality : ''}${c.appearance ? ' | ' + c.appearance : ''}\n`
    }
  }
  if (worlds.length > 0) {
    summary += '[World]\n'
    for (const w of worlds) {
      summary += `- ${w.name} [${w.category}]${w.description ? ': ' + w.description : ''}\n`
    }
  }
  if (timeline.length > 0) {
    summary += '[Timeline]\n'
    for (const t of timeline) {
      summary += `- ${t.era ? `[${t.era}] ` : ''}${t.title}${t.description ? ': ' + t.description : ''}\n`
    }
  }
  if (foreshadows.length > 0) {
    summary += '[Active Foreshadowing]\n'
    for (const f of foreshadows) {
      summary += `- ${f.title}${f.description ? ': ' + f.description : ''}\n`
    }
  }
  if (conflicts.length > 0) {
    summary += '[Active Conflicts]\n'
    for (const c of conflicts) {
      summary += `- ${c.title} [${c.type}] (${c.status})${c.description ? ': ' + c.description : ''}\n`
    }
  }
  return summary
}

/**
 * Builds the structural outline summary — the story arc notes plus the
 * full volume → chapter → scene tree of the current volume. Injected into
 * modes that need to write *new* content that fits the planned story, so
 * e.g. `generate_chapter` doesn't drift away from the skeleton the user
 * already created with `generate_novel_skeleton`.
 *
 * Returns an empty string if the scene is not found or the project has no
 * structure yet (callers can fall back to the prior behaviour silently).
 */
function buildOutlineSummary(db: Database, projectId: number, currentSceneId: number): string {
  const project = db.prepare<{ story_arc_notes: string }>(
    'SELECT story_arc_notes FROM projects WHERE id = ?',
  ).get(projectId)

  const loc = db.prepare<{ volume_id: number; chapter_id: number; volume_name: string; volume_slug: string; chapter_title: string; chapter_slug: string }>(
    `SELECT v.id as volume_id, c.id as chapter_id, v.name as volume_name, v.slug as volume_slug,
            c.title as chapter_title, c.slug as chapter_slug
     FROM scenes s JOIN chapters c ON s.chapter_id = c.id JOIN volumes v ON c.volume_id = v.id
     WHERE s.id = ?`,
  ).get(currentSceneId)
  if (!loc) return ''

  const chapters = db.prepare<{ id: number; title: string; slug: string; order_index: number }>(
    'SELECT id, title, slug, order_index FROM chapters WHERE volume_id = ? ORDER BY order_index',
  ).all(loc.volume_id)

  let out = ''
  if (project?.story_arc_notes) {
    out += `[Story Arc Notes]\n${project.story_arc_notes}\n`
  }
  out += `[Current Volume] ${loc.volume_name} (${loc.volume_slug})\n`
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]!
    const isCurrent = ch.id === loc.chapter_id
    const mark = isCurrent ? ' ← 当前章节' : ''
    out += `## 第${i + 1}章 ${ch.title}${mark}\n`
    const scenes = db.prepare<{ title: string; notes: string | null; content_hash: string }>(
      'SELECT title, notes, content_hash FROM scenes WHERE chapter_id = ? ORDER BY order_index',
    ).all(ch.id)
    if (scenes.length === 0) {
      out += `  (暂无场景)\n`
    }
    for (const s of scenes) {
      // content_hash is 64 chars only when a manuscript has been written; treat
      // an empty hash (the DB default) as "not yet written".
      const status = s.content_hash && s.content_hash.length === 64 ? '✓已写' : '○待写'
      out += `  - [${status}] ${s.title}${s.notes ? `: ${s.notes}` : ''}\n`
    }
  }
  return out
}

export async function buildContext(input: ContextInput): Promise<{ messages: ChatMessage[]; modelMaxTokens: number }> {
  if (input.overrideMessages && input.overrideMessages.length > 0) {
    const sys = input.systemPrompt.trim()
    const msgs: ChatMessage[] = sys ? [{ role: 'system', content: sys }, ...input.overrideMessages] : input.overrideMessages
    return { messages: msgs, modelMaxTokens: 0 }
  }
  const row = input.db
    .prepare<{ scene_slug: string; chap_slug: string; vol_slug: string; project_slug: string; project_id: number; notes: string | null; chap_title: string }>(
      `SELECT s.slug as scene_slug, c.slug as chap_slug, c.title as chap_title, v.slug as vol_slug, p.slug as project_slug, p.id as project_id, s.notes
       FROM scenes s JOIN chapters c ON s.chapter_id = c.id
       JOIN volumes v ON c.volume_id = v.id
       JOIN projects p ON v.project_id = p.id WHERE s.id = ?`,
    )
    .get(input.sceneId)
  if (!row) throw new Error('scene not found')
  const prev = input.db
    .prepare<{ slug: string; chap_slug: string; vol_slug: string }>(
      `SELECT s.slug, c.slug as chap_slug, v.slug as vol_slug FROM scenes s
       JOIN chapters c ON s.chapter_id = c.id
       JOIN volumes v ON c.volume_id = v.id
       WHERE s.id < ? AND s.chapter_id = (SELECT chapter_id FROM scenes WHERE id = ?)
       ORDER BY s.id DESC LIMIT 1`,
    )
    .get(input.sceneId, input.sceneId)
  let prevTail = ''
  if (prev) {
    const file = manuscriptPath(path.join(input.novelsDir, row.project_slug), prev.vol_slug, prev.chap_slug, prev.slug)
    const r = await readManuscript(file)
    prevTail = r.text.slice(-input.contextPrevChars)
  }

  // Build world summary for AI context
  const worldSummary = buildWorldSummary(input.db, row.project_id)
  // Inject the structural outline only for modes that write new content
  // aligned with the planned story; other modes (continue/polish/etc.) get
  // the previous-scene-tail and the world summary, same as before.
  const outlineSummary = NEEDS_OUTLINE.includes(input.mode)
    ? buildOutlineSummary(input.db, row.project_id, input.sceneId)
    : ''

  let ctxText = `Volume: ${row.vol_slug}\nChapter: ${row.chap_title}\nScene notes: ${row.notes ?? ''}\n\n[Previous scene tail]\n${prevTail}`
  if (outlineSummary) {
    ctxText += `\n\n[Outline]\n${outlineSummary}`
  }
  if (worldSummary) {
    ctxText += `\n\n${worldSummary}`
  }

  const messages = buildMessages(input.mode, input.systemPrompt, ctxText, input.inputText)
  return { messages, modelMaxTokens: 0 }
}
