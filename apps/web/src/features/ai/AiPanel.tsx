import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { CompletionMode, WorldCategory, ConflictType, ForeshadowStatus } from '@novel/shared'
import type { AiStreamState } from '../../hooks/useAiStream.js'
import { worldApi } from '../world/api.js'
import { splitChapterToScenes, type ParsedScene } from './sceneSplitter.js'
import { parseAiJson } from './jsonParse.js'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Sparkles, X, RotateCcw, Check, Wand2, BookOpen, FileText, Info, Save, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

export type AiScope = 'full' | 'selection' | 'generate' | 'chapter'

interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  sceneId: number
  model: string
  inputText: string
  selection?: string | null | undefined
  onAccept: (text: string, mode: CompletionMode, scope: AiScope, scenes?: ParsedScene[]) => void
  /** Existing draft to recover from when the panel first opens (page refresh, etc).
   *
   * NOTE: This prop is intentionally consumed only at `useAiStream` *initialization*
   * time. Recovery of interrupted drafts (page refresh, navigation, network drop)
   * is handled by the recovery banner in EditorPage, NOT here. The panel itself
   * always opens in an "idle" state ready for a new generation. Keep this prop
   * for API compatibility but do not add logic that reads it inside this body —
   * it would be misleading to users that the recovery banner is the canonical UI
   * for resuming an interrupted run. */
  recoverFromDraft?: import('./draftsApi.js').DraftDto | undefined
  /** Shared AI stream state managed by parent — keeps running when panel closes. */
  aiState: AiStreamState
  aiStart: (body: object) => Promise<void>
  aiCancel: () => Promise<void>
  aiReset: () => void
  aiAccept: () => Promise<void>
}

type AiTab = 'edit' | 'generate'

const TABS: { id: AiTab; label: string; icon: typeof Pencil }[] = [
  { id: 'edit', label: '编辑', icon: Pencil },
  { id: 'generate', label: '生成', icon: Wand2 },
]

const EDIT_MODES: { id: 'continue' | 'polish' | 'rewrite' | 'expand' | 'condense'; label: string; description: string; selectionOnly?: boolean }[] = [
  { id: 'continue', label: '续写', description: '从结尾继续写', selectionOnly: false },
  { id: 'polish', label: '润色', description: '保留原意优化', selectionOnly: true },
  { id: 'rewrite', label: '重写', description: '相同含义新措辞', selectionOnly: true },
  { id: 'expand', label: '扩写', description: '1.5x~2x 展开', selectionOnly: true },
  { id: 'condense', label: '压缩', description: '精简到一半', selectionOnly: true },
]

const GENERATE_MODES: { id: 'generate_scene' | 'generate_chapter'; label: string; description: string; icon: typeof Wand2 }[] = [
  { id: 'generate_scene', label: '生成场景', description: '根据描述写一个完整场景', icon: FileText },
  { id: 'generate_chapter', label: '生成章节', description: '根据大纲写一个完整章节', icon: BookOpen },
]

