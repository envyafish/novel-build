import type { AiProvider, CompletionRequest } from '@novel/shared'

interface FakeOptions {
  chunkSize?: number
  delayMs?: number
  errorAfter?: Error
  response?: string
}

export class FakeAiProvider implements AiProvider {
  readonly id = 'fake'
  readonly label = 'Fake (test)'
  constructor(private opts: FakeOptions = {}) {}

  async *complete(req: CompletionRequest): AsyncIterable<string> {
    const text = this.opts.response ?? 'FAKE-RESPONSE'
    const size = this.opts.chunkSize ?? 5
    for (let i = 0; i < text.length; i += size) {
      if (req.signal?.aborted) return
      if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs))
      yield text.slice(i, i + size)
    }
    if (this.opts.errorAfter) throw this.opts.errorAfter
  }
}
