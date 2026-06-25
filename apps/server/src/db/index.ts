import { openDb as openSqlite, type Database } from './sqlite.js'
import { MIGRATIONS } from './migrations.js'

export function openDb(dbPath: string): Database {
  const db = openSqlite(dbPath)
  // Pragmas via exec (our wrapper exposes no direct pragma API for node:sqlite)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  runMigrations(db)
  return db
}

export function runMigrations(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`)
  const applied = db.prepare<{ id: number }>('SELECT id FROM _migrations').all().map((r) => r.id)
  const tx = db.transaction((m: { id: number; sql: string }) => {
    db.exec(m.sql)
    db.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)').run(m.id, new Date().toISOString())
  })
  for (const m of MIGRATIONS) {
    if (!applied.includes(m.id)) tx(m)
  }
}
