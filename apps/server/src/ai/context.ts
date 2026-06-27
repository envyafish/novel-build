import type { ChatMessage, CompletionMode } from '@novel/shared'
import { buildMessages, MODE_PROMPTS } from '@novel/shared'
import type { Database } from '../db/sqlite.js'
import { readManuscript } from '../manuscripts/io.js'
import { manuscriptPath } from '../projects/paths.js'
import path from 'node:path'

export interface ContextInput {
  db: Database
  /** Required for scene-specific context (previous scene tail, scene notes, outline tree).
   *  Optional for project-level operations like chapter review/extract. */
  sceneId?: number
  /** When set (and `sceneId` is absent), reads the tail of the chapter's
   *  last-written scene so AI can continue from there. Used by chapter-level
   *  generation flows like `generate_chapter` that don't pin to a single scene. */
  chapterId?: number
  /** Required for ai_settings lookup. If omitted, falls back to scene JOIN when sceneId is provided. */
  projectId?: number
  novelsDir: string
  mode: CompletionMode
  systemPrompt: string
  contextPrevChars: number
  inputText: string
  overrideMessages?: ChatMessage[]
  /** When set and the current chapter has no written tail, also pull the
   *  tail of the *previous* chapter in the same volume. Useful for serialized
   *  novels where chapters need narrative continuity; leave off for
   *  episodic / anthology writing where each chapter stands alone. */
  includePrevChapterTail?: boolean
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
 * Reads the tail of the chapter's last-written scene so AI can continue from
 * there. Returns an empty string if the chapter has no scenes with a written
 * manuscript (e.g. the chapter is brand-new) or if the file is unreadable —
 * callers should treat empty tail as "no prior context".
 *
 * `length(s.content_hash) = 64` filters out scenes that are still DB-only
 * (their manuscript file may not exist yet — see saveScene flow).
 */
async function readChapterTail(
  db: Database,
  projectSlug: string,
  chapterId: number,
  novelsDir: string,
  tailChars: number,
): Promise<string> {
  return readChapterTailFrom(db, projectSlug, chapterId, novelsDir, tailChars)
}

/**
 * Reads the tail of the previous chapter (same volume, chapter with the
 * largest order_index < current). Returns '' if there is no prior chapter
 * or it has no written tail.
 */
async function readPrevChapterTail(
  db: Database,
  projectSlug: string,
  chapterId: number,
  novelsDir: string,
  tailChars: number,
): Promise<string> {
  const prev = db
    .prepare<{ id: number }>(
      `SELECT c2.id FROM chapters c1
       JOIN chapters c2 ON c2.volume_id = c1.volume_id AND c2.order_index < c1.order_index
       WHERE c1.id = ?
       ORDER BY c2.order_index DESC LIMIT 1`,
    )
    .get(chapterId)
  if (!prev) return ''
  return readChapterTailFrom(db, projectSlug, prev.id, novelsDir, tailChars)
}

async function readChapterTailFrom(
  db: Database,
  projectSlug: string,
  chapterId: number,
  novelsDir: string,
  tailChars: number,
): Promise<string> {
  const last = db
    .prepare<{ slug: string; chap_slug: string; vol_slug: string }>(
      `SELECT s.slug, c.slug as chap_slug, v.slug as vol_slug
       FROM scenes s JOIN chapters c ON s.chapter_id = c.id
       JOIN volumes v ON c.volume_id = v.id
       WHERE s.chapter_id = ?
         AND length(s.content_hash) = 64
       ORDER BY s.order_index DESC LIMIT 1`,
    )
    .get(chapterId)
  if (!last) return ''
  const file = manuscriptPath(path.join(novelsDir, projectSlug), last.vol_slug, last.chap_slug, last.slug)
  try {
    const r = await readManuscript(file)
    return r.text.slice(-tailChars)
  } catch {
    return ''
  }
}

/**
 * Builds the structural outline summary — the story arc notes plus the
 * full volume → chapter → scene tree of the current volume. Injected into
 * modes that need to write *new* content that fits the planned story, so
 * e.g. `generate_chapter` doesn't drift away from the planned story arc.
 *
 * Two anchor modes:
 *   - sceneId: build the tree around the volume containing that scene,
 *     marking the scene's chapter as "current". Used by per-scene flows
 *     (`continue`, `polish`, `rewrite`, …).
 *   - chapterId: build the same tree but mark the given chapter as
 *     "current" regardless of which scene it belongs to. Used by chapter
 *     flows like `generate_chapter` invoked *before* any scene exists in
 *     the target chapter.
 *
 * Returns an empty string if the anchor can't be resolved.
 */
function buildOutlineSummary(
  db: Database,
  projectId: number,
  anchor: { sceneId: number } | { chapterId: number },
): string {
  const project = db.prepare<{ story_arc_notes: string }>(
    'SELECT story_arc_notes FROM projects WHERE id = ?',
  ).get(projectId)

  // Resolve {volumeId, chapterId, volumeName, volumeSlug, chapterTitle}
  // depending on which anchor we got.
  const loc = 'sceneId' in anchor
    ? db.prepare<{ volume_id: number; chapter_id: number; volume_name: string; volume_slug: string; chapter_title: string; chapter_slug: string }>(
        `SELECT v.id as volume_id, c.id as chapter_id, v.name as volume_name, v.slug as volume_slug,
                c.title as chapter_title, c.slug as chapter_slug
         FROM scenes s JOIN chapters c ON s.chapter_id = c.id JOIN volumes v ON c.volume_id = v.id
         WHERE s.id = ?`,
      ).get(anchor.sceneId)
    : db.prepare<{ volume_id: number; chapter_id: number; volume_name: string; volume_slug: string; chapter_title: string; chapter_slug: string }>(
        `SELECT v.id as volume_id, c.id as chapter_id, v.name as volume_name, v.slug as volume_slug,
                c.title as chapter_title, c.slug as chapter_slug
         FROM chapters c JOIN volumes v ON c.volume_id = v.id
         WHERE c.id = ?`,
      ).get(anchor.chapterId)
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
    // Guard against unbounded payloads — cap total content at 200k chars.
    const totalLen = input.overrideMessages.reduce((n, m) => n + m.content.length, 0)
    if (totalLen > 200_000) {
      throw new Error(`overrideMessages too large (${totalLen} chars, max 200000)`)
    }
    const sys = input.systemPrompt.trim()
    const msgs: ChatMessage[] = sys ? [{ role: 'system', content: sys }, ...input.overrideMessages] : input.overrideMessages
    // Use a sensible default instead of 0 — 0 means "no limit" which lets the
    // provider generate indefinitely, burning tokens with no output cap.
    return { messages: msgs, modelMaxTokens: 8192 }
  }

