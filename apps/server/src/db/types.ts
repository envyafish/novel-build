export interface ProjectRow {
  id: number
  slug: string
  name: string
  theme: string
  story_arc_notes: string
  created_at: string
  updated_at: string
  current_volume_id: number | null
}

export interface VolumeRow {
  id: number
  project_id: number
  slug: string
  name: string
  order_index: number
}

export interface ChapterRow {
  id: number
  volume_id: number
  slug: string
  title: string
  order_index: number
  status: 'draft' | 'revising' | 'done'
  summary: string
}

export interface SceneRow {
  id: number
  chapter_id: number
  slug: string
  title: string
  order_index: number
  status: 'draft' | 'revising' | 'done'
  target_words: number | null
  notes: string | null
  content_hash: string
  entity_refs: string
}

export interface AiSettingsRow {
  project_id: number
  provider_id: string
  model: string
  system_prompt: string
  context_prev_chars: number
}

export interface SnapshotMetaRow {
  hash: string
  kind: 'auto' | 'manual'
  scene_id: number
  created_at: string
  parent_hash: string | null
}
