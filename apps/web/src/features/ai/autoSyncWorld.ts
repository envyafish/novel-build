/**
 * Auto world-sync: after AI generates a scene, runs consistency check
 * in the background and saves extracted entities to the world database.
 */

import { worldApi } from '../world/api.js'
import { consumeNdjson } from '../../api/stream.js'

interface ConsistencyData {
  report?: string
  characters?: Array<{ name: string; aliases?: string[]; appearance?: string; personality?: string; background?: string; relationships?: string }>
  worldElements?: Array<{ name: string; category?: string; description?: string }>
  timeline?: Array<{ title: string; era?: string; description?: string }>
  foreshadows?: Array<{ title: string; description?: string; status?: string }>
  conflicts?: Array<{ title: string; type?: string; description?: string; setup?: string; escalation?: string; climax?: string; resolution?: string }>
}

export async function autoSyncWorld(
  projectId: number,
  sceneId: number,
  sceneContent: string,
  sceneTitle: string,
  model: string,
): Promise<string | null> {
  try {
    // Run consistency check in background
    const res = await fetch('/api/ai/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sceneId,
        mode: 'consistency_check',
        model,
        inputText: `请分析以下场景内容，提取其中的人物、世界观设定、时间线、伏笔和冲突信息。\n\n## 场景标题\n${sceneTitle}\n\n## 场景内容\n${sceneContent}`,
      }),
    })

    if (!res.ok) return null

    let fullText = ''
    const signal = AbortSignal.timeout(60000) // 60s max
    for await (const e of consumeNdjson(res, signal)) {
      if (e.kind === 'delta') fullText += e.delta
      if (e.kind === 'error') return null
    }

    if (!fullText) return null

    // Parse JSON from AI output
    const jsonMatch = fullText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const data: ConsistencyData = JSON.parse(jsonMatch[0])

    // Get existing entities to avoid duplicates
    const existingChars = await worldApi.listCharacters(projectId)
    const existingWorlds = await worldApi.listWorldElements(projectId)
    const existingTimelines = await worldApi.listTimeline(projectId)
    const existingForeshadows = await worldApi.listForeshadows(projectId)
    const existingConflicts = await worldApi.listConflicts(projectId)

    const existingCharNames = new Set(existingChars.map((c) => c.name))
    const existingWorldNames = new Set(existingWorlds.map((w) => w.name))
    const existingTimelineTitles = new Set(existingTimelines.map((t) => t.title))
    const existingForeshadowTitles = new Set(existingForeshadows.map((f) => f.title))
    const existingConflictTitles = new Set(existingConflicts.map((c) => c.title))

    let saved = 0

    // Save new characters (skip duplicates)
    if (data.characters) {
      for (const c of data.characters) {
        if (c.name && !existingCharNames.has(c.name)) {
          await worldApi.createCharacter(projectId, {
            name: c.name,
            aliases: c.aliases || [],
            appearance: c.appearance || '',
            personality: c.personality || '',
            background: c.background || '',
            relationships: c.relationships || '',
            notes: '',
          })
          saved++
        }
      }
    }

    // Save new world elements
    if (data.worldElements) {
      for (const w of data.worldElements) {
        if (w.name && !existingWorldNames.has(w.name)) {
          await worldApi.createWorldElement(projectId, {
            name: w.name,
            category: (w.category || 'concept') as any,
            description: w.description || '',
            notes: '',
          })
          saved++
        }
      }
    }

    // Save new timeline events
    if (data.timeline) {
      for (const t of data.timeline) {
        if (t.title && !existingTimelineTitles.has(t.title)) {
          await worldApi.createTimelineEvent(projectId, {
            title: t.title,
            era: t.era || '',
            description: t.description || '',
            notes: '',
          })
          saved++
        }
      }
    }

    // Save new foreshadows
    if (data.foreshadows) {
      for (const f of data.foreshadows) {
        if (f.title && !existingForeshadowTitles.has(f.title)) {
          await worldApi.createForeshadow(projectId, {
            title: f.title,
            description: f.description || '',
            status: (f.status || 'planted') as any,
            notes: '',
          })
          saved++
        }
      }
    }

    // Save new conflicts
    if (data.conflicts) {
      for (const c of data.conflicts) {
        if (c.title && !existingConflictTitles.has(c.title)) {
          await worldApi.createConflict(projectId, {
            title: c.title,
            type: (c.type || 'person_vs_person') as any,
            description: c.description || '',
            setup: c.setup || '',
            escalation: c.escalation || '',
            climax: c.climax || '',
            resolution: c.resolution || '',
            status: 'setup' as any,
            notes: '',
          })
          saved++
        }
      }
    }

    if (saved > 0) {
      return `已自动同步 ${saved} 个实体到世界观`
    }
    return null
  } catch {
    // Silent fail — auto-sync is best-effort
    return null
  }
}