  // Resolve scene row + projectId. Scene is optional (project-level operations
  // like chapter review/extract only need the project for ai_settings + world
  // summary). When sceneId is absent, skip scene-specific context (previous
  // tail, scene notes, outline tree).
  const row = input.sceneId !== undefined
    ? input.db
        .prepare<{ scene_slug: string; chap_slug: string; vol_slug: string; project_slug: string; project_id: number; notes: string | null; chap_title: string }>(
          `SELECT s.slug as scene_slug, c.slug as chap_slug, c.title as chap_title, v.slug as vol_slug, p.slug as project_slug, p.id as project_id, s.notes
           FROM scenes s JOIN chapters c ON s.chapter_id = c.id
           JOIN volumes v ON c.volume_id = v.id
           JOIN projects p ON v.project_id = p.id WHERE s.id = ?`,
        )
        .get(input.sceneId)
    : undefined
  if (input.sceneId !== undefined && !row) throw new Error('scene not found')

  const projectId = input.projectId ?? row?.project_id
  if (!projectId) throw new Error('project not resolved')

  let prevTail = ''
  let ctxText = ''
  if (row && input.sceneId !== undefined) {
    const prev = input.db
      .prepare<{ slug: string; chap_slug: string; vol_slug: string }>(
        `SELECT s.slug, c.slug as chap_slug, v.slug as vol_slug FROM scenes s
         JOIN chapters c ON s.chapter_id = c.id
         JOIN volumes v ON c.volume_id = v.id
         WHERE s.id < ? AND s.chapter_id = (SELECT chapter_id FROM scenes WHERE id = ?)
         ORDER BY s.id DESC LIMIT 1`,
      )
      .get(input.sceneId, input.sceneId)
    if (prev) {
      const file = manuscriptPath(path.join(input.novelsDir, row.project_slug), prev.vol_slug, prev.chap_slug, prev.slug)
      const r = await readManuscript(file)
      prevTail = r.text.slice(-input.contextPrevChars)
    }
    ctxText = `Volume: ${row.vol_slug}\nChapter: ${row.chap_title}\nScene notes: ${row.notes ?? ''}\n\n[Previous scene tail]\n${prevTail}`
  }

