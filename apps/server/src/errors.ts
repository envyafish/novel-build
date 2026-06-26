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
    // Surface SQLite UNIQUE violations as 409 instead of generic 500. Without
    // this, two POSTs racing on the same slug (or a user re-using a slug) hit
    // a raw constraint error that the client can't distinguish from a crash.
    // node:sqlite normally surfaces `SQLITE_CONSTRAINT_UNIQUE` on the error's
    // `code` field; we also accept the generic `SQLITE_CONSTRAINT` with a
    // `UNIQUE` mention in the message as a belt-and-braces fallback.
    const sqliteErr = err as { code?: string; message?: string }
    const sqliteCode = sqliteErr.code
    const msg = sqliteErr.message ?? ''
    const isUniqueViolation =
      sqliteCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
      (sqliteCode === 'SQLITE_CONSTRAINT' && /UNIQUE/i.test(msg))
    if (isUniqueViolation) {
      return reply.status(409).send({
        code: 'slug_taken',
        message: 'slug already in use',
        hint: 'choose a different slug',
      })
    }
    return reply.status(500).send({ code: 'internal_error', message: err.message })
  })
}
