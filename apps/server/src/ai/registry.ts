import fs from 'node:fs/promises'
import path from 'node:path'
import type { AppConfig, ProviderConfig, ProviderPublicInfo, AiProvider } from '@novel/shared'
import { OpenAiCompatibleProvider } from './openai-compatible.js'
import { FakeAiProvider } from './fake.js'

export class ProviderRegistry {
  private cfg: AppConfig = { providers: [], defaultProviderId: null }
  constructor(private configPath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.configPath, 'utf8')
      this.cfg = JSON.parse(raw) as AppConfig
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      this.cfg = { providers: [], defaultProviderId: null }
    }
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true })
    await fs.writeFile(this.configPath, JSON.stringify(this.cfg, null, 2), { encoding: 'utf8', mode: 0o600 })
  }

  listPublic(): ProviderPublicInfo[] {
    return this.cfg.providers.map((p) => ({ id: p.id, label: p.label }))
  }

  getConfig(id: string): ProviderConfig | undefined {
    return this.cfg.providers.find((p) => p.id === id)
  }

  getDefaultConfig(): ProviderConfig | undefined {
    const id = this.cfg.defaultProviderId ?? this.cfg.providers[0]?.id
    return id ? this.getConfig(id) : undefined
  }

  getProvider(id?: string): AiProvider {
    const cfg = id ? this.getConfig(id) : this.getDefaultConfig()
    if (cfg) return new OpenAiCompatibleProvider(cfg)
    return new FakeAiProvider()
  }

  /** Return full provider config (with apiKey masked) for the settings UI */
  listFull() {
    return this.cfg.providers.map((p) => ({
      id: p.id,
      label: p.label,
      baseUrl: p.baseUrl,
      hasApiKey: !!p.apiKey,
    }))
  }

  async addProvider(p: ProviderConfig): Promise<void> {
    const idx = this.cfg.providers.findIndex((x) => x.id === p.id)
    if (idx >= 0) {
      this.cfg.providers[idx] = p
    } else {
      this.cfg.providers.push(p)
    }
    if (!this.cfg.defaultProviderId) this.cfg.defaultProviderId = p.id
    await this.save()
  }

  async removeProvider(id: string): Promise<boolean> {
    const idx = this.cfg.providers.findIndex((p) => p.id === id)
    if (idx < 0) return false
    this.cfg.providers.splice(idx, 1)
    if (this.cfg.defaultProviderId === id) {
      this.cfg.defaultProviderId = this.cfg.providers[0]?.id ?? null
    }
    await this.save()
    return true
  }

  async setDefault(id: string): Promise<boolean> {
    if (!this.cfg.providers.find((p) => p.id === id)) return false
    this.cfg.defaultProviderId = id
    await this.save()
    return true
  }
}
