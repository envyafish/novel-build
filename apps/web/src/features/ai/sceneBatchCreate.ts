import type { QueryClient } from '@tanstack/react-query'
import { api } from '../../api/client.js'
import { outlineApi } from '../outline/api.js'
import { titleToSlug, type ParsedScene } from './sceneSplitter.js'

export interface ApplySceneBatchOptions {
  projectId: number
  chapterId: number
  scenes: ParsedScene[]
  qc: QueryClient
}

export interface ApplySceneBatchResult {
  createdIds: number[]
  failedTitles: string[]
}

/**
 * Insert a batch of generated scenes into the outline.
 *
 * Each scene is created via `outlineApi.createScene` (server assigns
 * order_index = MAX + 1, so the batch lands at the chapter end in the
 * order returned by `splitChapterToScenes`). If a scene has non-empty
 * markdown, it's written via PUT /api/scenes/:id so the manuscript is
 * persisted in the same step.
 *
 * **Failure isolation**: a single failing scene does NOT abort the batch.
 * It is collected in `failedTitles` and the loop continues. This is a
 * deliberate fix over the original `applyAcceptedText` (EditorPage.tsx
 * 2026-06-26) which threw on the first error and silently dropped the
 * rest of the generated scenes.
 */
export async function applyGeneratedScenes(
  opts: ApplySceneBatchOptions,
): Promise<ApplySceneBatchResult> {
  const createdIds: number[] = []
  const failedTitles: string[] = []
  for (let i = 0; i < opts.scenes.length; i++) {
    const s = opts.scenes[i]!
    const slug = titleToSlug(s.title, i)
    try {
      const created = await outlineApi.createScene(opts.chapterId, slug, s.title)
      if (s.markdown.trim()) {
        await api(`/api/scenes/${created.id}`, {
          method: 'PUT',
          body: JSON.stringify({ markdown: s.markdown, baseHash: created.contentHash }),
        })
      }
      createdIds.push(created.id)
    } catch (e) {
      console.error(`[applyGeneratedScenes] failed to create scene "${s.title}":`, e)
      failedTitles.push(s.title)
    }
  }
  opts.qc.invalidateQueries({ queryKey: ['outline', opts.projectId] })
  return { createdIds, failedTitles }
}
