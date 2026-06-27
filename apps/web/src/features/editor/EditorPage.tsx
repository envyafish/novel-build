import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles, FilePlus, BookPlus, Settings as SettingsIcon, Focus as FocusIcon, Camera, BookOpen, Check, ChevronDown, RotateCcw, Pencil, X } from 'lucide-react'
import { api, ApiClientError } from '../../api/client.js'
import type { SceneDetailDto, AiSettingsDto, EntityStatus, ProjectDto, WorldCategory, ConflictType, ForeshadowStatus, CompletionMode } from '@novel/shared'
import { SceneEditor } from './SceneEditor.js'
import { SnapshotHistory } from './SnapshotHistory.js'
import { OutlineTree, type OutlineHandlers } from '../outline/OutlineTree.js'
import { outlineApi } from '../outline/api.js'
import { buildTree } from '../outline/tree-utils.js'
import { AiSidebar } from '../ai/AiPanel.js'
import { GenerateScenesDialog } from '../ai/GenerateScenesDialog.js'
import { WorldPanel } from '../world/WorldPanel.js'
import { worldApi } from '../world/api.js'
import { formatAiOutput } from '../ai/format.js'
import { type ParsedScene } from '../ai/sceneSplitter.js'
import { parseAiJson } from '@novel/shared'
import { runAiCompletion } from '../ai/runAi.js'
import { applyGeneratedScenes } from '../ai/sceneBatchCreate.js'
import { useAiStream } from '../../hooks/useAiStream.js'
import { StoryArcGenerator } from './StoryArcGenerator.js'
import { useDebouncedSave } from '../../hooks/useDebouncedSave.js'
import { useResizable, RESIZABLE_PARENT_ATTR } from '../../hooks/useResizable.js'
import { TopBar } from '@/components/topbar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { usePrompt } from '@/components/ui/prompt-dialog'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { useErrorToast } from '../../hooks/useErrorToast.js'
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
  const [storyArcOpen, setStoryArcOpen] = useState(false)
  const [editingStoryArc, setEditingStoryArc] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  // AI stream state lives in EditorPage so it persists across panel open/close.
  const { state: aiState, start: aiStart, cancel: aiCancel, reset: aiReset, accept: aiAccept } = useAiStream()
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

  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>(undefined)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)
  const [selectionText, setSelectionText] = useState<string | null>(null)
  const [sidebarTab, setSidebarTab] = useState<'outline' | 'world'>('outline')
  const qc = useQueryClient()
  const { toast } = useToast()
  const { showError } = useErrorToast()
  const { prompt } = usePrompt()
  const { confirm } = useConfirm()

  const editorApiRef = useRef<{
    setContentFromText: (text: string) => void
    replaceSelectionWithText: (text: string) => boolean
  } | null>(null)
  const handleEditorReady = useCallback(
    (api: {
      setContentFromText: (text: string) => void
      replaceSelectionWithText: (text: string) => boolean
    }) => {
      editorApiRef.current = api
    },
    [],
  )

  const outline = useQuery({ queryKey: ['outline', projectId], queryFn: () => outlineApi.fetch(projectId), enabled: projectId > 0 })
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => api<ProjectDto>(`/api/projects/${projectId}`), enabled: projectId > 0 })
  const scene = useQuery({ queryKey: ['scene', sceneId], queryFn: () => api<SceneDetailDto>(`/api/scenes/${sceneId}`), enabled: sceneId !== undefined })
  const settings = useQuery({ queryKey: ['ai', projectId], queryFn: () => api<AiSettingsDto>(`/api/projects/${projectId}/ai-settings`), enabled: projectId > 0 })

  useEffect(() => {
    if (scene.data) {
      setContent(scene.data.markdown)
      setBaseHash(scene.data.contentHash)
      setSaveState('idle')
    }
  }, [scene.data?.id])

    // Ref used by the keyboard handler below — keeping this up to date outside
  // the effect means the handler closure always reads fresh values without
  // re-binding on every render.
  const focusModeRef = useRef(false)
  focusModeRef.current = focusMode

  /**
   * AbortController for the review/extract request. We keep it on a ref so
   * the user can cancel an in-flight run (the panel renders a "取消" button
   * while loading) and so we can tear it down when the panel closes.
   *
   * The `reviewBlock` flag is the "blocking" state — while true, the rest of
   * the page (outline sidebar, top bar, AI sidebar) is rendered inert via a
   * non-interactive overlay so the user can't start a second review/extract
   * or navigate away from the chapter being processed. They can still close
   * the panel by clicking the X or hitting the cancel button, both of which
   * abort the request.
   */
  const reviewAbortRef = useRef<AbortController | null>(null)
  const [reviewBlock, setReviewBlock] = useState(false)

  // Reset the AI sidebar's stream when the user switches to a different scene —
  // otherwise the panel would keep showing the previous scene's generated text
  // and accept-button label, which is confusing.
  useEffect(() => {
    aiReset()
  }, [scene.data?.id, aiReset])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
      showError(e, '快照失败')
    }
  }, [sceneId, toast])

  // Three-option dialog for external modification (spec 6.4)
  // Both localMd and targetSceneId are captured at the 422-error site so that
  // if the user switches scenes while the confirm dialog is open, the force-save
  // still writes to the correct scene with the correct content.
  const handleExternalChange = useCallback(
    async (localMd: string, targetSceneId: number) => {
      const choice = await confirm({
        title: '外部修改检测',
        description: '磁盘上的草稿已被外部编辑器修改。请选择处理方式。',
        confirmLabel: '重新加载',
        cancelLabel: '强制保存',
        destructive: false,
      })
      if (choice) {
        // Reload from disk
        qc.invalidateQueries({ queryKey: ['scene', targetSceneId] })
        toast({ kind: 'info', title: '已重新加载' })
      } else {
        // Force save (overwrite external changes) — use server-side `force` to bypass baseHash guard.
        try {
          const r = await api<{ hash: string }>(`/api/scenes/${targetSceneId}`, {
            method: 'PUT',
            body: JSON.stringify({ markdown: localMd, baseHash, force: true }),
          })
          setBaseHash(r.hash)
          setSaveState('saved')
          setLastSavedAt(Date.now())
          toast({ kind: 'success', title: '已强制保存' })
        } catch (e2) {
          showError(e2, '强制保存失败')
        }
      }
    },
    [baseHash, qc, confirm, toast],
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
          // Capture sceneId at the error site — if the user switches scenes while
          // the confirm dialog is open, the force-save still targets the correct scene.
          handleExternalChange(md, sceneId)
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
  const debouncedSave = useDebouncedSave(content, save, 800)
  // Resizable sidebars — width persists to localStorage so the user's
  // layout sticks across sessions. Min/max guard against squeezing the
  // main editor area to nothing.
  const leftSidebar = useResizable({
    storageKey: 'novel-build.left-sidebar-width',
    defaultWidth: 288, // w-72
    min: 200,
    side: 'right',
  })
  const rightSidebar = useResizable({
    storageKey: 'novel-build.right-sidebar-width',
    defaultWidth: 320, // w-80
    min: 240,
    side: 'left',
  })
  // Scene-switch safety: when the user navigates to a different scene, any
  // pending debounced save for the *previous* scene must not fire after the
  // switch (it would race the new scene's baseHash and trigger a 422).
  //
  // Instead of dropping the pending write silently, we force-save the
  // previous scene's content here. `force: true` bypasses the baseHash
  // guard — safe because we're writing the user's own edits, not
  // overwriting external changes. The force-save is fire-and-forget:
  // when the user switches back to this scene, the scene-data query will
  // return the freshly-saved content.
  const lastSceneIdRef = useRef<number | undefined>(sceneId)
  useEffect(() => {
    if (lastSceneIdRef.current !== sceneId) {
      const prevId = lastSceneIdRef.current
      debouncedSave.cancel()
      // Force-save whatever content we have for the previous scene.
      // At this point in the render cycle `content` is still the old
      // scene's text (the new scene's data hasn't arrived from the
      // server yet), so we write the correct body to the correct id.
      if (prevId !== undefined && content.trim()) {
        void api(`/api/scenes/${prevId}`, {
          method: 'PUT',
          body: JSON.stringify({ markdown: content, baseHash, force: true }),
        }).catch(() => {})
      }
      lastSceneIdRef.current = sceneId
    }
  }, [sceneId, debouncedSave])

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

  // "Add scene" no longer uses the simple single-field prompt — it now opens
  // the GenerateScenesDialog so the user can choose between a single manual
  // scene and AI-assisted batch generation. The dialog drives all createScene
  // calls itself; we just track which chapter to insert into + its title
  // (shown in the dialog as the "AI will read the tail of…" hint).
  const [addSceneOpen, setAddSceneOpen] = useState(false)
  const [addSceneChapterId, setAddSceneChapterId] = useState<number | null>(null)
  const [addSceneChapterTitle, setAddSceneChapterTitle] = useState('')

  const handleAddScene = useCallback((chapterId: number) => {
    // Look up the chapter title from the cached query so the dialog can show
    // "AI will read the tail of «chapter-title»". Fall back to a generic
    // label if the query hasn't loaded yet (chapter will be in outline by
    // the time the dialog is actually rendered, but TS can't prove that
    // across this closure).
    const ch = outline.data?.chapters.find((c) => c.id === chapterId)
    setAddSceneChapterId(chapterId)
    setAddSceneChapterTitle(ch?.title ?? '当前章节')
    setAddSceneOpen(true)
  }, [outline.data])

  const deleteScene = useMutation({
    mutationFn: (id: number) => outlineApi.deleteScene(id),
    onSuccess: (_result, id) => {
      qc.invalidateQueries({ queryKey: ['outline', projectId] })
      if (sceneId === id) setSceneId(undefined)
      toast({ kind: 'success', title: '场景已删除' })
    },
    onError: (err) => {
      showError(err, '删除失败')
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
      showError(err, '删除失败')
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
        showError(e, '重命名失败')
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
        showError(e, '重命名失败')
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
        showError(e, '重命名失败')
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
  const runAiFetch = useCallback(
    (mode: string, inputText: string, opts?: { sceneId?: number; signal?: AbortSignal; includePrevChapterTail?: boolean }) =>
      runAiCompletion({
        projectId,
        ...(opts?.sceneId !== undefined ? { sceneId: opts.sceneId } : sceneId !== undefined ? { sceneId } : {}),
        mode,
        model: settings.data?.model ?? 'gpt-4o-mini',
        inputText,
        ...(opts?.signal ? { signal: opts.signal } : {}),
        ...(opts?.includePrevChapterTail ? { includePrevChapterTail: true } : {}),
      }),
    [projectId, sceneId, settings.data?.model],
  )

  // Helper: read all scenes in a given chapter (by chapterId, not derived from current scene).
  // Uses the single batch endpoint `GET /api/chapters/:id/content` so a 20-scene
  // chapter is one round-trip rather than 20 serial awaits.
  const getChapterContent = useCallback(async (chapterId: number) => {
    const dto = await outlineApi.chapterContent(chapterId)
    if (dto.titles.length === 0) {
      // Mirror the previous "no scenes" branch so downstream callers behave identically.
      return { text: '', titles: [] as { title: string; id: number }[] }
    }
    return {
      text: dto.text,
      titles: dto.titles.map((t) => ({ title: t.title, id: t.id })),
    }
  }, [])

  // Review/extract AI call. The targets (chapter scenes) are *snapshotted here* —
// subsequent scene navigation does NOT change what the review is targeting, so
// applying the review never accidentally writes to a scene the user is merely
// looking at when they click "Apply". Triggered exclusively from the
// outline sidebar, against an explicit chapterId.
  const runReview = useCallback(
    async (kind: 'review' | 'extract', chapterId: number) => {
      // Tear down any in-flight request before starting a new one. The page
      // is blocked from other interactions while reviewBlock is true (the
      // panel sits in the middle and dims the rest of the layout), so the
      // user can't accidentally fire two concurrent review/extract runs.
      reviewAbortRef.current?.abort()
      const ctrl = new AbortController()
      reviewAbortRef.current = ctrl
      setReviewOpen(true)
      setReviewBlock(true)
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
          setReviewBlock(false)
          reviewAbortRef.current = null
          return
        }
        setReviewTargets(ch.titles)
        if (kind === 'review') {
          // Chapter-level review/extract: don't pass sceneId — server uses
          // projectId from the body for ai_settings, no scene JOIN needed.
          const text = await runAiFetch('auto_review', ch.text, { signal: ctrl.signal })
          setReviewText(text)
        } else {
          // Extract: run consistency_check only. The `voice` slot is kept in
          // the wrapper for backward compat with the parser below, but no
          // longer triggers a separate AI call — voice profiles are now
          // returned inside the consistency_check JSON as `voiceProfile`.
          const settingsText = await runAiFetch('consistency_check', ch.text, { signal: ctrl.signal })
          setReviewText(JSON.stringify({ settings: settingsText, voice: '' }))
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          // User cancelled mid-stream — drop the partial text and don't
          // surface it as an error.
          setReviewText('')
        } else {
          setReviewText('错误: ' + (e as Error).message)
        }
      } finally {
        setReviewLoading(false)
        // Loading is done — switch from "blocked" to "result ready" mode.
        // The panel stays open so the user can read the output and choose to
        // apply, but the blocking overlay lifts so the rest of the page is
        // interactive again.
        setReviewBlock(false)
        reviewAbortRef.current = null
      }
    },
    [runAiFetch, getChapterContent, toast],
  )

  // Cancel an in-flight review/extract. Aborts the underlying fetch so the
  // server stops streaming; the panel closes and the blocking overlay lifts.
  const cancelReview = useCallback(() => {
    reviewAbortRef.current?.abort()
    reviewAbortRef.current = null
    setReviewOpen(false)
    setReviewBlock(false)
    setReviewLoading(false)
    setReviewText('')
    setApplyProgress(null)
  }, [])

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

  // Bundle all tree callbacks into one memoized object so the OutlineTree's
  // memo engages. Without this, every keystroke in the editor (which
  // re-renders EditorPage) would invalidate every callback prop identity
  // and re-render the whole tree, blowing away collapsed/expanded state.
  const outlineHandlers = useMemo<OutlineHandlers>(
    () => ({
      onSelectScene: setSceneId,
      onSelectChapter: setSelectedChapterId,
      onAddVolume: () => void addVolume.mutate(),
      onAddChapter: (volumeId) => void addChapter.mutate(volumeId),
      onAddScene: handleAddScene,
      onCycleStatus: (id) => void cycleStatus.mutate(id),
      onDeleteScene: handleDeleteScene,
      onDeleteChapter: handleDeleteChapter,
      onRenameScene: renameScene,
      onRenameChapter: renameChapter,
      onRenameVolume: renameVolume,
      onReviewChapter: handleReviewChapter,
      onExtractChapter: handleExtractChapter,
    }),
    [
      addVolume,
      addChapter,
      handleAddScene,
      cycleStatus,
      handleDeleteScene,
      handleDeleteChapter,
      renameScene,
      renameChapter,
      renameVolume,
      handleReviewChapter,
      handleExtractChapter,
    ],
  )

  // Memoize the outline tree so it isn't rebuilt on every EditorPage
  // re-render (which fires on every keystroke in the editor). Without this,
  // each keystroke runs buildTree's O(V+C+S) sort + filter and creates a new
  // tree reference — combined with the OutlineTree memo, this lets the tree
  // actually skip re-rendering when only `content` changes.
  const outlineTree = useMemo(() => {
    if (!outlineData) return null
    return buildTree(outlineData.volumes, outlineData.chapters, outlineData.scenes)
  }, [outlineData])

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
          showError(e, '保存失败')
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
          showError(e, '保存失败')
        }
        return
      }
      if (mode === 'generate_chapter' && scenes && scenes.length > 0) {
        try {
          const cs = outlineData?.scenes.find((s) => s.id === sceneId)
          if (!cs) throw new Error('未找到当前章节')
          // Use the shared helper so the recovery-banner path benefits from
          // the same "single failure doesn't drop the whole batch" semantics
          // as the GenerateScenesDialog flow.
          const { createdIds, failedTitles } = await applyGeneratedScenes({
            projectId,
            chapterId: cs.chapterId,
            scenes,
            qc,
          })
          if (createdIds.length > 0) {
            setSceneId(createdIds[0]!)
          }
          if (failedTitles.length === 0) {
            toast({ kind: 'success', title: `已创建 ${createdIds.length} 个场景` })
          } else {
            toast({
              kind: createdIds.length === 0 ? 'error' : 'warning',
              title: `已创建 ${createdIds.length} 个场景，${failedTitles.length} 个失败`,
              description: failedTitles.join('、'),
            })
          }
        } catch (e) {
          showError(e, '创建场景失败')
        }
        return
      }
      // Default: apply text to editor
      if (editorApiRef.current) {
        if (mode === 'continue') {
          const merged = content.trimEnd() + '\n\n' + text
          editorApiRef.current.setContentFromText(merged)
        } else if (scope === 'selection') {
          // Use ProseMirror positions instead of a string `content.replace`.
          // The old code silently no-op'd if the user typed into the selection
          // during streaming (the selection text no longer matched anywhere).
          // The editor API method anchors to the live doc's from/to, so we
          // always replace the current range.
          const replaced = editorApiRef.current.replaceSelectionWithText(text)
          if (!replaced) {
            // No selection at accept time — fall back to overwriting the whole
            // doc so the user at least sees the AI output somewhere.
            editorApiRef.current.setContentFromText(text)
          }
        } else {
          editorApiRef.current.setContentFromText(text)
        }
      } else if (mode === 'continue') {
        setContent((c) => c.trimEnd() + '\n\n' + text)
      } else if (scope === 'selection' && selectionText) {
        // Fallback path when the editor isn't ready (e.g. SSR or before mount).
        // Same as before: if the selection text drifted, this silently no-ops.
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
      // Flush any pending debounced save so the AI reads the latest content
      // from disk (not stale editor state) when it rewrites each scene.
      await debouncedSave.flush()
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
          // Collect per-scene failures so the user can see which scenes
          // didn't apply instead of a single opaque "applied to N" toast.
          const failures: Array<{ title: string; error: string }> = []
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
              // For the currently-open scene: don't use force so the baseHash
              // guard can catch any concurrent external edits that happened
              // while the AI was generating. Re-fetch baseHash right before
              // save to minimize the race window.
              // For other scenes: force is safe — no local editor state to protect.
              if (sc.id === sceneId) {
                const fresh = await api<{ baseHash: string }>(`/api/scenes/${sc.id}`)
                await api(`/api/scenes/${sc.id}`, {
                  method: 'PUT',
                  body: JSON.stringify({ markdown: formatted, baseHash: fresh.baseHash }),
                })
              } else {
                await api(`/api/scenes/${sc.id}`, {
                  method: 'PUT',
                  body: JSON.stringify({ markdown: formatted, baseHash: sceneData.baseHash, force: true }),
                })
              }
              applied++
            } catch (e) {
              const err = e instanceof ApiClientError ? e : (e as Error)
              console.error(`[审稿应用] 场景 ${sc.title} 失败:`, err)
              failures.push({ title: sc.title, error: err.message })
            }
          }
          setApplyProgress(null)
          qc.invalidateQueries({ queryKey: ['outline', projectId] })
          if (sceneId) qc.invalidateQueries({ queryKey: ['scene', sceneId] })
          if (failures.length === 0) {
            toast({ kind: 'success', title: `审稿建议已应用到 ${applied} 个场景` })
          } else {
            // Cap the visible list so a 20-scene failure doesn't blow up the toast.
            const preview = failures.slice(0, 5).map((f) => `• ${f.title}: ${f.error}`).join('\n')
            const more = failures.length > 5 ? `\n…等 ${failures.length - 5} 个` : ''
            const tone = applied === 0 ? 'error' : 'info'
            toast({
              kind: tone,
              title: `已应用 ${applied}/${total} 个场景,${failures.length} 个失败`,
              description: preview + more,
            })
          }
        } else {
          // Extract: parse combined settings + voice result
          let savedCount = 0
          let skipCount = 0
          let settingsText = ''
          try {
            const combined = JSON.parse(reviewText)
            settingsText = combined.settings || reviewText
          } catch {
            // Fallback: treat as plain settings text
            settingsText = reviewText
          }

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
                setReviewOpen(false)
                setReviewText('')
                toast({
                  kind: 'info',
                  title: 'AI 未提取到设定',
                  description: '场景内容中未发现可提取的人物、世界观、时间线等信息。请尝试分析包含更多设定信息的场景。',
                })
                setApplyLoading(false)
                return
              }

              // Fetch all existing entities ONCE to avoid N+1 API calls.
              const [existingChars, existingWorld, existingTimeline, existingConflicts, existingForeshadows] = await Promise.all([
                worldApi.listCharacters(projectId),
                worldApi.listWorldElements(projectId),
                worldApi.listTimeline(projectId),
                worldApi.listConflicts(projectId),
                worldApi.listForeshadows(projectId),
              ])
              const str = (v: unknown, dflt = ''): string => (typeof v === 'string' ? v : dflt)
              const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
              for (const c of data.characters ?? []) {
                const name = str(c.name).trim() || '未命名'
                const existing = existingChars.find((e) => e.name === name)
                if (existing) {
                  const existingNotes = existing.notes || ''
                  const newNotes = str(c.notes)
                  const mergedNotes = existingNotes && newNotes ? existingNotes + '\n\n---\n\n' + newNotes : newNotes || existingNotes
                  const aliases = arr(c.aliases)
                  try {
                    await worldApi.updateCharacter(existing.id, {
                      name,
                      aliases: aliases.length ? aliases : existing.aliases,
                      appearance: str(c.appearance) || existing.appearance,
                      personality: str(c.personality) || existing.personality,
                      background: str(c.background) || existing.background,
                      relationships: str(c.relationships) || existing.relationships,
                      voiceProfile: str(c.voiceProfile) || existing.voiceProfile,
                      notes: mergedNotes,
                      expectedUpdatedAt: existing.updatedAt,
                    } as any)
                  } catch (updateErr) {
                    if (updateErr instanceof ApiClientError && updateErr.status === 409) {
                      skipCount++; continue
                    }
                    throw updateErr
                  }
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
                const existing = existingWorld.find((e) => e.name === name)
                if (existing) {
                  const existingNotes = existing.notes || ''
                  const newNotes = str(w.notes)
                  const mergedNotes = existingNotes && newNotes ? existingNotes + '\n\n---\n\n' + newNotes : newNotes || existingNotes
                  try {
                    await worldApi.updateWorldElement(existing.id, {
                      name,
                      category: (str(w.category) as WorldCategory) || existing.category,
                      description: str(w.description) || existing.description,
                      notes: mergedNotes,
                      expectedUpdatedAt: existing.updatedAt,
                    } as any)
                  } catch (updateErr) {
                    if (updateErr instanceof ApiClientError && updateErr.status === 409) {
                      skipCount++; continue
                    }
                    throw updateErr
                  }
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
                const existing = existingTimeline.find((e) => e.title === title)
                if (existing) {
                  const existingNotes = existing.notes || ''
                  const newNotes = str(t.notes)
                  const mergedNotes = existingNotes && newNotes ? existingNotes + '\n\n---\n\n' + newNotes : newNotes || existingNotes
                  try {
                    await worldApi.updateTimelineEvent(existing.id, {
                      title,
                      era: str(t.era) || existing.era,
                      description: str(t.description) || existing.description,
                      notes: mergedNotes,
                      expectedUpdatedAt: existing.updatedAt,
                    } as any)
                  } catch (updateErr) {
                    if (updateErr instanceof ApiClientError && updateErr.status === 409) {
                      skipCount++; continue
                    }
                    throw updateErr
                  }
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
                const existing = existingConflicts.find((e) => e.title === title)
                if (existing) {
                  const existingNotes = existing.notes || ''
                  const newNotes = str(c.notes)
                  const mergedNotes = existingNotes && newNotes ? existingNotes + '\n\n---\n\n' + newNotes : newNotes || existingNotes
                  try {
                    await worldApi.updateConflict(existing.id, {
                      title,
                      type: (str(c.type) as ConflictType) || existing.type,
                      description: str(c.description) || existing.description,
                      setup: str(c.setup) || existing.setup,
                      escalation: str(c.escalation) || existing.escalation,
                      climax: str(c.climax) || existing.climax,
                      resolution: str(c.resolution) || existing.resolution,
                      notes: mergedNotes,
                      expectedUpdatedAt: existing.updatedAt,
                    } as any)
                  } catch (updateErr) {
                    if (updateErr instanceof ApiClientError && updateErr.status === 409) {
                      skipCount++; continue
                    }
                    throw updateErr
                  }
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
                const existing = existingForeshadows.find((e) => e.title === title)
                if (existing) {
                  const existingNotes = existing.notes || ''
                  const newNotes = str(f.notes)
                  const mergedNotes = existingNotes && newNotes ? existingNotes + '\n\n---\n\n' + newNotes : newNotes || existingNotes
                  try {
                    await worldApi.updateForeshadow(existing.id, {
                      title,
                      description: str(f.description) || existing.description,
                      status: (str(f.status) as ForeshadowStatus) || existing.status,
                      notes: mergedNotes,
                      expectedUpdatedAt: existing.updatedAt,
                    } as any)
                  } catch (updateErr) {
                    if (updateErr instanceof ApiClientError && updateErr.status === 409) {
                      skipCount++; continue
                    }
                    throw updateErr
                  }
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
              // JSON parse failed — most likely the AI output was truncated
              // by the token limit. Keep the dialog open and surface the raw
              // output so the user can see what went wrong, retry, or
              // manually copy/paste a smaller chunk.
              toast({
                kind: 'error',
                title: '提取失败：AI 输出不是合法 JSON',
                description: '可能是输出超过 token 上限被截断。可尝试提取更小的章节，或重新运行后让 AI 精简输出。',
              })
              setApplyLoading(false)
              return
            }
          }

          qc.invalidateQueries({ queryKey: ['characters', projectId] })
          qc.invalidateQueries({ queryKey: ['worldElements', projectId] })
          qc.invalidateQueries({ queryKey: ['timeline', projectId] })
          qc.invalidateQueries({ queryKey: ['conflicts', projectId] })
          qc.invalidateQueries({ queryKey: ['foreshadows', projectId] })
          // Close the review panel — extraction is complete and the review text
          // has been processed; keeping it open serves no purpose.
          setReviewOpen(false)
          setReviewText('')
          if (savedCount > 0 && skipCount === 0) {
            toast({ kind: 'success', title: `已保存 ${savedCount} 条设定到世界数据库` })
          } else if (savedCount > 0 && skipCount > 0) {
            toast({ kind: 'warning', title: `已保存 ${savedCount} 条设定，${skipCount} 条因冲突跳过`, description: '部分设定在提取期间被手动修改过，已跳过以保护手动编辑' })
          } else if (skipCount > 0 && savedCount === 0) {
            toast({ kind: 'warning', title: `${skipCount} 条设定因冲突跳过`, description: '所有匹配的设定在提取期间被手动修改过' })
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
        showError(e, '应用失败')
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

      <div data-resizable-parent className="flex flex-1 overflow-hidden">
        {!focusMode && (
          <aside
            className="relative flex h-full shrink-0 flex-col overflow-hidden border-r bg-sidebar-background"
            style={{ width: leftSidebar.width }}
          >
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
                      } catch (e) { showError(e, '保存失败') }
                    }}>
                      <Check className="mr-1 h-2.5 w-2.5" /> 保存
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 flex-1 text-[10px]" onClick={() => setEditingStoryArc(false)}>
                      取消
                    </Button>
                  </div>
                </div>
              )}
              {outlineTree ? (
                <div className="min-h-0 flex-1">
                  <OutlineTree
                    nodes={outlineTree}
                    currentSceneId={sceneId}
                    selectedChapterId={selectedChapterId ?? undefined}
                    handlers={outlineHandlers}
                  />
                </div>
              ) : (
                <div className="p-4 text-sm text-muted-foreground">读取大纲中…</div>
              )}
            </>
          ) : (
            <WorldPanel projectId={projectId} model={settings.data?.model ?? 'gpt-4o-mini'} />
          )}
          {/* Right-edge drag handle. Wider hit area than the visual line so
              dragging isn't fiddly. */}
          <div
            {...leftSidebar.handleProps}
            className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-primary/30 active:bg-primary/50"
          />
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
              <div className="flex flex-1 overflow-hidden">
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
                {/* AI sidebar — hidden in focus mode so the editor takes the full width. */}
                {!focusMode && (
                  <AiSidebar
                    sceneId={sceneId}
                    model={settings.data?.model ?? 'gpt-4o-mini'}
                    content={content}
                    selection={selectionText}
                    aiState={aiState}
                    aiStart={aiStart}
                    aiCancel={aiCancel}
                    aiReset={aiReset}
                    aiAccept={aiAccept}
                    width={rightSidebar.width}
                    handleProps={rightSidebar.handleProps}
                    onAccept={async (rawText, mode) => {
                      await applyAcceptedText(rawText, mode)
                      if (mode !== 'plan_story_arc' && mode !== 'analyze_voice' && mode !== 'generate_chapter') {
                        toast({ kind: 'success', title: '已应用到编辑器' })
                      }
                    }}
                  />
                )}
              </div>

              {/* Review panel moved out of {sceneId &&} below — see sibling block */}
            </>
          ) : (
            <EmptyState
              onAddScene={
                outlineData && outlineData.chapters.length > 0
                  ? () => handleAddScene(outlineData.chapters[0]!.id)
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

          {/* Blocking overlay: sits on top of everything except the review/extract
              panel itself (which has its own z-50 above this z-40) and dims
              the rest of the page while a review/extract request is in
              flight. The overlay is click-through (pointer-events-none) — it
              doesn't intercept input, it just visually communicates "wait,
              something is happening" — but the panel's cancel button still
              aborts the underlying request. */}
          {reviewBlock && (
            <div
              className="pointer-events-none fixed inset-0 z-40 bg-background/70 backdrop-blur-sm"
              aria-hidden="true"
            />
          )}

          {/* Review/extract panel — lives OUTSIDE {sceneId &&} so chapter-level
              review/extract (triggered from the outline sidebar) works even
              when the user hasn't opened any scene. Now rendered as a
              centered modal-like card with a larger surface so the long
              markdown output is readable. The blocking overlay above keeps
              the user from accidentally starting a second run or navigating
              away while the request is in flight. */}
          {reviewOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {reviewKind === 'review' ? '📖 审稿建议' : '🔍 设定提取'}
                    </span>
                    {reviewTargets.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        章节：{reviewTargets.length} 个场景
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={cancelReview}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    {reviewLoading ? '取消' : '关闭'}
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  {reviewLoading ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      <span>AI 正在分析章节内容…</span>
                      <span className="text-xs">点「取消」可随时中断</span>
                    </div>
                  ) : reviewKind === 'extract' ? (
                    <div className="space-y-4">
                      {(() => {
                        try {
                          const combined = JSON.parse(reviewText)
                          return (
                            <>
                              {combined.settings && (
                                <div>
                                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">设定提取</div>
                                  <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm leading-relaxed text-foreground">{combined.settings}</pre>
                                </div>
                              )}
                              {combined.voice && (
                                <div>
                                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">语音档案</div>
                                  <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm leading-relaxed text-foreground">{combined.voice}</pre>
                                </div>
                              )}
                            </>
                          )
                        } catch {
                          return <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm leading-relaxed text-foreground">{reviewText}</pre>
                        }
                      })()}
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm leading-relaxed text-foreground">{reviewText}</pre>
                  )}
                </div>
                {!reviewLoading && reviewText && (
                  <div className="flex flex-col gap-3 border-t px-4 py-3">
                    {/* Progress bar when applying chapter review */}
                    {applyProgress && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                            正在重写: {applyProgress.sceneTitle}
                          </span>
                          <span className="font-mono tabular-nums">{applyProgress.current}/{applyProgress.total}</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
                          <div
                            className="h-full bg-primary transition-all duration-300"
                            style={{ width: `${(applyProgress.current / applyProgress.total) * 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      {reviewKind === 'review' ? (
                        <Button
                          size="sm"
                          className="text-xs"
                          disabled={applyLoading}
                          onClick={() => applyReview('replace_all')}
                        >
                          <Check className="mr-1.5 h-3.5 w-3.5" />
                          {applyLoading ? '应用中...' : `应用到整个章节 (${reviewTargets.length} 个场景)`}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="text-xs"
                          disabled={applyLoading}
                          onClick={() => applyReview('extract')}
                        >
                          <Check className="mr-1.5 h-3.5 w-3.5" />
                          保存到设定
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {sceneId && (
            <>
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

      {addSceneOpen && addSceneChapterId !== null && (
        <GenerateScenesDialog
          open={addSceneOpen}
          onOpenChange={setAddSceneOpen}
          projectId={projectId}
          chapterId={addSceneChapterId}
          chapterTitle={addSceneChapterTitle}
          model={settings.data?.model ?? 'gpt-4o-mini'}
          qc={qc}
          onApplied={({ firstId, createdIds, failedTitles, extractSummary, extractError }) => {
            if (createdIds.length > 0) {
              setSceneId(firstId)
            }
            if (failedTitles.length === 0) {
              toast({ kind: 'success', title: `已创建 ${createdIds.length} 个场景` })
            } else {
              toast({
                kind: createdIds.length === 0 ? 'error' : 'warning',
                title: `已创建 ${createdIds.length} 个场景，${failedTitles.length} 个失败`,
                description: failedTitles.join('、'),
              })
            }
            // If the user opted into "应用并提取设定", report the
            // per-entity counts as a follow-up toast. We toast this AFTER
            // the scene-applied toast so the user sees them in order, and
            // skip it entirely when extraction didn't run.
            if (extractError) {
              toast({
                kind: 'warning',
                title: '提取设定失败',
                description: extractError,
              })
            } else if (extractSummary) {
              const total =
                extractSummary.characters +
                extractSummary.worldElements +
                extractSummary.timeline +
                extractSummary.foreshadows +
                extractSummary.conflicts
              if (total === 0) {
                toast({ kind: 'info', title: '提取完成：未发现可写入的设定' })
              } else {
                const parts = [
                  extractSummary.characters && `${extractSummary.characters} 人物`,
                  extractSummary.worldElements && `${extractSummary.worldElements} 设定`,
                  extractSummary.timeline && `${extractSummary.timeline} 时间线`,
                  extractSummary.foreshadows && `${extractSummary.foreshadows} 伏笔`,
                  extractSummary.conflicts && `${extractSummary.conflicts} 冲突`,
                ]
                  .filter(Boolean)
                  .join('、')
                toast({
                  kind: 'success',
                  title: `已提取 ${total} 条设定`,
                  description: parts,
                })
              }
            }
          }}
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
