import type { ChapterDto, SceneDto, VolumeDto } from '@novel/shared'

export interface OutlineNode {
  kind: 'volume' | 'chapter' | 'scene'
  id: number
  label: string
  status?: string
  children?: OutlineNode[]
}

export function buildTree(volumes: VolumeDto[], chapters: ChapterDto[], scenes: SceneDto[]): OutlineNode[] {
  return volumes
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((v) => ({
      kind: 'volume' as const,
      id: v.id,
      label: v.name,
      children: chapters
        .filter((c) => c.volumeId === v.id)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((c) => ({
          kind: 'chapter' as const,
          id: c.id,
          label: c.title,
          status: c.status,
          children: scenes
            .filter((s) => s.chapterId === c.id)
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((s) => ({ kind: 'scene' as const, id: s.id, label: s.title, status: s.status })),
        })),
    }))
}
