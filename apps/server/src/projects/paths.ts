import path from 'node:path'

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export function projectDir(novelsDir: string, slug: string): string {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid slug: ${slug}`)
  return path.join(novelsDir, slug)
}

export function manuscriptPath(projectDir: string, volSlug: string, chapSlug: string, sceneSlug: string): string {
  return path.join(projectDir, 'manuscripts', volSlug, chapSlug, `${sceneSlug}.md`)
}

export function snapshotsDir(projectDir: string): string {
  return path.join(projectDir, '.snapshots')
}
