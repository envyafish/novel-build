export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface CompletionRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  stream: true
  signal?: AbortSignal
}

export type CompletionMode =
  | 'continue'
  | 'polish'
  | 'rewrite'
  | 'expand'
  | 'condense'
  | 'generate_scene'
  | 'generate_chapter'
  | 'suggest_next_chapter'
  | 'auto_review'
  | 'plan_story_arc'
  | 'analyze_voice'
  | 'consistency_check'
  | 'generate_character'
  | 'generate_world'
  | 'generate_timeline'
  | 'generate_foreshadow'
  | 'generate_conflict'

export interface AiProvider {
  id: string
  label: string
  complete(req: CompletionRequest): AsyncIterable<string>
}

export interface ProviderPublicInfo {
  id: string
  label: string
}

export interface ProviderConfig {
  id: string
  label: string
  baseUrl: string
  apiKey: string
}

export interface AppConfig {
  providers: ProviderConfig[]
  defaultProviderId: string | null
}
