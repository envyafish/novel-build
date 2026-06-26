import { api } from '../../api/client.js'
import type { CharacterDto, WorldElementDto, TimelineEventDto, ForeshadowDto, ConflictDto } from '@novel/shared'

export const worldApi = {
  // Characters
  listCharacters: (projectId: number) => api<CharacterDto[]>(`/api/projects/${projectId}/characters`),
  createCharacter: (projectId: number, data: Partial<CharacterDto>) =>
    api<CharacterDto>(`/api/projects/${projectId}/characters`, { method: 'POST', body: JSON.stringify(data) }),
  updateCharacter: (id: number, data: Partial<CharacterDto>) =>
    api<CharacterDto>(`/api/characters/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCharacter: (id: number) => api<{ ok: true }>(`/api/characters/${id}`, { method: 'DELETE' }),

  // World Elements
  listWorldElements: (projectId: number) => api<WorldElementDto[]>(`/api/projects/${projectId}/world-elements`),
  createWorldElement: (projectId: number, data: Partial<WorldElementDto>) =>
    api<WorldElementDto>(`/api/projects/${projectId}/world-elements`, { method: 'POST', body: JSON.stringify(data) }),
  updateWorldElement: (id: number, data: Partial<WorldElementDto>) =>
    api<WorldElementDto>(`/api/world-elements/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWorldElement: (id: number) => api<{ ok: true }>(`/api/world-elements/${id}`, { method: 'DELETE' }),

  // Timeline
  listTimeline: (projectId: number) => api<TimelineEventDto[]>(`/api/projects/${projectId}/timeline`),
  createTimelineEvent: (projectId: number, data: Partial<TimelineEventDto>) =>
    api<TimelineEventDto>(`/api/projects/${projectId}/timeline`, { method: 'POST', body: JSON.stringify(data) }),
  updateTimelineEvent: (id: number, data: Partial<TimelineEventDto>) =>
    api<TimelineEventDto>(`/api/timeline/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTimelineEvent: (id: number) => api<{ ok: true }>(`/api/timeline/${id}`, { method: 'DELETE' }),

  // Foreshadows
  listForeshadows: (projectId: number) => api<ForeshadowDto[]>(`/api/projects/${projectId}/foreshadows`),
  createForeshadow: (projectId: number, data: Partial<ForeshadowDto>) =>
    api<ForeshadowDto>(`/api/projects/${projectId}/foreshadows`, { method: 'POST', body: JSON.stringify(data) }),
  updateForeshadow: (id: number, data: Partial<ForeshadowDto>) =>
    api<ForeshadowDto>(`/api/foreshadows/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteForeshadow: (id: number) => api<{ ok: true }>(`/api/foreshadows/${id}`, { method: 'DELETE' }),

  // Conflicts
  listConflicts: (projectId: number) => api<ConflictDto[]>(`/api/projects/${projectId}/conflicts`),
  createConflict: (projectId: number, data: Partial<ConflictDto>) =>
    api<ConflictDto>(`/api/projects/${projectId}/conflicts`, { method: 'POST', body: JSON.stringify(data) }),
  updateConflict: (id: number, data: Partial<ConflictDto>) =>
    api<ConflictDto>(`/api/conflicts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteConflict: (id: number) => api<{ ok: true }>(`/api/conflicts/${id}`, { method: 'DELETE' }),
}
