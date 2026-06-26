export type EntityStatus = 'draft' | 'revising' | 'done'

export interface ProjectDto {
  id: number
  slug: string
  name: string
  theme: string
  storyArcNotes: string
  createdAt: string
  updatedAt: string
  currentVolumeId: number | null
}

export interface VolumeDto {
  id: number
  projectId: number
  slug: string
  name: string
  orderIndex: number
}

export interface ChapterDto {
  id: number
  volumeId: number
  slug: string
  title: string
  orderIndex: number
  status: EntityStatus
}

export interface SceneDto {
  id: number
  chapterId: number
  slug: string
  title: string
  orderIndex: number
  status: EntityStatus
  targetWords: number | null
  notes: string | null
  contentHash: string
  wordCount: number
}

export interface SceneDetailDto extends SceneDto {
  markdown: string
  baseHash: string
}

export interface SnapshotMetaDto {
  hash: string
  kind: 'auto' | 'manual'
  sceneId: number
  createdAt: string
  parentHash: string | null
}

interface DiffLine {
  kind: 'eq' | 'add' | 'del'
  text: string
}

export interface SnapshotDiffDto {
  a: { hash: string; createdAt: string }
  b: { hash: string; createdAt: string }
  lines: DiffLine[]
}

export interface AiSettingsDto {
  projectId: number
  providerId: string
  model: string
  systemPrompt: string
  contextPrevChars: number
}

export interface ProviderInfoDto {
  id: string
  label: string
}

// World database entities

export interface CharacterDto {
  id: number
  projectId: number
  name: string
  aliases: string[]
  appearance: string
  personality: string
  background: string
  relationships: string
  voiceProfile: string
  notes: string
  createdAt: string
  updatedAt: string
}

export type WorldCategory = 'location' | 'organization' | 'item' | 'concept' | 'rule'

export interface WorldElementDto {
  id: number
  projectId: number
  name: string
  category: WorldCategory
  description: string
  notes: string
  createdAt: string
  updatedAt: string
}

export interface TimelineEventDto {
  id: number
  projectId: number
  title: string
  era: string
  description: string
  relatedCharacterIds: number[]
  relatedWorldIds: number[]
  notes: string
  orderIndex: number
  createdAt: string
  updatedAt: string
}

export type ForeshadowStatus = 'planted' | 'revealed' | 'resolved'

export interface ForeshadowDto {
  id: number
  projectId: number
  title: string
  description: string
  status: ForeshadowStatus
  plantedSceneId: number | null
  resolvedSceneId: number | null
  notes: string
  createdAt: string
  updatedAt: string
}

export type ConflictType = 'person_vs_person' | 'person_vs_self' | 'person_vs_society' | 'person_vs_nature' | 'person_vs_fate'
export type ConflictPhase = 'setup' | 'escalation' | 'climax' | 'resolution'

export interface ConflictDto {
  id: number
  projectId: number
  title: string
  type: ConflictType
  description: string
  relatedCharacterIds: number[]
  setup: string
  escalation: string
  climax: string
  resolution: string
  status: ConflictPhase
  notes: string
  createdAt: string
  updatedAt: string
}
