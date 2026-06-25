import fs from 'node:fs/promises'
import path from 'node:path'
import { sha256 } from './hash.js'
import { recordSelfWrite } from './selfWriteRegistry.js'

export async function readManuscript(filePath: string): Promise<{ text: string; hash: string }> {
  let text: string
  try {
    text = await fs.readFile(filePath, 'utf8')
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { text: '', hash: sha256('') }
    }
    throw e
  }
  return { text, hash: sha256(text) }
}

export async function writeManuscript(filePath: string, text: string): Promise<string> {
  const hash = sha256(text)
  const tmp = `${filePath}.${hash}.tmp`
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(tmp, text, 'utf8')
  const fh = await fs.open(tmp, 'r+')
  await fh.sync()
  await fh.close()
  await fs.rename(tmp, filePath)
  recordSelfWrite(filePath, hash)
  return hash
}
