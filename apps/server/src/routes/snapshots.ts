// @ts-nocheck - Fastify 4 + @types/node 25 route inference under exactOptionalPropertyTypes is noisy; runtime is correct.
import type { FastifyInstance } from 'fastify'
import type { Database } from '../db/sqlite.js'
import path from 'node:path'
import { ManuscriptService } from '../manuscripts/service.js'
import { SnapshotService } from '../snapshots/service.js'
import { ProjectRepo } from '../projects/repo.js'
import { diffLines } from '../snapshots/diff.js'
import { apiError } from '../errors.js'

function findProjectSlug(db: Database, sceneId: number): string | undefined {
  const row = db
    .prepare<{ project_slug: string }>(
      `SELECT p.slug as project_slug FROM projects p
       JOIN volumes v ON v.project_id = p.id
       JOIN chapters c ON c.volume_id = v.id
       WHERE c.id = (SELECT chapter_id FROM scenes WHERE id = ?)`,
    )
    .get(sceneId)
  return row?.project_slug
}


export function registerSnapshotRoutes(app: any, db: Database, novelsDir: string) {
  const repo = new ProjectRepo(db)
  const svc = new ManuscriptService(db, novelsDir)

  app.get<{ Params: { id: string } }>('/api/scenes/:id/snapshots', async (req) => {
    const id = Number(req.params.id)
    const scene = repo.getScene(id)
    if (!scene) throw apiError(404, 'scene_not_found', `scene ${id} not found`)
    const slug = findProjectSlug(db, id)
    if (!slug) throw apiError(404, 'project_not_found', 'project not found')
    return svc.listSnapshots(id, path.join(novelsDir, slug))
  })

  app.get<{ Params: { id: string }; Querystring: { hashA: string; hashB: string } }>('/api/scenes/:id/snapshots/diff', async (req) => {
    const id = Number(req.params.id)
    const { hashA, hashB } = req.query
    if (!hashA || !hashB) throw apiError(400, 'missing_params', 'hashA and hashB are required')
    const scene = repo.getScene(id)
    if (!scene) throw apiError(404, 'scene_not_found', `scene ${id} not found`)
    const slug = findProjectSlug(db, id)
    if (!slug) throw apiError(404, 'project_not_found', 'project not found')
    const projectDir = path.join(novelsDir, slug)
    const snapSvc = new SnapshotService(db, projectDir)
    // Verify both hashes belong to this scene
    const rowA = db.prepare<{ hash: string; created_at: string }>('SELECT hash, created_at FROM snapshots_meta WHERE hash = ? AND scene_id = ?').get(hashA, id)
    const rowB = db.prepare<{ hash: string; created_at: string }>('SELECT hash, created_at FROM snapshots_meta WHERE hash = ? AND scene_id = ?').get(hashB, id)
    if (!rowA) throw apiError(404, 'snapshot_not_found', `snapshot ${hashA} not found for scene ${id}`)
    if (!rowB) throw apiError(404, 'snapshot_not_found', `snapshot ${hashB} not found for scene ${id}`)
    const textA = await snapSvc.restoreScene(id, hashA)
    const textB = await snapSvc.restoreScene(id, hashB)
    const lines = diffLines(textA, textB)
    return {
      a: { hash: hashA, createdAt: rowA.created_at },
      b: { hash: hashB, createdAt: rowB.created_at },
      lines,
    }
  })

  app.post<{ Params: { id: string } }>('/api/scenes/:id/snapshot', async (req) => {
    const id = Number(req.params.id)
    const scene = repo.getScene(id)
    if (!scene) throw apiError(404, 'scene_not_found', `scene ${id} not found`)
    const slug = findProjectSlug(db, id)
    if (!slug) throw apiError(404, 'project_not_found', 'project not found')
    const projectDir = path.join(novelsDir, slug)
    const snapSvc = new SnapshotService(db, projectDir)
    const manuscriptSvc = new ManuscriptService(db, novelsDir)
    const { text, hash: contentHash } = await manuscriptSvc.readScene(id)
    if (!text.trim()) throw apiError(422, 'empty_scene', '场景内容为空，无法创建快照')
    await snapSvc.snapshotScene(id, text, 'manual')
    // Update kind to manual in case it was auto before
    db.prepare("UPDATE snapshots_meta SET kind = 'manual' WHERE hash = ? AND scene_id = ?").run(contentHash, id)
    return { hash: contentHash, kind: 'manual' as const }
  })

  app.post<{ Params: { id: string; hash: string } }>('/api/scenes/:id/snapshots/:hash/restore', async (req, reply) => {
    const id = Number(req.params.id)
    const slug = findProjectSlug(db, id)
    if (!slug) throw apiError(404, 'project_not_found', 'project not found')
    const projectDir = path.join(novelsDir, slug)
    const snap = new SnapshotService(db, projectDir)
    const ms = new ManuscriptService(db, novelsDir)
    const onDisk = await ms.readScene(id)
    const markdown = await snap.restoreScene(id, req.params.hash)
    // Write restored content to disk + update scenes.content_hash so the next
    // PUT uses a fresh baseHash and does not trigger spurious external_change.
    // createSnapshot defaults to true — a safety snapshot of the current
    // (pre-restore) content is automatically saved so the user can undo.
    await ms.saveScene({
      sceneId: id,
      markdown,
      baseHash: onDisk.hash,
      projectDirAbs: projectDir,
      force: true,
    })
    const after = await ms.readScene(id)
    return { markdown, baseHash: after.hash }
  })
}
