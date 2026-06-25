import type { Database } from '../db/sqlite.js'
import type { ChapterRow, ProjectRow, SceneRow, VolumeRow } from '../db/types.js'
import { SLUG_RE } from './paths.js'

export class ProjectRepo {
  constructor(private db: Database) {}

  listProjects(): ProjectRow[] {
    return this.db.prepare<ProjectRow>('SELECT * FROM projects ORDER BY updated_at DESC').all()
  }

  listProjectsDto() {
    return this.listProjects().map((r) => this.toDto(r))
  }

  toDto(r: ProjectRow) {
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      theme: r.theme,
      storyArcNotes: r.story_arc_notes ?? '',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      currentVolumeId: r.current_volume_id,
    }
  }

  getProject(id: number): ProjectRow | undefined {
    return this.db.prepare<ProjectRow>('SELECT * FROM projects WHERE id = ?').get(id)
  }

  getProjectDto(id: number) {
    const r = this.getProject(id)
    return r ? this.toDto(r) : undefined
  }

  getProjectBySlug(slug: string): ProjectRow | undefined {
    return this.db.prepare<ProjectRow>('SELECT * FROM projects WHERE slug = ?').get(slug)
  }

  createProject(name: string, slug: string): ProjectRow {
    if (!SLUG_RE.test(slug)) throw new Error('invalid slug')
    if (!name.trim()) throw new Error('name required')
    const now = new Date().toISOString()
    const tx = this.db.transaction(() => {
      const info = this.db
        .prepare<{ lastInsertRowid: number; changes: number }>('INSERT INTO projects (slug, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(slug, name.trim(), now, now)
      const projectId = info.lastInsertRowid
      const vInfo = this.db
        .prepare<{ lastInsertRowid: number; changes: number }>('INSERT INTO volumes (project_id, slug, name, order_index) VALUES (?, ?, ?, ?)')
        .run(projectId, 'vol-1', '第一卷', 0)
      this.db
        .prepare<{ lastInsertRowid: number; changes: number }>('UPDATE projects SET current_volume_id = ? WHERE id = ?')
        .run(vInfo.lastInsertRowid, projectId)
      this.db
        .prepare<{ lastInsertRowid: number; changes: number }>('INSERT INTO chapters (volume_id, slug, title, order_index) VALUES (?, ?, ?, ?)')
        .run(vInfo.lastInsertRowid, 'ch-1', '第一章', 0)
      return projectId
    })
    const id = tx()
    return this.getProject(Number(id))!
  }

  getOutline(projectId: number): { volumes: VolumeRow[]; chapters: ChapterRow[]; scenes: SceneRow[] } {
    const volumes = this.db
      .prepare<VolumeRow>('SELECT * FROM volumes WHERE project_id = ? ORDER BY order_index')
      .all(projectId)
    const chapters = this.db
      .prepare<ChapterRow>(
        'SELECT c.* FROM chapters c JOIN volumes v ON c.volume_id = v.id WHERE v.project_id = ? ORDER BY c.order_index',
      )
      .all(projectId)
    const scenes = this.db
      .prepare<SceneRow>(
        'SELECT s.* FROM scenes s JOIN chapters c ON s.chapter_id = c.id JOIN volumes v ON c.volume_id = v.id WHERE v.project_id = ? ORDER BY s.order_index',
      )
      .all(projectId)
    return { volumes, chapters, scenes }
  }

  getScene(id: number): SceneRow | undefined {
    return this.db.prepare<SceneRow>('SELECT * FROM scenes WHERE id = ?').get(id)
  }

  getChapter(id: number): ChapterRow | undefined {
    return this.db.prepare<ChapterRow>('SELECT * FROM chapters WHERE id = ?').get(id)
  }

  getVolume(id: number): VolumeRow | undefined {
    return this.db.prepare<VolumeRow>('SELECT * FROM volumes WHERE id = ?').get(id)
  }

  createVolume(projectId: number, slug: string, name: string): VolumeRow {
    const max = this.db
      .prepare<{ max: number | null }>('SELECT MAX(order_index) as max FROM volumes WHERE project_id = ?')
      .get(projectId)
    const orderIndex = (max?.max ?? -1) + 1
    this.db
      .prepare<{ lastInsertRowid: number; changes: number }>(
        'INSERT INTO volumes (project_id, slug, name, order_index) VALUES (?, ?, ?, ?)',
      )
      .run(projectId, slug, name, orderIndex)
    const id = this.db.prepare<{ id: number }>('SELECT last_insert_rowid() as id').get()!.id
    return this.getVolume(id)!
  }

  createChapter(volumeId: number, slug: string, title: string): ChapterRow {
    const max = this.db
      .prepare<{ max: number | null }>('SELECT MAX(order_index) as max FROM chapters WHERE volume_id = ?')
      .get(volumeId)
    const orderIndex = (max?.max ?? -1) + 1
    this.db
      .prepare<{ lastInsertRowid: number; changes: number }>('INSERT INTO chapters (volume_id, slug, title, order_index) VALUES (?, ?, ?, ?)')
      .run(volumeId, slug, title, orderIndex)
    return this.getChapter(Number(this.db.prepare<{ id: number }>('SELECT last_insert_rowid() as id').get()!.id))!
  }

  createScene(chapterId: number, slug: string, title: string): SceneRow {
    const max = this.db
      .prepare<{ max: number | null }>('SELECT MAX(order_index) as max FROM scenes WHERE chapter_id = ?')
      .get(chapterId)
    const orderIndex = (max?.max ?? -1) + 1
    this.db
      .prepare<{ lastInsertRowid: number; changes: number }>(
        "INSERT INTO scenes (chapter_id, slug, title, order_index, status, content_hash, entity_refs) VALUES (?, ?, ?, ?, 'draft', '', '[]')",
      )
      .run(chapterId, slug, title, orderIndex)
    const id = (this.db.prepare<{ id: number }>('SELECT last_insert_rowid() as id').get() as { id: number }).id
    return this.getScene(id)!
  }

  deleteProject(id: number): boolean {
    const result = this.db
      .prepare<{ changes: number }>('DELETE FROM projects WHERE id = ?')
      .run(id)
    return result.changes > 0
  }

  renameProject(id: number, name: string) {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('name required')
    this.db
      .prepare<{ lastInsertRowid: number; changes: number }>(
        "UPDATE projects SET name = ?, updated_at = ? WHERE id = ?",
      )
      .run(trimmed, new Date().toISOString(), id)
    return this.getProjectDto(id)
  }

  updateTheme(id: number, theme: string) {
    this.db
      .prepare<{ lastInsertRowid: number; changes: number }>(
        "UPDATE projects SET theme = ?, updated_at = ? WHERE id = ?",
      )
      .run(theme, new Date().toISOString(), id)
    return this.getProjectDto(id)
  }

  getProjectStats(projectId: number): { chapters: number; scenes: number; words: number } {
    const chapters = this.db
      .prepare<{ c: number }>('SELECT COUNT(*) as c FROM chapters c JOIN volumes v ON c.volume_id = v.id WHERE v.project_id = ?')
      .get(projectId)?.c ?? 0
    const scenes = this.db
      .prepare<{ c: number }>('SELECT COUNT(*) as c FROM scenes s JOIN chapters c ON s.chapter_id = c.id JOIN volumes v ON c.volume_id = v.id WHERE v.project_id = ?')
      .get(projectId)?.c ?? 0
    // word count: sum of all content_hash → look up manuscript by chapter+scene path; the file content is canonical
    // For an aggregate, the cheap estimate is sum of all chapter+scene manuscripts on disk.
    // We delegate to the caller (route) which can read the novelsDir; the repo just counts here.
    return { chapters, scenes, words: 0 }
  }

  touchProject(id: number): void {
    this.db
      .prepare<{ lastInsertRowid: number; changes: number }>('UPDATE projects SET updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id)
  }

  updateSceneStatus(id: number, status: 'draft' | 'revising' | 'done'): SceneRow | undefined {
    this.db
      .prepare<{ lastInsertRowid: number; changes: number }>('UPDATE scenes SET status = ? WHERE id = ?')
      .run(status, id)
    return this.getScene(id)
  }

  updateSceneTitle(id: number, title: string): SceneRow | undefined {
    const trimmed = title.trim()
    if (!trimmed) throw new Error('title required')
    this.db
      .prepare<{ lastInsertRowid: number; changes: number }>('UPDATE scenes SET title = ? WHERE id = ?')
      .run(trimmed, id)
    return this.getScene(id)
  }

  updateSceneTargetWords(id: number, targetWords: number | null): SceneRow | undefined {
    this.db
      .prepare<{ lastInsertRowid: number; changes: number }>('UPDATE scenes SET target_words = ? WHERE id = ?')
      .run(targetWords, id)
    return this.getScene(id)
  }

  updateChapterTitle(id: number, title: string): ChapterRow | undefined {
    const trimmed = title.trim()
    if (!trimmed) throw new Error('title required')
    this.db
      .prepare<{ lastInsertRowid: number; changes: number }>('UPDATE chapters SET title = ? WHERE id = ?')
      .run(trimmed, id)
    return this.getChapter(id)
  }

  updateChapterSummary(id: number, summary: string): ChapterRow | undefined {
    this.db
      .prepare<{ lastInsertRowid: number; changes: number }>('UPDATE chapters SET summary = ? WHERE id = ?')
      .run(summary, id)
    return this.getChapter(id)
  }

  updateVolumeName(id: number, name: string): VolumeRow | undefined {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('name required')
    this.db
      .prepare<{ lastInsertRowid: number; changes: number }>('UPDATE volumes SET name = ? WHERE id = ?')
      .run(trimmed, id)
    return this.getVolume(id)
  }

  deleteChapter(id: number): boolean {
    const result = this.db
      .prepare<{ changes: number }>('DELETE FROM chapters WHERE id = ?')
      .run(id)
    return result.changes > 0
  }

  deleteScene(id: number): boolean {
    const result = this.db
      .prepare<{ changes: number }>('DELETE FROM scenes WHERE id = ?')
      .run(id)
    return result.changes > 0
  }
}
