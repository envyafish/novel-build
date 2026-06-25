import { api } from '../../api/client.js'
import type { ProviderInfoDto, AiSettingsDto } from '@novel/shared'

export interface ProviderFullInfo {
  id: string
  label: string
  baseUrl: string
  hasApiKey: boolean
  isDefault?: boolean
}

export const aiApi = {
  providers: () => api<ProviderFullInfo[]>('/api/ai/providers'),
  addProvider: (p: { id: string; label: string; baseUrl: string; apiKey: string }) =>
    api<{ ok: true }>('/api/ai/providers', { method: 'POST', body: JSON.stringify(p) }),
  removeProvider: (id: string) =>
    api<{ ok: true }>(`/api/ai/providers/${id}`, { method: 'DELETE' }),
  setDefault: (id: string) =>
    api<{ ok: true }>(`/api/ai/providers/${id}/default`, { method: 'PUT' }),
  getSettings: (projectId: number) => api<AiSettingsDto>(`/api/projects/${projectId}/ai-settings`),
  putSettings: (s: AiSettingsDto) =>
    api<{ ok: true }>('/api/projects/ai-settings', { method: 'PUT', body: JSON.stringify(s) }),
}
