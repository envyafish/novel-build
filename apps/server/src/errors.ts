import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'

export class ApiError extends Error {
  statusCode: number
  code: string
  hint?: string
  details?: unknown
  constructor(opts: { statusCode: number; code: string; message: string; hint?: string; details?: unknown }) {
    super(opts.message)
    this.statusCode = opts.statusCode
    this.code = opts.code
    if (opts.hint !== undefined) this.hint = opts.hint
    if (opts.details !== undefined) this.details = opts.details
  }
}

export function apiError(statusCode: number, code: string, message: string, hint?: string, details?: unknown): ApiError {
  const opts: ConstructorParameters<typeof ApiError>[0] = { statusCode, code, message }
  if (hint !== undefined) opts.hint = hint
  if (details !== undefined) opts.details = details
  return new ApiError(opts)
}

export function registerErrorHandler(app: any) {
  app.setErrorHandler((err: FastifyError | ApiError, _req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof ApiError) {
      return reply.status(err.statusCode).send({
        code: err.code,
        message: err.message,
        ...(err.hint !== undefined ? { hint: err.hint } : {}),
        ...(err.details !== undefined ? { details: err.details } : {}),
      })
    }
    return reply.status(500).send({ code: 'internal_error', message: err.message })
  })
}
