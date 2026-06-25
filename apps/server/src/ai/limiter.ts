export class StreamLimiter {
  private active = 0
  private queue: Array<() => void> = []
  constructor(public readonly max: number) {}

  async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('aborted')
    if (this.active < this.max) {
      this.active++
      return
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const idx = this.queue.indexOf(tryAcquire)
        if (idx >= 0) this.queue.splice(idx, 1)
        reject(new Error('aborted'))
      }
      const tryAcquire = () => {
        if (signal?.aborted) return reject(new Error('aborted'))
        signal?.removeEventListener('abort', onAbort)
        this.active++
        resolve()
      }
      signal?.addEventListener('abort', onAbort)
      this.queue.push(tryAcquire)
    })
  }

  release(): void {
    this.active = Math.max(0, this.active - 1)
    const next = this.queue.shift()
    if (next) next()
  }
}
