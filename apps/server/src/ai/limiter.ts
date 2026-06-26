export class StreamLimiter {
  private active = 0
  private queue: Array<() => void> = []
  constructor(public readonly max: number) {}

  async acquire(signal?: AbortSignal, opts?: { timeoutMs?: number }): Promise<void> {
    if (signal?.aborted) throw new Error('aborted')
    if (this.active < this.max) {
      this.active++
      return
    }
    const timeoutMs = opts?.timeoutMs
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (err: Error) => {
        if (settled) return
        settled = true
        clearTimeoutIfSet()
        const idx = this.queue.indexOf(tryAcquire)
        if (idx >= 0) this.queue.splice(idx, 1)
        reject(err)
      }
      const onAbort = () => settle(new Error('aborted'))
      const tryAcquire = () => {
        if (settled) return
        if (signal?.aborted) return settle(new Error('aborted'))
        signal?.removeEventListener('abort', onAbort)
        clearTimeoutIfSet()
        this.active++
        settled = true
        resolve()
      }
      let timer: NodeJS.Timeout | undefined
      const clearTimeoutIfSet = () => {
        if (timer) {
          clearTimeout(timer)
          timer = undefined
        }
      }
      if (timeoutMs !== undefined && timeoutMs > 0) {
        timer = setTimeout(() => settle(new Error('queue timeout')), timeoutMs)
        // Don't keep the event loop alive just for this timer.
        timer.unref?.()
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
