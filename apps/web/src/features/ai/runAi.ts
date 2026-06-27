import { consumeNdjson } from '../../api/stream.js'

/**
 * Fire a single /api/ai/complete request and accumulate the streamed text.
 * Returns the full assembled response. Throws on transport errors, non-2xx
 * status, or recoverable error frames from the server.
 *
 * `projectId` is the preferred project-resolution key (server uses it directly,
 * no scene JOIN needed). `sceneId` is optional — only needed for modes that
 * pull scene-specific context (previous scene tail, scene notes, outline).
 *
 * Pass `signal` to allow the caller to abort the request (e.g. when the user
 * closes the review/extract panel while a request is in flight). The function
 * throws an `AbortError` if aborted.
 */
export async function runAiCompletion(opts: {
  sceneId?: number
  projectId?: number
  mode: string
  model: string
  inputText: string
  signal?: AbortSignal | null
  /** For `generate_chapter`: when the current chapter is empty, also
   *  pull the previous chapter's tail as opening context. */
  includePrevChapterTail?: boolean
}): Promise<string> {
  let res: Response
  try {
    res = await fetch('/api/ai/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(opts.sceneId !== undefined ? { sceneId: opts.sceneId } : {}),
        ...(opts.projectId !== undefined ? { projectId: opts.projectId } : {}),
        mode: opts.mode,
        model: opts.model,
        inputText: opts.inputText,
        ...(opts.includePrevChapterTail ? { includePrevChapterTail: true } : {}),
      }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    // fetch() itself threw — most likely the dev server (Vite on 5173) is down.
    throw new Error(`无法连接到本地开发服务器(5173),请确认 \`pnpm dev\` 已启动`)
  }
  if (!res.ok || !res.body) {
    // 404 / 502 / 504 from the Vite proxy almost always means Fastify (4317)
    // isn't reachable. The /api/ai/complete route exists on Fastify itself,
    // so a real 404 from Fastify is unlikely.
    if (res.status === 404 || res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error(`后端服务无响应(${res.status})。请确认 \`pnpm dev\` 同时启动了 server(4317)和 web(5173)`)
    }
    throw new Error(`ai_http_${res.status}`)
  }
  let full = ''
  for await (const e of consumeNdjson(res, opts.signal ?? undefined)) {
    if (e.kind === 'delta') {
      full += e.delta
    } else if (e.kind === 'error') {
      throw new Error(e.message)
    } else if (e.kind === 'done') {
      break
    }
  }
  return full
}