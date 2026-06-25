import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles, FilePlus, BookPlus, Settings as SettingsIcon, Focus as FocusIcon, Camera, BookOpen, Globe, FileText, Wand2, Check, Save, ChevronDown, RotateCcw, Trash2, Pencil } from 'lucide-react'
import { api, ApiClientError } from '../../api/client.js'
import type { SceneDetailDto, AiSettingsDto, EntityStatus, ProjectDto, WorldCategory, ConflictType, ForeshadowStatus, CompletionMode } from '@novel/shared'
import { SceneEditor } from './SceneEditor.js'
import { SnapshotHistory } from './SnapshotHistory.js'
import { OutlineTree } from '../outline/OutlineTree.js'
import { outlineApi } from '../outline/api.js'
import { buildTree } from '../outline/tree-utils.js'
import { AiPanelSheet } from '../ai/AiPanel.js'
import { WorldPanel } from '../world/WorldPanel.js'
import { worldApi } from '../world/api.js'
import { formatAiOutput } from '../ai/format.js'
import { titleToSlug, splitChapterToScenes, type ParsedScene } from '../ai/sceneSplitter.js'
import { parseAiJson } from '../ai/jsonParse.js'
import { runAiCompletion } from '../ai/runAi.js'
import { draftsApi, type DraftDto } from '../ai/draftsApi.js'
import { useAiStream } from '../../hooks/useAiStream.js'
import { StoryArcGenerator } from './StoryArcGenerator.js'
import { useDebouncedSave } from '../../hooks/useDebouncedSave.js'
import { TopBar } from '@/components/topbar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { usePrompt } from '@/components/ui/prompt-dialog'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { SaveStatus, type SaveState } from './SaveStatus.js'
import { WordCounter } from './WordCounter.js'
import { ProjectStatsCard } from './ProjectStatsCard.js'

const STATUS_CYCLE: EntityStatus[] = ['draft', 'revising', 'done']

