import { api } from '../../api/client.js'
import type { ProjectDto, VolumeDto, ChapterDto, SceneDto } from '@novel/shared'

export interface ProjectStatsDto {
  chapters: number
  scenes: number
  words: number
  todayWords: number
  goal?: { daily_target_words: number; weekly_target_scenes: number }
}

export const projectsApi = {
  list: () => api<ProjectDto[]>('/api/projects'),
  create: (name: string, slug: string) =>
    api<ProjectDto>('/api/projects', { method: 'POST', body: JSON.stringify({ name, slug }) }),
  get: (id: number) => api<ProjectDto>(`/api/projects/${id}`),
  remove: (id: number) => api<{ ok: true }>(`/api/projects/${id}`, { method: 'DELETE' }),
  rename: (id: number, name: string) =>
    api<ProjectDto>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  stats: (id: number) => api<ProjectStatsDto>(`/api/projects/${id}/stats`),
  outline: (id: number) =>
    api<{ volumes: VolumeDto[]; chapters: ChapterDto[]; scenes: SceneDto[] }>(
      `/api/projects/${id}/outline`,
    ),
  exportUrl: (id: number, format: string) => `/api/projects/${id}/export?format=${format}`,
}

export const outlineApi = {
  fetch: (projectId: number) =>
    api<{ volumes: VolumeDto[]; chapters: ChapterDto[]; scenes: SceneDto[] }>(
      `/api/projects/${projectId}/outline`,
    ),
  createVolume: (projectId: number, slug: string, name: string) =>
    api<VolumeDto>('/api/volumes', { method: 'POST', body: JSON.stringify({ projectId, slug, name }) }),
  createChapter: (volumeId: number, slug: string, title: string) =>
    api<ChapterDto>('/api/chapters', { method: 'POST', body: JSON.stringify({ volumeId, slug, title }) }),
  createScene: (chapterId: number, slug: string, title: string) =>
    api<SceneDto>('/api/scenes', { method: 'POST', body: JSON.stringify({ chapterId, slug, title }) }),
  patchChapter: (id: number, title: string) =>
    api<ChapterDto>(`/api/chapters/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  patchVolume: (id: number, name: string) =>
    api<VolumeDto>(`/api/volumes/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  patchScene: (id: number, body: { title?: string; status?: 'draft' | 'revising' | 'done'; targetWords?: number | null }) =>
    api<SceneDto>(`/api/scenes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteChapter: (id: number) => api<{ ok: true }>(`/api/chapters/${id}`, { method: 'DELETE' }),
  deleteScene: (id: number) => api<{ ok: true }>(`/api/scenes/${id}`, { method: 'DELETE' }),
}
