import fs from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { sha256 } from '../manuscripts/hash.js'

export async function writeObject(dir: string, text: string): Promise<string> {
  const hash = sha256(text)
  const file = path.join(dir, `${hash}.md.z`)
  try {
    await fs.access(file)
    return hash
  } catch {
    await fs.mkdir(dir, { recursive: true })
    const buf = zlib.gzipSync(Buffer.from(text, 'utf8'))
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, buf)
    const fh = await fs.open(tmp, 'r+')
    await fh.sync()
    await fh.close()
    await fs.rename(tmp, file)
    return hash
  }
}

export async function readObject(dir: string, hash: string): Promise<string> {
  const buf = await fs.readFile(path.join(dir, `${hash}.md.z`))
  return zlib.gunzipSync(buf).toString('utf8')
}