  // Chapter-level context: when only chapterId is provided (no sceneId),
  // pull the tail of the chapter's last-written scene plus the existing
  // scene titles in this chapter so the AI can continue from there without
  // duplicating earlier content or scene names.
  if (!row && input.chapterId !== undefined) {
    const proj = input.db
      .prepare<{ project_slug: string }>(
        `SELECT p.slug as project_slug
         FROM chapters c JOIN volumes v ON c.volume_id = v.id
         JOIN projects p ON v.project_id = p.id WHERE c.id = ?`,
      )
      .get(input.chapterId)
    if (proj) {
      const chapterTail = await readChapterTail(
        input.db, proj.project_slug, input.chapterId,
        input.novelsDir, input.contextPrevChars,
      )
      const sceneTitles = input.db
        .prepare<{ title: string }>(
          'SELECT title FROM scenes WHERE chapter_id = ? ORDER BY order_index',
        )
        .all(input.chapterId)
      const titlesLine = sceneTitles.length > 0
        ? sceneTitles.map((s) => `- ${s.title}`).join('\n')
        : '(本章节暂无场景)'
      // If the chapter has no written tail (e.g. brand-new chapter) and the
      // caller opted into `includePrevChapterTail`, fall back to the tail
      // of the previous chapter in the same volume so serialized novels
      // can keep narrative continuity. Stays off by default for episodic
      // / anthology writing where each chapter stands alone.
      let tailSection: string
      if (chapterTail) {
        tailSection = `\n\n[Previous chapter tail]\n${chapterTail}`
      } else if (input.includePrevChapterTail) {
        const prevTail = await readPrevChapterTail(
          input.db, proj.project_slug, input.chapterId,
          input.novelsDir, input.contextPrevChars,
        )
        tailSection = prevTail
          ? `\n\n[Previous chapter tail]\n(本章节尚未开始,以下是上一章末尾供参考:)\n${prevTail}`
          : `\n\n[Previous chapter tail]\n(本章节还没有已写内容,上一章也没有 — 请直接开始)`
      } else {
        tailSection = `\n\n[Previous chapter tail]\n(本章节还没有已写内容 — 这是开篇场景,请直接开始)`
      }
      ctxText = `[Current chapter]\nPrevious scenes in this chapter:\n${titlesLine}${tailSection}`
    }
  }

  // Build world summary for AI context
  const worldSummary = buildWorldSummary(input.db, projectId)
  // Inject the structural outline only for modes that write new content
  // aligned with the planned story. Outline is built from whichever anchor
  // is available — sceneId (the existing scene-level path) or chapterId
  // (so chapter-level flows like `generate_chapter` invoked *before* any
  // scene exists in the chapter still get the story arc + outline tree).
  const outlineAnchor: { sceneId: number } | { chapterId: number } | undefined =
    input.sceneId !== undefined
      ? { sceneId: input.sceneId }
      : input.chapterId !== undefined
        ? { chapterId: input.chapterId }
        : undefined
  const outlineSummary =
    outlineAnchor && NEEDS_OUTLINE.includes(input.mode)
      ? buildOutlineSummary(input.db, projectId, outlineAnchor)
      : ''

  if (outlineSummary) {
    ctxText += `\n\n[Outline]\n${outlineSummary}`
  }
  if (worldSummary) {
    ctxText += `\n\n${worldSummary}`
  }

  const messages = buildMessages(input.mode, input.systemPrompt, ctxText, input.inputText)
  // Each mode's expected output length is declared in MODE_PROMPTS. It can be
  // a fixed number or a function derived from `inputText` (e.g.
  // `generate_chapter` scales the limit with the requested scene count).
  // Passing it back to the caller (and ultimately to the client) lets the UI
  // show a real progress bar instead of always 0%.
  const rawMaxTokens = MODE_PROMPTS[input.mode]?.maxOutputTokens ?? 0
  const modeMaxTokens = typeof rawMaxTokens === 'function' ? rawMaxTokens(input.inputText) : rawMaxTokens
  return { messages, modelMaxTokens: modeMaxTokens }
}
