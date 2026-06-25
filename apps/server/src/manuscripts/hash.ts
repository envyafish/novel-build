import crypto from 'node:crypto'

/**
 * Normalize text before hashing so cross-platform line endings and trailing
 * whitespace don't produce a different hash for visually-identical content.
 * We do NOT normalize the text written to disk — preserving the user's
 * original content is more important than deduplicating whitespace. The
 * trade-off: an editor on Windows that saves \r\n and then a Mac that
 * normalizes to \n before PUT will produce the same hash here, but the
 * file on disk still has \r\n. The PUT guard now relies on this hash, so
 * a subsequent PUT from the Mac client with normalized text triggers an
 * external_change 422 (intentional — the user can choose "force" to
 * overwrite).
 */
export function normalizeForHash(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd()
}

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(normalizeForHash(text), 'utf8').digest('hex')
}
