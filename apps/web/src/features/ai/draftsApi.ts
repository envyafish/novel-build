import { api } from '../../api/client.js'

type DraftStatus = 'streaming' | 'done' | 'error' | 'aborted'

export interface DraftDto {
  id: string
  projectId: number
  sceneId: number | null
  mode: string
  model: string
  text: string
  status: DraftStatus
  errorMessage: string | null
  maxOutputTokens: number
  usage: { promptTokens: number; completionTokens: number }
  createdAt: string
  updatedAt: string
  expiresAt: string
}

interface CreateDraftInput {
  projectId: number
  sceneId?: number | null
  mode: string
  model: string
  maxOutputTokens?: number
  ttlMs?: number
}

export const draftsApi = {
  create: (input: CreateDraftInput) =>
    api<DraftDto>('/api/ai/drafts', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  get: (id: string) => api<DraftDto>(`/api/ai/drafts/${id}`),
  listByScene: (sceneId: number) =>
    api<DraftDto[]>(`/api/ai/drafts?sceneId=${sceneId}`),
  listByProject: (projectId: number) =>
    api<DraftDto[]>(`/api/ai/drafts?projectId=${projectId}`),
  remove: (id: string) => api<{ ok: true }>(`/api/ai/drafts/${id}`, { method: 'DELETE' }),
}