export function AiPanelSheet({ open, onOpenChange, projectId, sceneId, model, inputText, selection, onAccept, recoverFromDraft, aiState: state, aiStart: start, aiCancel: cancel, aiReset: reset, aiAccept: accept }: SheetProps) {
  const [tab, setTab] = useState<AiTab>('edit')
  const [generatePrompt, setGeneratePrompt] = useState('')
  const [lastMode, setLastMode] = useState<CompletionMode>('continue')
  const [saving, setSaving] = useState(false)
  const [editedScenes, setEditedScenes] = useState<ParsedScene[] | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()

  const hasSelection = !!(selection && selection.trim().length > 0)

  // Parse AI output for generate_chapter mode
  const parsedScenes: ParsedScene[] = useMemo(() => {
    if (lastMode !== 'generate_chapter') return []
    if (editedScenes) return editedScenes
    if (!state.text) return []
    return splitChapterToScenes(state.text)
  }, [lastMode, state.text, editedScenes])

  const switchTab = (next: AiTab) => {
    if (next !== tab) {
      reset()
      setGeneratePrompt('')
      setLastMode('continue')
      setEditedScenes(null)
      setTab(next)
    }
  }

  const handleGenerate = (mode: CompletionMode) => {
    if (!generatePrompt.trim()) return
    setLastMode(mode)
    setEditedScenes(null)
    start({ sceneId, mode, model, inputText: generatePrompt.trim() })
  }

  const handleSuggestNextChapter = async () => {
    setLastMode('suggest_next_chapter')
    setEditedScenes(null)
    start({
      sceneId,
      mode: 'suggest_next_chapter',
      model,
      inputText,
    })
  }

  const handleEdit = (mode: 'continue' | 'polish' | 'rewrite' | 'expand' | 'condense') => {
    setLastMode(mode)
    const modeDef = EDIT_MODES.find((m) => m.id === mode)
    if (modeDef?.selectionOnly && hasSelection) {
      start({ sceneId, mode, model, inputText: selection ?? '' })
    } else {
      start({ sceneId, mode, model, inputText })
    }
  }

  const handleAccept = () => {
    if (lastMode === 'generate_chapter') {
      onAccept(state.text, lastMode, 'chapter', parsedScenes)
      setEditedScenes(null)
      void accept()
      return
    }
    if (lastMode === 'suggest_next_chapter') {
      // For chapter suggestion: put the generated outline into the prompt textarea
      // so the user can use it as input for a subsequent generate_chapter call.
      setGeneratePrompt(state.text.trim())
      void accept()
      reset()
      return
    }
    const scope: AiScope =
      lastMode === 'generate_scene'
        ? 'generate'
        : EDIT_MODES.find((m) => m.id === lastMode)?.selectionOnly && hasSelection
          ? 'selection'
          : 'full'
    onAccept(state.text, lastMode, scope)
    void accept()
  }

  const handleSaveToWorld = async () => {
    if (!state.text) return
    setSaving(true)
    try {
      const data = parseAiJson<{
        characters?: Array<Record<string, unknown>>
        worldElements?: Array<Record<string, unknown>>
        timeline?: Array<Record<string, unknown>>
        foreshadows?: Array<Record<string, unknown>>
        conflicts?: Array<Record<string, unknown>>
      }>(state.text)
      if (!data) throw new Error('无法解析 AI 输出的 JSON')

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
      }

      qc.invalidateQueries({ queryKey: ['characters', projectId] })
      qc.invalidateQueries({ queryKey: ['worldElements', projectId] })
      qc.invalidateQueries({ queryKey: ['timeline', projectId] })
      qc.invalidateQueries({ queryKey: ['foreshadows', projectId] })
      qc.invalidateQueries({ queryKey: ['conflicts', projectId] })

      toast({ kind: 'success', title: '已保存到设定数据库！' })
    } catch (e) {
      toast({ kind: 'error', title: '保存失败: ' + (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const streaming = state.status === 'streaming'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[420px] flex-col overflow-hidden p-0 sm:w-[480px]">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            AI 助手
          </SheetTitle>
        </SheetHeader>

        {/* Top tab menu */}
        <div className="flex shrink-0 border-b bg-muted/30 px-2 py-1">
          {TABS.map((t) => {
            const Icon = t.icon
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => switchTab(t.id)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                  active
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            )
          })}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="space-y-4 p-4">
            {/* Selection banner — only relevant for Edit tab */}
            {tab === 'edit' && (
              <div
                className={cn(
                  'flex items-start gap-2 rounded-md border p-2 text-xs',
                  hasSelection
                    ? 'border-primary/30 bg-primary/5 text-foreground'
                    : 'border-dashed text-muted-foreground',
                )}
              >
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {hasSelection ? (
                  <span>
                    已选中 <span className="font-mono">{selection!.length}</span> 字；润色/重写/扩写/压缩将仅作用于该选区。
                  </span>
                ) : (
                  <span>未选中文字。润色/重写/扩写/压缩将作用于整篇内容。</span>
                )}
              </div>
            )}

            {/* Tab: Edit */}
            {tab === 'edit' && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">作用于当前场景或选区</p>
                <div className="grid grid-cols-2 gap-2">
                  {EDIT_MODES.map((m) => (
                    <Button
                      key={m.id}
                      variant={streaming ? 'secondary' : 'outline'}
                      className="h-auto flex-col items-start gap-0.5 py-2.5"
                      disabled={streaming}
                      onClick={() => handleEdit(m.id)}
                    >
                      <span className="text-sm font-medium">{m.label}</span>
                      <span className="text-[11px] font-normal text-muted-foreground">
                        {m.selectionOnly && hasSelection ? '作用于选区' : m.description}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Tab: Generate */}
            {tab === 'generate' && (
              <div className="space-y-3">
                <Textarea
                  value={generatePrompt}
                  onChange={(e) => setGeneratePrompt(e.target.value)}
                  placeholder="例如：主角在雨夜的咖啡馆偶遇旧友…"
                  rows={4}
                />
                <div className="grid grid-cols-2 gap-2">
                  {GENERATE_MODES.map((m) => (
                    <Button
                      key={m.id}
                      variant={streaming ? 'secondary' : 'outline'}
                      className="h-auto flex-col items-start gap-0.5 py-2.5"
                      disabled={streaming || !generatePrompt.trim()}
                      onClick={() => handleGenerate(m.id)}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <m.icon className="h-3.5 w-3.5" />
                        {m.label}
                      </span>
                      <span className="text-[11px] font-normal text-muted-foreground">{m.description}</span>
                    </Button>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-muted-foreground"
                  disabled={streaming || !inputText.trim()}
                  onClick={handleSuggestNextChapter}
                >
                  <Sparkles className="mr-1.5 h-3 w-3" />
                  {streaming ? 'AI 分析中…' : '建议下一章大纲（章节接力）'}
                </Button>
              </div>
            )}

            {/* Status + Output */}
            {(state.status !== 'idle' || state.text) && (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant={state.status === 'streaming' ? 'default' : state.status === 'error' ? 'destructive' : state.status === 'done' ? 'secondary' : 'outline'}>
                    {state.status === 'idle' && '就绪'}
                    {state.status === 'streaming' && '生成中…'}
                    {state.status === 'done' && '完成'}
                    {state.status === 'error' && '错误'}
                  </Badge>
                  {streaming && (
                    <Button variant="ghost" size="sm" onClick={cancel}>
                      <X className="mr-1 h-3 w-3" />
                      取消
                    </Button>
                  )}
                </div>

                {(streaming || state.status === 'done') && (
                  <div className="flex flex-col gap-1 rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <span className="font-mono tabular-nums text-foreground">{state.text.length} 字</span>
                        {state.usage?.completionTokens ? (
                          <>
                            <span>·</span>
                            <span className="font-mono tabular-nums">~{state.usage.completionTokens} tokens</span>
                          </>
                        ) : null}
                        {streaming ? (
                          <>
                            <span>·</span>
                            <span className="font-mono tabular-nums">{(state.elapsedMs / 1000).toFixed(1)}s</span>
                          </>
                        ) : null}
                      </div>
                      <span className="font-mono tabular-nums text-foreground">{state.progressPct}%</span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-background">
                      <div
                        className={cn(
                          'h-full transition-all duration-300',
                          state.status === 'done' ? 'bg-green-500' : 'bg-primary',
                        )}
                        style={{ width: `${state.progressPct}%` }}
                      />
                    </div>
                  </div>
                )}

                <Card className="min-h-[160px]">
                  <CardContent className="p-3">
                    {state.text ? (
                      <pre className="whitespace-pre-wrap text-xs leading-relaxed">{state.text}</pre>
                    ) : (
                      <p className="text-sm text-muted-foreground">（等待 AI 输出）</p>
                    )}
                  </CardContent>
                </Card>

                {state.status === 'error' && state.errorMessage && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                    {state.errorMessage}
                  </div>
                )}

                {/* Chapter split preview */}
                {state.status === 'done' && lastMode === 'generate_chapter' && parsedScenes.length > 0 && (
                  <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                      <FileText className="h-3.5 w-3.5" />
                      将创建 {parsedScenes.length} 个场景：
                    </div>
                    <div className="space-y-1.5">
                      {parsedScenes.map((s, i) => {
                        const charCount = s.markdown.replace(/\s/g, '').length
                        return (
                          <div key={i} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
                            <Badge variant="outline" className="shrink-0 text-[10px]">{i + 1}</Badge>
                            <input
                              type="text"
                              value={s.title}
                              onChange={(e) => {
                                const next = [...parsedScenes]
                                next[i] = { ...s, title: e.target.value }
                                setEditedScenes(next)
                              }}
                              className="flex-1 bg-transparent text-sm focus:outline-none"
                            />
                            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                              {charCount} 字
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  {state.status === 'done' && lastMode !== 'consistency_check' && lastMode !== 'auto_review' && (
                    <Button onClick={handleAccept} className="flex-1">
                      <Check className="mr-1.5 h-4 w-4" />
                      {lastMode === 'continue' ? '接受并续写' :
                        lastMode === 'generate_chapter' ? `创建 ${parsedScenes.length} 个场景` :
                        lastMode === 'suggest_next_chapter' ? '填入提示词' :
                        '接受并替换'}
                    </Button>
                  )}
                  {state.status === 'done' && lastMode === 'auto_review' && (
                    <p className="flex-1 text-xs text-muted-foreground self-center">
                      📖 审稿建议已生成，可在编辑器右下角📖按钮一键应用
                    </p>
                  )}
                  {(state.status === 'done' || state.status === 'error') && (
                    <Button variant="outline" onClick={reset}>
                      <RotateCcw className="mr-1.5 h-4 w-4" />
                      重置
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}