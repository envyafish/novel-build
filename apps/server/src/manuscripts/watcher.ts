import fs from 'node:fs/promises'
import path from 'node:path'

export interface ManuscriptFingerprint {
  /** File size in bytes. Cheap to read via stat, no file content load. */
  size: number
  /** Modification time in milliseconds since epoch. */
  mtimeMs: number
}

export async function scanManuscripts(manuscriptsRoot: string): Promise<Record<string, ManuscriptFingerprint>> {
  const out: Record<string, ManuscriptFingerprint> = {}
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile() && p.endsWith('.md')) {
        const stat = await fs.stat(p)
        out[p] = { size: stat.size, mtimeMs: stat.mtimeMs }
      }
    }
  }
  try {
    await walk(manuscriptsRoot)
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  return out
}
