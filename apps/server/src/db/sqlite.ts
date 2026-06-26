/**
 * Thin wrapper over node:sqlite (Node 22.5+) that exposes a better-sqlite3-like
 * API. Avoids a native build step and works on any platform that ships the
 * experimental sqlite module behind --experimental-sqlite (or unflagged on 23+).
 *
 * We load `node:sqlite` via `createRequire` so the SSR module resolver used
 * by Vitest/Vite doesn't try to resolve the `node:` scheme as a bare specifier.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sqliteModule = require('node:sqlite') as typeof import('node:sqlite')
const { DatabaseSync, StatementSync } = sqliteModule
type DatabaseSyncType = typeof DatabaseSync.prototype
type StatementSyncType = typeof StatementSync.prototype

type BindParams = ReadonlyArray<unknown> | Record<string, unknown>

interface RunResult {
  lastInsertRowid: number | bigint
  changes: number
}

class PreparedStatement<R = unknown> {
  constructor(private stmt: StatementSyncType) {}
  all(...params: unknown[]): R[] {
    const rows = this.stmt.all(...(params as never[])) as R[]
    return rows.map((r) => (r && typeof r === 'object' ? Object.assign({}, r) : r)) as R[]
  }
  get(...params: unknown[]): R | undefined {
    const row = this.stmt.get(...(params as never[])) as R | undefined
    if (row === undefined || row === null) return undefined
    return Object.assign({}, row) as R
  }
  run(...params: unknown[]): RunResult {
    const r = this.stmt.run(...(params as never[])) as RunResult
    return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.changes }
  }
}

export class Database {
  private db: DatabaseSyncType
  constructor(filename: string) {
    this.db = new DatabaseSync(filename)
  }
  exec(sql: string): void {
    this.db.exec(sql)
  }
  prepare<R = unknown>(sql: string): PreparedStatement<R> {
    return new PreparedStatement<R>(this.db.prepare(sql))
  }
  pragma(pragma: string): unknown {
    // node:sqlite has db.function/aggregate but no direct pragma. Issue via exec and read back.
    this.db.exec(`PRAGMA ${pragma}`)
    return undefined
  }
  /**
   * Mirror better-sqlite3's `db.transaction(fn)`: returns a wrapper that
   * runs `fn` inside BEGIN/COMMIT, ROLLBACK on error. The wrapper is
   * synchronous like the rest of node:sqlite.
   */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => {
      this.db.exec('BEGIN')
      try {
        const result = fn(...args)
        this.db.exec('COMMIT')
        return result
      } catch (e) {
        try { this.db.exec('ROLLBACK') } catch { /* ignore rollback failure */ }
        throw e
      }
    }
  }
  close(): void {
    this.db.close()
  }
}

export function openDb(filename: string): Database {
  return new Database(filename)
}
