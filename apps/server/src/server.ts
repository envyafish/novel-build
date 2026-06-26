import Fastify from 'fastify'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.js'
import { createLogger } from './logger.js'
import { registerErrorHandler } from './errors.js'
import { openDb } from './db/index.js'
import { ProviderRegistry } from './ai/registry.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerOutlineRoutes } from './routes/outline.js'
import { registerSceneRoutes } from './routes/scenes.js'
import { registerSnapshotRoutes } from './routes/snapshots.js'
import { registerAiRoutes } from './routes/ai.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerExportRoutes } from './routes/export.js'
import { registerWorldRoutes } from './routes/world.js'
import { syncDiskHashes } from './manuscripts/diffScanner.js'

export async function buildServer(opts: { enableExternalScan?: boolean; silentLogger?: boolean } = {}) {
  const cfg = loadConfig()
  await fs.mkdir(cfg.novelsDir, { recursive: true })
  await fs.mkdir(cfg.logsDir, { recursive: true })
  const app = Fastify({ logger: opts.silentLogger ? false : createLogger(`${cfg.logsDir}/server.log`) })
  // Use a single shared index DB at ~/.novel/index.db for project metadata across all novels.
  const db = openDb(path.join(cfg.novelsDir, '..', 'index.db'))
  const registry = new ProviderRegistry(cfg.appConfigPath)
  await registry.load()
  registerProjectRoutes(app, db, cfg.novelsDir)
  registerOutlineRoutes(app, db)
  registerSceneRoutes(app, db, cfg.novelsDir)
  registerSnapshotRoutes(app, db, cfg.novelsDir)
  registerAiRoutes(app, db, registry, cfg.novelsDir)
  registerSettingsRoutes(app, db)
  registerExportRoutes(app, db, cfg.novelsDir)
  registerWorldRoutes(app, db)
  app.get('/health', async () => ({ ok: true }))

  // Periodic external scan: detects files modified outside the app and
  // updates `scenes.content_hash` so the next PUT can detect the change.
  // Disabled in tests via opts.enableExternalScan = false to avoid leaking timers.
  if (opts.enableExternalScan !== false) {
    const interval = Number(process.env.EXTERNAL_SCAN_MS ?? 60000)
    const timer = setInterval(async () => {
      try {
        await syncDiskHashes(db, cfg.novelsDir)
      } catch {
        // best-effort
      }
    }, interval)
    timer.unref()
    // Expose for tests to clean up
    ;(app as unknown as { __externalScanTimer: NodeJS.Timeout }).__externalScanTimer = timer
  }

  return { app, cfg, db }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { app, cfg } = await buildServer()
  await app.listen({ host: cfg.host, port: cfg.port })
}
