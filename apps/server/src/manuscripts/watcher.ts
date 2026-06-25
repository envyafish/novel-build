import fs from 'node:fs/promises'
import path from 'node:path'
import { sha256 } from './hash.js'

export async function scanManuscripts(manuscriptsRoot: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile() && p.endsWith('.md')) {
        const text = await fs.readFile(p, 'utf8')
        out[p] = sha256(text)
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
