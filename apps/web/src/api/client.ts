export class ApiClientError extends Error {
  status: number
  code: string
  hint?: string
  details?: unknown
  constructor(status: number, body: { code: string; message: string; hint?: string; details?: unknown }) {
    super(body.message)
    this.status = status
    this.code = body.code
    if (body.hint !== undefined) this.hint = body.hint
    if (body.details !== undefined) this.details = body.details
  }
}

export async function api<T>(input: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init.body !== null
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> ?? {}) }
  if (hasBody && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(input, { ...init, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ code: 'unknown', message: res.statusText }))
    throw new ApiClientError(res.status, body)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