export function EditorPage() {
  const params = useParams()
  const projectId = Number(params.id)
  const [sceneId, setSceneId] = useState<number | undefined>()
  const [content, setContent] = useState('')
  const [baseHash, setBaseHash] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [storyArcOpen, setStoryArcOpen] = useState(false)
  const [editingStoryArc, setEditingStoryArc] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [recoverDraft, setRecoverDraft] = useState<DraftDto | undefined>(undefined)
  // AI stream state lives in EditorPage so it persists across panel open/close.
  const { state: aiState, start: aiStart, cancel: aiCancel, reset: aiReset, accept: aiAccept } = useAiStream({ persist: true })
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewText, setReviewText] = useState('')
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewKind, setReviewKind] = useState<'review' | 'extract'>('review')
  // The chapter the current review/extract is targeting. Distinct from the
  // currently-open scene: a user can trigger chapter review from the sidebar
  // while looking at a scene in a different chapter.
  const [reviewChapterId, setReviewChapterId] = useState<number | null>(null)
  // Snapshot of the scenes the review is *targeting* — locked at review time
  // so that applying the review after navigating to a different scene still
  // writes to the originally reviewed scenes.
  const [reviewTargets, setReviewTargets] = useState<Array<{ title: string; id: number }>>([])
  // Chapter currently selected in the outline (drives chapter-level AI actions).
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(null)
  const [applyProgress, setApplyProgress] = useState<{ current: number; total: number; sceneTitle: string } | null>(null)
  const [applyLoading, setApplyLoading] = useState(false)

  // Restore review state from localStorage on mount (persists across refresh)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`review-${projectId}-${reviewChapterId}`)
      if (saved) {
        const data = JSON.parse(saved)
        if (data.reviewText) setReviewText(data.reviewText)
        if (data.reviewKind) setReviewKind(data.reviewKind)
        if (data.reviewText) setReviewOpen(true)
      }
    } catch { /* ignore */ }
  }, [projectId, reviewChapterId])

  // Persist review state to localStorage when it changes
  useEffect(() => {
    if (reviewText && reviewChapterId) {
      try {
        localStorage.setItem(`review-${projectId}-${reviewChapterId}`, JSON.stringify({
          reviewText,
          reviewKind,
        }))
      } catch { /* ignore */ }
    }
  }, [reviewText, reviewKind, projectId, reviewChapterId])
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>(undefined)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)
  const [selectionText, setSelectionText] = useState<string | null>(null)
  const [sidebarTab, setSidebarTab] = useState<'outline' | 'world'>('outline')
  const qc = useQueryClient()
  const { toast } = useToast()
  const { prompt } = usePrompt()
  const { confirm } = useConfirm()

  const editorApiRef = useRef<{ setContentFromText: (text: string) => void } | null>(null)
  const handleEditorReady = useCallback((api: { setContentFromText: (text: string) => void }) => {
    editorApiRef.current = api
  }, [])

  const outline = useQuery({ queryKey: ['outline', projectId], queryFn: () => outlineApi.fetch(projectId), enabled: projectId > 0 })
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => api<ProjectDto>(`/api/projects/${projectId}`), enabled: projectId > 0 })
  const scene = useQuery({ queryKey: ['scene', sceneId], queryFn: () => api<SceneDetailDto>(`/api/scenes/${sceneId}`), enabled: sceneId !== undefined })
  const settings = useQuery({ queryKey: ['ai', projectId], queryFn: () => api<AiSettingsDto>(`/api/projects/${projectId}/ai-settings`), enabled: projectId > 0 })

  useEffect(() => {
    if (scene.data) {
      setContent(scene.data.markdown)
      setBaseHash(scene.data.contentHash)
      setSaveState('idle')
      // Check for any in-flight AI drafts when switching to a new scene.
      void draftsApi.listByScene(scene.data.id).then((drafts: DraftDto[]) => {
        const inflight = drafts.find((d: DraftDto) => d.status === 'streaming')
        setRecoverDraft(inflight)
      }).catch(() => setRecoverDraft(undefined))
    } else {
      setRecoverDraft(undefined)
    }
  }, [scene.data?.id])

  // When the user opens the AI panel, look for an in-flight draft for the
  // current scene so we can offer to resume from where they left off.
  const handleOpenAi = useCallback(async () => {
    // Always open immediately — don't block on the draft lookup.
    setAiOpen(true)
    if (sceneId !== undefined) {
      try {
        const drafts = await draftsApi.listByScene(sceneId)
        const inflight = drafts.find((d: DraftDto) => d.status === 'streaming')
        setRecoverDraft(inflight)
      } catch {
        setRecoverDraft(undefined)
      }
    } else {
      setRecoverDraft(undefined)
    }
  }, [sceneId])

  const focusModeRef = useRef(false)
  focusModeRef.current = focusMode
  const sceneIdRef = useRef<number | undefined>(sceneId)
  sceneIdRef.current = sceneId

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (sceneIdRef.current !== undefined) void handleOpenAi()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        setFocusMode((v) => !v)
      }
      if (e.key === 'Escape' && focusModeRef.current) {
        setFocusMode(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
  // Manual snapshot: POST /api/scenes/:id/snapshot
  const createSnapshot = useCallback(async () => {
    if (sceneId === undefined) return
    try {
      await api<{ hash: string }>(`/api/scenes/${sceneId}/snapshot`, { method: 'POST' })
      toast({ kind: 'success', title: '快照已创建' })
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : (e as Error).message
      toast({ kind: 'error', title: '快照失败', description: msg })
    }
  }, [sceneId, toast])

  // Three-option dialog for external modification (spec 6.4)
  const handleExternalChange = useCallback(
    async (localMd: string) => {
      const choice = await confirm({
        title: '外部修改检测',
        description: '磁盘上的草稿已被外部编辑器修改。请选择处理方式。',
        confirmLabel: '重新加载',
        cancelLabel: '强制保存',
        destructive: false,
      })
      if (choice) {
        // Reload from disk
        qc.invalidateQueries({ queryKey: ['scene', sceneId] })
        toast({ kind: 'info', title: '已重新加载' })
      } else {
        // Force save (overwrite external changes) — use server-side `force` to bypass baseHash guard.
        try {
          const r = await api<{ hash: string }>(`/api/scenes/${sceneId}`, {
            method: 'PUT',
            body: JSON.stringify({ markdown: localMd, baseHash, force: true }),
          })
          setBaseHash(r.hash)
          setSaveState('saved')
          setLastSavedAt(Date.now())
          toast({ kind: 'success', title: '已强制保存' })
        } catch (e2) {
          toast({ kind: 'error', title: '强制保存失败', description: (e2 as Error).message })
        }
      }
    },
    [sceneId, qc, confirm, toast],
  )

  const save = useCallback(
    async (md: string) => {
      if (sceneId === undefined) return
      setSaveState('saving')
      setSaveError(undefined)
      try {
        const r = await api<{ hash: string }>(`/api/scenes/${sceneId}`, {
          method: 'PUT',
          body: JSON.stringify({ markdown: md, baseHash }),
        })
        setBaseHash(r.hash)
        setSaveState('saved')
        setLastSavedAt(Date.now())
      } catch (e) {
        setSaveState('error')
        const msg = e instanceof ApiClientError ? e.message : (e as Error).message
        setSaveError(msg)
        if (e instanceof ApiClientError && e.code === 'external_change') {
          // Consume the externalHash so any subsequent debounce auto-save uses a fresh baseHash.
          const externalHash = (e.details as { externalHash?: string } | undefined)?.externalHash
          if (externalHash) setBaseHash(externalHash)
          handleExternalChange(md)
        }
      }
    },
    [sceneId, baseHash, qc, toast, handleExternalChange],
  )

  // Cmd+S = force save + manual snapshot (spec 6.3)
  const saveNow = useCallback(() => {
    void save(content).then(() => createSnapshot())
  }, [save, content, createSnapshot])

  // 5-minute hard snapshot timer (spec 6.3): skip if content matches the last
  // content we debounced-saved (or the last tick that produced a snapshot) —
  // the server uses INSERT OR IGNORE so duplicates are safe, but reducing
  // wasted requests is better for UX and server load.
  const lastContentRef = useRef(content)
  const lastSavedRef = useRef(content)
  const lastSnapshotTextRef = useRef('')
  useEffect(() => {
    lastContentRef.current = content
  }, [content])
  useEffect(() => {
    lastSavedRef.current = content
  }, [baseHash])

  useEffect(() => {
    if (sceneId === undefined) return
    const interval = setInterval(() => {
      const text = lastContentRef.current
      if (!text.trim()) return
      // Skip if content is unchanged from last snapshot tick or matches
      // the last successfully-saved version.
      if (text === lastSnapshotTextRef.current) return
      if (text === lastSavedRef.current) return
      lastSnapshotTextRef.current = text
      void api<{ hash: string }>(`/api/scenes/${sceneId}/snapshot`, { method: 'POST' }).catch(() => {})
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [sceneId])
  useDebouncedSave(content, save, 800)

  const addChapter = useMutation({
    mutationFn: async (volumeId: number) => {
      const result = await prompt({
        title: '新建章节',
        fields: [{ name: 'title', label: '章节标题', placeholder: '第二章', required: true }],
        submitLabel: '创建',
      })
      if (!result) return null
      const slug = 'ch-' + Date.now().toString(36)
      return outlineApi.createChapter(volumeId, slug, result.title ?? '')
    },
    onSuccess: (c) => {
      if (!c) return
      qc.invalidateQueries({ queryKey: ['outline', projectId] })
    },
  })

  const addScene = useMutation({
    mutationFn: async (chapterId: number) => {
      const result = await prompt({
        title: '新建场景',
        fields: [{ name: 'title', label: '场景标题', placeholder: '开场', required: true }],
        submitLabel: '创建',
      })
      if (!result) return null
      const slug = 'sc-' + Date.now().toString(36)
      return outlineApi.createScene(chapterId, slug, result.title ?? '')
    },
    onSuccess: (s) => {
      if (!s) return
      qc.invalidateQueries({ queryKey: ['outline', projectId] })
      setSceneId(s.id)
    },
  })
  const deleteScene = useMutation({
    mutationFn: (id: number) => outlineApi.deleteScene(id),
    onSuccess: (_result, id) => {
      qc.invalidateQueries({ queryKey: ['outline', projectId] })
      if (sceneId === id) setSceneId(undefined)
      toast({ kind: 'success', title: '场景已删除' })
    },
    onError: (err) => {
      toast({ kind: 'error', title: '删除失败', description: (err as Error).message })
    },
  })

  const handleDeleteScene = useCallback(
    async (id: number) => {
      const ok = await confirm({
        title: '删除场景？',
        description: '场景及其所有草稿与快照将被永久删除。',
        confirmLabel: '删除',
        destructive: true,
      })
      if (ok) deleteScene.mutate(id)
    },
    [confirm, deleteScene],
  )

  const deleteChapter = useMutation({
    mutationFn: (id: number) => outlineApi.deleteChapter(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outline', projectId] })
      toast({ kind: 'success', title: '章节已删除' })
    },
    onError: (err) => {
      toast({ kind: 'error', title: '删除失败', description: (err as Error).message })
    },
  })

  const handleDeleteChapter = useCallback(
    async (id: number) => {
      const ok = await confirm({
        title: '删除章节？',
        description: '章节下的所有场景将被一并删除。',
        confirmLabel: '删除',
        destructive: true,
      })
      if (ok) deleteChapter.mutate(id)
    },
    [confirm, deleteChapter],
  )

  const addVolume = useMutation({
    mutationFn: async () => {
      const result = await prompt({
        title: '新建卷',
        fields: [{ name: 'name', label: '卷名', placeholder: '第二卷', required: true }],
        submitLabel: '创建',
      })
      if (!result) return null
      const slug = 'vol-' + Date.now().toString(36)
      return outlineApi.createVolume(projectId, slug, result.name ?? '')
    },
    onSuccess: (v) => {
      if (!v) return
      qc.invalidateQueries({ queryKey: ['outline', projectId] })
    },
  })

  const cycleStatus = useMutation({
    mutationFn: (id: number) => {
      const s = outline.data?.scenes.find((x) => x.id === id)
      const cur = (s?.status ?? 'draft') as EntityStatus
      const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(cur) + 1) % STATUS_CYCLE.length]!
      return outlineApi.patchScene(id, { status: next })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['outline', projectId] }),
  })

  const outlineData = outline.data

  const renameScene = useCallback(
    async (id: number) => {
      const s = outlineData?.scenes.find((x) => x.id === id)
      if (!s) return
      const r = await prompt({
        title: '重命名场景',
        fields: [{ name: 'title', label: '场景标题', defaultValue: s.title, required: true }],
        submitLabel: '保存',
      })
      if (!r) return
      try {
        await outlineApi.patchScene(id, { title: r.title ?? s.title })
        qc.invalidateQueries({ queryKey: ['outline', projectId] })
        toast({ kind: 'success', title: '已重命名' })
      } catch (e) {
        toast({ kind: 'error', title: '重命名失败', description: (e as Error).message })
      }
    },
    [outlineData, prompt, qc, projectId, toast],
  )

  const renameChapter = useCallback(
    async (id: number) => {
      const c = outlineData?.chapters.find((x) => x.id === id)
      if (!c) return
      const r = await prompt({
        title: '重命名章节',
        fields: [{ name: 'title', label: '章节标题', defaultValue: c.title, required: true }],
        submitLabel: '保存',
      })
      if (!r) return
      try {
        await outlineApi.patchChapter(id, r.title ?? c.title)
        qc.invalidateQueries({ queryKey: ['outline', projectId] })
        toast({ kind: 'success', title: '已重命名' })
      } catch (e) {
        toast({ kind: 'error', title: '重命名失败', description: (e as Error).message })
      }
    },
    [outlineData, prompt, qc, projectId, toast],
  )

  const renameVolume = useCallback(
    async (id: number) => {
      const v = outlineData?.volumes.find((x) => x.id === id)
      if (!v) return
      const r = await prompt({
        title: '重命名卷',
        fields: [{ name: 'name', label: '卷名', defaultValue: v.name, required: true }],
        submitLabel: '保存',
      })
      if (!r) return
      try {
        await outlineApi.patchVolume(id, r.name ?? v.name)
        qc.invalidateQueries({ queryKey: ['outline', projectId] })
        toast({ kind: 'success', title: '已重命名' })
      } catch (e) {
        toast({ kind: 'error', title: '重命名失败', description: (e as Error).message })
      }
    },
    [outlineData, prompt, qc, projectId, toast],
  )

  const currentScene = useMemo(() => outlineData?.scenes.find((s) => s.id === sceneId), [outlineData, sceneId])
  const currentChapter = outlineData?.chapters.find((c) => c.id === currentScene?.chapterId)
  const currentVolume = outlineData?.volumes.find((v) => v.id === currentChapter?.volumeId)
  const totalScenes = outlineData?.scenes.length ?? 0

  const breadcrumbs = [
    ...(currentVolume ? [{ label: currentVolume.name }] : []),
    ...(currentChapter ? [{ label: currentChapter.title }] : []),
    ...(currentScene ? [{ label: currentScene.title }] : []),
  ]

  // Helper: run AI fetch. `sceneId` is optional — server uses projectId for
  // ai_settings lookup and only needs sceneId for modes that pull scene-
  // specific context (continue/polish/rewrite on the current scene).
  const runAiFetch = (mode: string, inputText: string, opts?: { sceneId?: number }) =>
    runAiCompletion({
      projectId,
      ...(opts?.sceneId !== undefined ? { sceneId: opts.sceneId } : sceneId !== undefined ? { sceneId } : {}),
      mode,
      model: settings.data?.model ?? 'gpt-4o-mini',
      inputText,
    })

  // Helper: read all scenes in a given chapter (by chapterId, not derived from current scene).
  const getChapterContent = async (chapterId: number) => {
    if (!outlineData) return null
    const chapterScenes = outlineData.scenes.filter((s) => s.chapterId === chapterId)
    let text = ''
    const titles: { title: string; id: number }[] = []
    for (const s of chapterScenes) {
      const d = await api<{ markdown: string; title: string }>(`/api/scenes/${s.id}`)
      text += `### ${d.title}\n\n${d.markdown}\n\n`
      titles.push({ title: d.title, id: s.id })
    }
    return { text, titles }
  }

  // Review/extract AI call. The targets (chapter scenes) are *snapshotted here* —
// subsequent scene navigation does NOT change what the review is targeting, so
// applying the review never accidentally writes to a scene the user is merely
// looking at when they click "Apply". Triggered exclusively from the
// outline sidebar, against an explicit chapterId.
  const runReview = useCallback(
    async (kind: 'review' | 'extract', chapterId: number) => {
      setReviewOpen(true)
      setReviewLoading(true)
      setReviewText('')
      setReviewKind(kind)
      setReviewChapterId(chapterId)
      setReviewTargets([])
      try {
        const ch = await getChapterContent(chapterId)
        if (!ch || ch.titles.length === 0) {
          toast({ kind: 'info', title: '该章节暂无内容', description: '请先在该章节下创建并填充场景。' })
          setReviewLoading(false)
          setReviewOpen(false)
          return
        }
        setReviewTargets(ch.titles)
        if (kind === 'review') {
          // Chapter-level review/extract: don't pass sceneId — server uses
          // projectId from the body for ai_settings, no scene JOIN needed.
          const text = await runAiFetch('auto_review', ch.text)
          setReviewText(text)
        } else {
          // Extract: run consistency_check only. The `voice` slot is kept in
          // the wrapper for backward compat with the parser below, but no
          // longer triggers a separate AI call — voice profiles are now
          // returned inside the consistency_check JSON as `voiceProfile`.
          const settingsText = await runAiFetch('consistency_check', ch.text)
          setReviewText(JSON.stringify({ settings: settingsText, voice: '' }))
        }
      } catch (e) {
        setReviewText('错误: ' + (e as Error).message)
      } finally {
        setReviewLoading(false)
      }
    },
    [runAiFetch, getChapterContent, toast],
  )

  // Auto-track which chapter is "selected" based on the currently-open scene.
  // This lets chapter-level buttons work without forcing the user to click a
  // chapter first.
  useEffect(() => {
    if (sceneId && outlineData) {
      const sc = outlineData.scenes.find((s) => s.id === sceneId)
      if (sc) setSelectedChapterId(sc.chapterId)
    }
  }, [sceneId, outlineData])

  // Sidebar triggers: just delegate to runReview with the explicit chapterId.
  const handleReviewChapter = useCallback(
    (chapterId: number) => {
      setSelectedChapterId(chapterId)
      void runReview('review', chapterId)
    },
    [runReview],
  )
  const handleExtractChapter = useCallback(
    (chapterId: number) => {
      setSelectedChapterId(chapterId)
      void runReview('extract', chapterId)
    },
    [runReview],
  )

  // Apply a finalized AI text result to the project — shared between the
  // "accept" button in the AI panel and the recovery banner for interrupted
  // drafts. The `scenes` arg is only meaningful for `generate_chapter` mode
  // (parsed scene list from the panel); the recovery path passes undefined
  // and falls through to the default editor-application branch, which is the
  // correct degraded behaviour for an interrupted chapter run.
  const applyAcceptedText = useCallback(
    async (
      rawText: string,
      mode: CompletionMode,
      scope: 'full' | 'selection' | 'chapter' | 'generate' = 'full',
      scenes?: ParsedScene[],
    ) => {
      const text = formatAiOutput(rawText)
      if (mode === 'plan_story_arc') {
        try {
          await api(`/api/projects/${projectId}/story-arc`, {
            method: 'PATCH',
            body: JSON.stringify({ storyArcNotes: rawText }),
          })
          qc.invalidateQueries({ queryKey: ['project', projectId] })
          toast({ kind: 'success', title: '故事弧线已保存到大纲笔记' })
        } catch (e) {
          toast({ kind: 'error', title: '保存失败', description: (e as Error).message })
        }
        return
      }
      if (mode === 'analyze_voice') {
        try {
          const sections = rawText.split(/##\s+/).filter(Boolean)
          const chars = await worldApi.listCharacters(projectId)
          let matched = 0
          for (const sec of sections) {
            const titleLine = sec.split('\n', 1)[0]?.trim()
            if (!titleLine) continue
            const existing = chars.find((c) => c.name === titleLine)
            if (existing) {
              await worldApi.updateCharacter(existing.id, { voiceProfile: sec })
              matched++
            }
          }
          qc.invalidateQueries({ queryKey: ['characters', projectId] })
          toast({ kind: 'success', title: `语音档案已保存${matched > 0 ? `，匹配 ${matched} 个人物` : ''}` })
        } catch (e) {
          toast({ kind: 'error', title: '保存失败', description: (e as Error).message })
        }
        return
      }
      if (mode === 'generate_chapter' && scenes && scenes.length > 0) {
        try {
          const cs = outlineData?.scenes.find((s) => s.id === sceneId)
          if (!cs) throw new Error('未找到当前章节')
          for (let i = 0; i < scenes.length; i++) {
            const s = scenes[i]!
            const slug = titleToSlug(s.title, i)
            const created = await outlineApi.createScene(cs.chapterId, slug, s.title)
            if (s.markdown.trim()) {
              await api(`/api/scenes/${created.id}`, {
                method: 'PUT',
                body: JSON.stringify({ markdown: s.markdown, baseHash: created.contentHash }),
              })
            }
          }
          qc.invalidateQueries({ queryKey: ['outline', projectId] })
          toast({ kind: 'success', title: `已创建 ${scenes.length} 个场景` })
        } catch (e) {
          toast({ kind: 'error', title: '创建场景失败', description: (e as Error).message })
        }
        return
      }
      // Default: apply text to editor
      if (editorApiRef.current) {
        if (mode === 'continue') {
          const merged = content.trimEnd() + '\n\n' + text
          editorApiRef.current.setContentFromText(merged)
        } else if (scope === 'selection' && selectionText) {
          const replaced = content.replace(selectionText, text)
          editorApiRef.current.setContentFromText(replaced)
        } else {
          editorApiRef.current.setContentFromText(text)
        }
      } else if (mode === 'continue') {
        setContent((c) => c.trimEnd() + '\n\n' + text)
      } else if (scope === 'selection' && selectionText) {
        setContent((c) => c.replace(selectionText, text))
      } else {
        setContent(text)
      }
    },
    [projectId, sceneId, content, selectionText, outlineData, qc, toast],
  )

  // Apply review: rewrites every snapshotted scene in the chapter with the
// review feedback; or (action === 'extract') parses settings JSON and writes
// to the world DB. Scene-level variants have been removed — only chapter
// review/extract remain, triggered from the outline sidebar.
  const applyReview = useCallback(
    async (action: 'replace_all' | 'extract') => {
      if (!reviewText) return
      setApplyLoading(true)
      setApplyProgress(null)
      try {
        if (action === 'replace_all') {
          if (reviewTargets.length === 0) return
          // Chapter-level review: re-run AI for each *snapshotted* scene with
          // the review feedback as context, then apply to each. The target
          // list is locked — switching chapters after the review does not
          // change what gets rewritten.
          let applied = 0
          const total = reviewTargets.length
          for (let i = 0; i < total; i++) {
            const sc = reviewTargets[i]!
            setApplyProgress({ current: i + 1, total, sceneTitle: sc.title })
            try {
              // Read current scene content
              const sceneData = await api<{ markdown: string; baseHash: string }>(`/api/scenes/${sc.id}`)
              const sceneText = sceneData.markdown
              // Ask AI to rewrite this scene incorporating the review feedback
              const rewritePrompt = `以下是对整个章节的审稿反馈，请根据反馈重写这个场景。只输出重写后的内容，不要输出任何解释。

[审稿反馈]
${reviewText}

[场景标题]
${sc.title}

[场景原文]
${sceneText}`
              const rewritten = await runAiFetch('rewrite', rewritePrompt, { sceneId: sc.id })
              const formatted = formatAiOutput(rewritten)
              // Save to server
              await api(`/api/scenes/${sc.id}`, {
                method: 'PUT',
                body: JSON.stringify({ markdown: formatted, baseHash: sceneData.baseHash, force: true }),
              })
              applied++
            } catch (e) {
              console.error(`Failed to apply review to scene ${sc.title}:`, e)
            }
          }
          setApplyProgress(null)
          qc.invalidateQueries({ queryKey: ['outline', projectId] })
          if (sceneId) qc.invalidateQueries({ queryKey: ['scene', sceneId] })
          toast({ kind: 'success', title: `审稿建议已应用到 ${applied} 个场景` })
        } else {
          // Extract: parse combined settings + voice result
          let savedCount = 0
          let settingsText = ''
          let voiceText = ''
          try {
            const combined = JSON.parse(reviewText)
            settingsText = combined.settings || ''
            voiceText = combined.voice || ''
          } catch {
            // Fallback: treat as plain settings text
            settingsText = reviewText
          }

          // Debug: show what we're trying to parse
          console.log('[Extract] settingsText length:', settingsText.length)
          console.log('[Extract] settingsText preview:', settingsText.slice(0, 200))

          // 1. Save settings (characters, world elements, timeline, conflicts)
          if (settingsText) {
            interface ExtractedData {
              characters?: Array<Record<string, unknown>>
              worldElements?: Array<Record<string, unknown>>
              timeline?: Array<Record<string, unknown>>
              conflicts?: Array<Record<string, unknown>>
              foreshadows?: Array<Record<string, unknown>>
            }
            const data = parseAiJson<ExtractedData>(settingsText)
            if (data) {
              const charCount = data.characters?.length ?? 0
              const worldCount = data.worldElements?.length ?? 0
              const timelineCount = data.timeline?.length ?? 0
              const conflictCount = data.conflicts?.length ?? 0
              const foreshadowCount = data.foreshadows?.length ?? 0
              const totalEntities = charCount + worldCount + timelineCount + conflictCount + foreshadowCount

              if (totalEntities === 0) {
                toast({
                  kind: 'info',
                  title: 'AI 未提取到设定',
                  description: '场景内容中未发现可提取的人物、世界观、时间线等信息。请尝试分析包含更多设定信息的场景。',
                })
                setApplyLoading(false)
                return
              }

              const str = (v: unknown, dflt = ''): string => (typeof v === 'string' ? v : dflt)
              const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
              for (const c of data.characters ?? []) {
                const name = str(c.name).trim() || '未命名'
                const existingChars = await worldApi.listCharacters(projectId)
                const existing = existingChars.find((e) => e.name === name)
                if (existing) {
                  const existingNotes = existing.notes || ''
                  const newNotes = str(c.notes)
                  const mergedNotes = existingNotes && newNotes ? existingNotes + '\n\n---\n\n' + newNotes : newNotes || existingNotes
                  const aliases = arr(c.aliases)
                  await worldApi.updateCharacter(existing.id, {
                    name,
                    aliases: aliases.length ? aliases : existing.aliases,
                    appearance: str(c.appearance) || existing.appearance,
                    personality: str(c.personality) || existing.personality,
                    background: str(c.background) || existing.background,
                    relationships: str(c.relationships) || existing.relationships,
                    voiceProfile: str(c.voiceProfile) || existing.voiceProfile,
                    notes: mergedNotes,
                  })
                } else {
                  await worldApi.createCharacter(projectId, {
                    name,
                    aliases: arr(c.aliases),
                    appearance: str(c.appearance),
                    personality: str(c.personality),
                    background: str(c.background),
                    relationships: str(c.relationships),
                    voiceProfile: str(c.voiceProfile),
                    notes: str(c.notes),
                  })
                }
                savedCount++
              }
              for (const w of data.worldElements ?? []) {
                const name = str(w.name).trim() || '未命名'
                const existingWorld = await worldApi.listWorldElements(projectId)
                const existing = existingWorld.find((e) => e.name === name)
                if (existing) {
                  const existingNotes = existing.notes || ''
                  const newNotes = str(w.notes)
                  const mergedNotes = existingNotes && newNotes ? existingNotes + '\n\n---\n\n' + newNotes : newNotes || existingNotes
                  await worldApi.updateWorldElement(existing.id, {
                    name,
                    category: (str(w.category) as WorldCategory) || existing.category,
                    description: str(w.description) || existing.description,
                    notes: mergedNotes,
                  })
                } else {
                  await worldApi.createWorldElement(projectId, {
                    name,
                    category: (str(w.category) || 'concept') as WorldCategory,
                    description: str(w.description),
                    notes: str(w.notes),
                  })
                }
                savedCount++
              }
              for (const t of data.timeline ?? []) {
                const title = str(t.title).trim() || '未命名'
                const existingTimeline = await worldApi.listTimeline(projectId)
                const existing = existingTimeline.find((e) => e.title === title)
                if (existing) {
                  const existingNotes = existing.notes || ''
                  const newNotes = str(t.notes)
                  const mergedNotes = existingNotes && newNotes ? existingNotes + '\n\n---\n\n' + newNotes : newNotes || existingNotes
                  await worldApi.updateTimelineEvent(existing.id, {
                    title,
                    era: str(t.era) || existing.era,
                    description: str(t.description) || existing.description,
                    notes: mergedNotes,
                  })
                } else {
                  await worldApi.createTimelineEvent(projectId, {
                    title,
                    era: str(t.era),
                    description: str(t.description),
                    notes: str(t.notes),
                  })
                }
                savedCount++
              }
              for (const c of data.conflicts ?? []) {
                const title = str(c.title).trim() || '未命名'
                const existingConflicts = await worldApi.listConflicts(projectId)
                const existing = existingConflicts.find((e) => e.title === title)
                if (existing) {
                  const existingNotes = existing.notes || ''
                  const newNotes = str(c.notes)
                  const mergedNotes = existingNotes && newNotes ? existingNotes + '\n\n---\n\n' + newNotes : newNotes || existingNotes
                  await worldApi.updateConflict(existing.id, {
                    title,
                    type: (str(c.type) as ConflictType) || existing.type,
                    description: str(c.description) || existing.description,
                    setup: str(c.setup) || existing.setup,
                    escalation: str(c.escalation) || existing.escalation,
                    climax: str(c.climax) || existing.climax,
                    resolution: str(c.resolution) || existing.resolution,
                    notes: mergedNotes,
                  })
                } else {
                  await worldApi.createConflict(projectId, {
                    title,
                    type: (str(c.type) || 'person_vs_person') as ConflictType,
                    description: str(c.description),
                    setup: str(c.setup),
                    escalation: str(c.escalation),
                    climax: str(c.climax),
                    resolution: str(c.resolution),
                    status: 'setup',
                    notes: str(c.notes),
                  })
                }
                savedCount++
              }
              for (const f of data.foreshadows ?? []) {
                const title = str(f.title).trim() || '未命名'
                const existingForeshadows = await worldApi.listForeshadows(projectId)
                const existing = existingForeshadows.find((e) => e.title === title)
                if (existing) {
                  const existingNotes = existing.notes || ''
                  const newNotes = str(f.notes)
                  const mergedNotes = existingNotes && newNotes ? existingNotes + '\n\n---\n\n' + newNotes : newNotes || existingNotes
                  await worldApi.updateForeshadow(existing.id, {
                    title,
                    description: str(f.description) || existing.description,
                    status: (str(f.status) as ForeshadowStatus) || existing.status,
                    notes: mergedNotes,
                  })
                } else {
                  await worldApi.createForeshadow(projectId, {
                    title,
                    description: str(f.description),
                    status: (str(f.status) || 'planted') as ForeshadowStatus,
                    notes: str(f.notes),
                  })
                }
                savedCount++
              }
            } else {
              toast({ kind: 'error', title: '未找到有效的设定 JSON', description: 'AI 输出中未检测到结构化数据' })
              setApplyLoading(false)
              return
            }
          }

          qc.invalidateQueries({ queryKey: ['characters', projectId] })
          qc.invalidateQueries({ queryKey: ['worldElements', projectId] })
          qc.invalidateQueries({ queryKey: ['timeline', projectId] })
          qc.invalidateQueries({ queryKey: ['conflicts', projectId] })
          qc.invalidateQueries({ queryKey: ['foreshadows', projectId] })
          if (savedCount > 0) {
            toast({ kind: 'success', title: `已保存 ${savedCount} 条设定到世界数据库` })
          } else if (!settingsText) {
            toast({ kind: 'error', title: '提取失败', description: 'AI 未返回有效的设定数据，请重试' })
          } else {
            // savedCount === 0 but settingsText exists: JSON parse succeeded but all arrays were empty
            toast({
              kind: 'info',
              title: '未发现可提取的设定',
              description: 'AI 分析了场景但未发现新人物、世界观、时间线等信息。场景内容可能较简单。',
            })
          }
        }
      } catch (e) {
        toast({ kind: 'error', title: '应用失败', description: (e as Error).message })
      } finally {
        setApplyLoading(false)
      }
    },
    [reviewText, sceneId, projectId, qc, toast],
  )

  if (!projectId) return <div className="p-8 text-muted-foreground">Loading…</div>

  return (
    <div className="flex h-screen flex-col bg-background">
      <TopBar breadcrumbs={breadcrumbs} projectId={projectId} />

      <div className="flex flex-1 overflow-hidden">
        {!focusMode && (
          <aside className="w-72 shrink-0 overflow-hidden border-r bg-sidebar-background">
          {project.data && <ProjectStatsCard projectId={projectId} projectName={project.data.name} projectSlug={project.data.slug} />}
          <div className="flex border-b">
            <button onClick={() => setSidebarTab('outline')} className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${sidebarTab === 'outline' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}><BookOpen className="h-3.5 w-3.5" /> 大纲</button>
            <button onClick={() => setSidebarTab('world')} className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${sidebarTab === 'world' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}><SettingsIcon className="h-3.5 w-3.5" /> 设定</button>
          </div>
          {sidebarTab === 'outline' ? (
            <>
              <div className="flex h-9 items-center justify-between px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><span>大纲</span><span className="font-mono normal-case">{totalScenes}</span></div>
              {!project.data?.storyArcNotes && (
                <div className="px-2 pb-1"><Button variant="ghost" size="sm" className="w-full justify-start gap-1.5 text-xs text-muted-foreground" onClick={() => setStoryArcOpen(true)}><Sparkles className="h-3 w-3" /> 生成故事弧线笔记</Button></div>
              )}
              {project.data?.storyArcNotes && (
                <div className="mx-2 mb-2">
                  <details className="group rounded-lg border bg-muted/20 text-xs">
                    <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 font-semibold text-foreground select-none">
                      <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-90" /> 故事弧线笔记
                    </summary>
                    <div className="max-h-48 overflow-y-auto border-t px-3 py-2">
                      <pre className="whitespace-pre-wrap leading-relaxed text-muted-foreground">{project.data.storyArcNotes}</pre>
                    </div>
                    <div className="flex gap-1 border-t px-3 py-1.5">
                      <Button variant="ghost" size="sm" className="h-6 flex-1 text-[10px] text-muted-foreground" onClick={() => setStoryArcOpen(true)}>
                        <RotateCcw className="mr-1 h-2.5 w-2.5" /> 重新生成
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 flex-1 text-[10px] text-muted-foreground" onClick={() => setEditingStoryArc(true)}>
                        <Pencil className="mr-1 h-2.5 w-2.5" /> 编辑
                      </Button>
                    </div>
                  </details>
                </div>
              )}
              {editingStoryArc && (
                <div className="mx-2 mb-2 space-y-1.5">
                  <Textarea
                    defaultValue={project.data?.storyArcNotes ?? ''}
                    rows={8}
                    className="text-xs font-mono"
                    id="story-arc-edit"
                  />
                  <div className="flex gap-1">
                    <Button size="sm" className="h-6 flex-1 text-[10px]" onClick={async () => {
                      const el = document.getElementById('story-arc-edit') as HTMLTextAreaElement
                      if (!el) return
                      try {
                        await api(`/api/projects/${projectId}/story-arc`, { method: 'PATCH', body: JSON.stringify({ storyArcNotes: el.value }) })
                        qc.invalidateQueries({ queryKey: ['project', projectId] })
                        setEditingStoryArc(false)
                        toast({ kind: 'success', title: '已保存' })
                      } catch (e) { toast({ kind: 'error', title: '保存失败', description: (e as Error).message }) }
                    }}>
                      <Check className="mr-1 h-2.5 w-2.5" /> 保存
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 flex-1 text-[10px]" onClick={() => setEditingStoryArc(false)}>
                      取消
                    </Button>
                  </div>
                </div>
              )}
              {outlineData ? (
                <OutlineTree
                  nodes={buildTree(outlineData.volumes, outlineData.chapters, outlineData.scenes)}
                  currentSceneId={sceneId}
                  selectedChapterId={selectedChapterId ?? undefined}
                  onSelectScene={setSceneId}
                  onSelectChapter={setSelectedChapterId}
                  onAddVolume={() => addVolume.mutate()}
                  onAddChapter={(volumeId) => addChapter.mutate(volumeId)}
                  onAddScene={(chapterId) => addScene.mutate(chapterId)}
                  onCycleStatus={(id) => cycleStatus.mutate(id)}
                  onDeleteScene={handleDeleteScene}
                  onDeleteChapter={handleDeleteChapter}
                  onRenameScene={(id) => renameScene(id)}
                  onRenameChapter={(id) => renameChapter(id)}
                  onRenameVolume={(id) => renameVolume(id)}
                  onReviewChapter={handleReviewChapter}
                  onExtractChapter={handleExtractChapter}
                />
              ) : (
                <div className="p-4 text-sm text-muted-foreground">读取大纲中…</div>
              )}
            </>
          ) : (
            <WorldPanel projectId={projectId} model={settings.data?.model ?? 'gpt-4o-mini'} />
          )}
        </aside>
        )}


        <main className="relative flex flex-1 flex-col overflow-hidden">
          {sceneId ? (
            <>
              {!focusMode && (
              <div className="flex h-10 shrink-0 items-center gap-3 border-b px-6">
                <SaveStatus state={saveState} lastSavedAt={lastSavedAt} errorMessage={saveError} />
                <div className="flex-1" />
                <WordCounter
                  text={content}
                  targetWords={scene.data?.targetWords ?? null}
                  hideWhenEmpty
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={createSnapshot}
                  aria-label="创建快照"
                  title="创建快照"
                >
                  <Camera className="h-3.5 w-3.5" />
                </Button>
                {sceneId && (
                  <SnapshotHistory
                    sceneId={sceneId}
                    onRestore={(markdown, hash) => {
                      if (editorApiRef.current) {
                        editorApiRef.current.setContentFromText(markdown)
                      } else {
                        setContent(markdown)
                      }
                      if (hash) setBaseHash(hash)
                    }}
                  />
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => setFocusMode(true)}
                  aria-label="专注模式 (⌘↵)"
                  title="专注模式 (⌘↵)"
                >
                  <FocusIcon className="h-3.5 w-3.5" />
                </Button>
              </div>
              )}
              {focusMode && (
                <button
                  type="button"
                  onClick={() => setFocusMode(false)}
                  className="absolute right-4 top-3 z-10 rounded-md border bg-background/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur transition-colors hover:bg-accent"
                  aria-label="退出专注模式 (Esc)"
                  title="退出专注模式 (Esc)"
                >
                  退出专注 · Esc
                </button>
              )}
              <div className="relative flex-1 overflow-auto">
                <SceneEditor
                  initialMarkdown={content}
                  onChangeMarkdown={setContent}
                  onSelectionText={setSelectionText}
                  onForceSave={saveNow}
                  onEditorReady={handleEditorReady}
                  focusMode={focusMode}
                />
              </div>

              {/* Floating AI button (chapter-level review/extract moved to outline sidebar) */}
              <div className="fixed bottom-6 right-6 z-50 flex flex-col items-center gap-2">
                <Button
                  onClick={() => void handleOpenAi()}
                  className="relative h-11 w-11 rounded-full shadow-lg"
                  size="icon"
                >
                  <Sparkles className="h-4 w-4" />
                  {/* Pulsing indicator when AI is streaming in background */}
                  {aiState.status === 'streaming' && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
                    </span>
                  )}
                  <span className="sr-only">AI 助手</span>
                </Button>
              </div>

              {/* Review panel moved out of {sceneId &&} below — see sibling block */}
            </>
          ) : (
            <EmptyState
              onAddScene={
                outlineData && outlineData.chapters.length > 0
                  ? () => addScene.mutate(outlineData.chapters[0]!.id)
                  : undefined
              }
              onAddChapter={
                outlineData && outlineData.volumes.length > 0
                  ? () => addChapter.mutate(outlineData.volumes[0]!.id)
                  : undefined
              }
              onStoryArc={() => setStoryArcOpen(true)}
            />
          )}

          {/* Review panel — lives OUTSIDE {sceneId &&} so chapter-level
              review/extract (triggered from the outline sidebar) works even
              when the user hasn't opened any scene. */}
          {reviewOpen && (
            <div className="fixed bottom-24 right-6 z-40 w-80 max-h-96 overflow-hidden rounded-xl border bg-background shadow-2xl">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-foreground">
                    {reviewKind === 'review' ? '📖 审稿建议' : '🔍 设定提取'}
                  </span>
                </div>
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  onClick={() => { setReviewOpen(false); setApplyProgress(null) }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto p-3">
                {reviewLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    AI 正在分析…
                  </div>
                ) : reviewKind === 'extract' ? (
                  <div className="space-y-3">
                    {(() => {
                      try {
                        const combined = JSON.parse(reviewText)
                        return (
                          <>
                            {combined.settings && (
                              <div>
                                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">设定提取</div>
                                <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{combined.settings}</pre>
                              </div>
                            )}
                            {combined.voice && (
                              <div>
                                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">语音档案</div>
                                <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{combined.voice}</pre>
                              </div>
                            )}
                          </>
                        )
                      } catch {
                        return <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{reviewText}</pre>
                      }
                    })()}
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{reviewText}</pre>
                )}
              </div>
              {!reviewLoading && reviewText && (
                <div className="flex flex-col gap-2 border-t px-3 py-2">
                  {/* Progress bar when applying chapter review */}
                  {applyProgress && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <div className="h-2 w-2 animate-spin rounded-full border border-primary border-t-transparent" />
                          正在重写: {applyProgress.sceneTitle}
                        </span>
                        <span className="font-mono tabular-nums">{applyProgress.current}/{applyProgress.total}</span>
                      </div>
                      <div className="h-1 w-full overflow-hidden rounded-full bg-background">
                        <div
                          className="h-full bg-primary transition-all duration-300"
                          style={{ width: `${(applyProgress.current / applyProgress.total) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2">
                    {reviewKind === 'review' ? (
                      <Button
                        size="sm"
                        className="flex-1 text-xs"
                        disabled={applyLoading}
                        onClick={() => applyReview('replace_all')}
                      >
                        <Check className="mr-1 h-3 w-3" />
                        {applyLoading ? '应用中...' : `应用到整个章节 (${reviewTargets.length} 个场景)`}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="flex-1 text-xs"
                        disabled={applyLoading}
                        onClick={() => applyReview('extract')}
                      >
                        <Check className="mr-1 h-3 w-3" />
                        保存到设定
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {sceneId && (
            <>
              {/* Show recovery panel if there's an in-flight draft for this scene.
              Lets the user read the already-generated text, accept it
              (applies via the same code path as the AI panel's accept
              button), discard it, or — only on explicit choice — open the
              AI panel to start a brand-new generation. */}
              {recoverDraft && !aiOpen && (
                <div className="fixed bottom-24 right-6 z-40 flex w-[28rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
                  <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
                    <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                    <span className="font-semibold text-foreground">AI 生成中断</span>
                    <span className="flex-1 truncate text-muted-foreground">
                      {recoverDraft.mode === 'continue' ? '续写' :
                       recoverDraft.mode === 'polish' ? '润色' :
                       recoverDraft.mode === 'rewrite' ? '重写' :
                       recoverDraft.mode === 'expand' ? '扩写' :
                       recoverDraft.mode === 'condense' ? '压缩' :
                       recoverDraft.mode === 'generate_chapter' ? '生成章节' :
                       recoverDraft.mode === 'generate_scene' ? '生成场景' :
                       recoverDraft.mode === 'consistency_check' ? '一致性检查' :
                       recoverDraft.mode === 'auto_review' ? '审稿' :
                       recoverDraft.mode === 'plan_story_arc' ? '故事弧线' :
                       recoverDraft.mode === 'analyze_voice' ? '语音档案' :
                       recoverDraft.mode}
                    </span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-muted-foreground">
                      {recoverDraft.status === 'streaming' ? '中断' : recoverDraft.status}
                    </span>
                    <button
                      type="button"
                      onClick={() => setRecoverDraft(undefined)}
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                      title="关闭（保留草稿，下次回来还能恢复）"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto px-3 py-2 text-xs leading-relaxed">
                    {recoverDraft.text ? (
                      <pre className="whitespace-pre-wrap font-sans text-foreground">{recoverDraft.text}</pre>
                    ) : (
                      <div className="text-muted-foreground">（还没有生成任何文本）</div>
                    )}
                  </div>
                  <div className="flex gap-2 border-t px-3 py-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={async () => {
                        await draftsApi.remove(recoverDraft.id)
                        setRecoverDraft(undefined)
                      }}
                    >
                      <Trash2 className="mr-1 h-3 w-3" /> 丢弃
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => void handleOpenAi()}
                      title="打开 AI 面板开始新一轮生成（不会恢复已生成文本）"
                    >
                      <Wand2 className="mr-1 h-3 w-3" /> 重新生成
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 text-xs"
                      disabled={!recoverDraft.text}
                      onClick={async () => {
                        const mode = recoverDraft.mode as CompletionMode
                        await applyAcceptedText(recoverDraft.text, mode)
                        await draftsApi.remove(recoverDraft.id).catch(() => {})
                        setRecoverDraft(undefined)
                        setAiOpen(false)
                        if (mode !== 'plan_story_arc' && mode !== 'analyze_voice' && mode !== 'generate_chapter') {
                          toast({ kind: 'success', title: '已接受已生成内容' })
                        }
                      }}
                    >
                      <Check className="mr-1 h-3 w-3" /> 接受（{recoverDraft.text.length} 字）
                    </Button>
                  </div>
                </div>
              )}

              <AiPanelSheet
                open={aiOpen}
                onOpenChange={(v) => {
                  if (!v) setRecoverDraft(undefined)
                  setAiOpen(v)
                }}
                projectId={projectId}
                sceneId={sceneId}
                model={settings.data?.model ?? 'gpt-4o-mini'}
                inputText={content}
                selection={selectionText}
                recoverFromDraft={recoverDraft}
                aiState={aiState}
                aiStart={aiStart}
                aiCancel={aiCancel}
                aiReset={aiReset}
                aiAccept={aiAccept}
              onAccept={async (rawText, mode, scope, scenes) => {
                await applyAcceptedText(rawText, mode, scope, scenes)
                setAiOpen(false)
                // Generate-mode and generate-chapter-mode flows already
                // show their own success toasts inside applyAcceptedText.
                // For the default editor-application path, surface a toast
                // so the user gets explicit feedback.
                if (mode !== 'plan_story_arc' && mode !== 'analyze_voice' && mode !== 'generate_chapter') {
                  toast({ kind: 'success', title: '已应用到编辑器' })
                }
              }}
            />
            </>
          )}
        </main>
      </div>

      {storyArcOpen && (
        <StoryArcGenerator
          open={storyArcOpen}
          onOpenChange={setStoryArcOpen}
          projectId={projectId}
          model={settings.data?.model ?? 'gpt-4o-mini'}
        />
      )}
    </div>
  )
}

function EmptyState({
  onAddScene,
  onAddChapter,
  onStoryArc,
}: {
  onAddScene?: (() => void) | undefined
  onAddChapter?: (() => void) | undefined
  onStoryArc?: () => void
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <Card className="w-full max-w-md border-dashed bg-muted/30">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="rounded-full bg-primary/10 p-3 text-primary">
            <FilePlus className="h-5 w-5" />
          </div>
          <h2 className="text-base font-semibold">还没有场景</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            从大纲新建场景，或在左侧选择一个已有的场景开始写作。
          </p>
          <div className="mt-2 flex gap-2">
            {onAddScene && (
              <Button size="sm" onClick={onAddScene}>
                <FilePlus className="h-3.5 w-3.5" /> 新建场景
              </Button>
            )}
            {onAddChapter && (
              <Button size="sm" variant="outline" onClick={onAddChapter}>
                <BookPlus className="h-3.5 w-3.5" /> 新建章节
              </Button>
            )}
            {onStoryArc && (
              <Button size="sm" variant="outline" onClick={onStoryArc}>
                <Sparkles className="h-3.5 w-3.5" /> 生成故事弧线
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
