import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Sparkles, X, RotateCcw, Check, FileText, ChevronDown } from 'lucide-react'
import { useAiStream } from '../../hooks/useAiStream.js'
import { splitChapterToScenes, type ParsedScene } from './sceneSplitter.js'
import { applyGeneratedScenes } from './sceneBatchCreate.js'
import type { QueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'

type Step = 'input' | 'generating' | 'preview'

interface GenerateScenesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  chapterId: number
  /** Title of the chapter the new scenes will be inserted into. Shown in the
   *  dialog as "AI 将基于「{chapterTitle}」末尾自动续写" so the user knows
   *  what context the model is reading. */
  chapterTitle: string
  model: string
  qc: QueryClient
  /**
   * Called after the user clicks Apply. Receives the id of the first
   * successfully created scene (so the editor can navigate to it), the
   * list of created ids, and the list of failed titles.
   */
  onApplied: (result: { firstId: number; createdIds: number[]; failedTitles: string[] }) => void
}

const MIN_COUNT = 1
const MAX_COUNT = 10
const DEFAULT_COUNT = 3

/**
 * Multi-step dialog that lets the user generate N scenes in one AI call.
 *
 * Lifecycle (driven by local `step` state):
 *   input       — user types description + count
 *   generating  — stream running, progress + cancel
 *   preview     — parsed scenes shown as a list, user applies or regenerates
 *
 * Stream state is owned by an independent `useAiStream` instance (not the
 * one used by AiSidebar for scene-level editing) so the two flows can run
 * concurrently without stepping on each other. This matches the pattern
 * used by WorldPanel's AiGenerateSection.
 */
export function GenerateScenesDialog({
  open,
  onOpenChange,
  projectId,
  chapterId,
  chapterTitle,
  model,
  qc,
  onApplied,
}: GenerateScenesDialogProps) {
  const [step, setStep] = useState<Step>('input')
  const [description, setDescription] = useState('')
  const [count, setCount] = useState<number>(DEFAULT_COUNT)
  // "Advanced options" panel — hides the description textarea by default so
  // the dialog surfaces just "how many scenes?" as the minimum question.
  // The description is still optional even when expanded.
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [applyLoading, setApplyLoading] = useState(false)
  // Persisted scene list across re-renders (e.g. cancel + reopen shouldn't
  // lose the parsed list if the user dismissed accidentally).
  const [appliedResult, setAppliedResult] = useState<{ createdIds: number[]; failedTitles: string[] } | null>(null)

  const { state, start, cancel, reset } = useAiStream()
  // Skip the first stream-event effect run so opening the dialog doesn't
  // immediately flip into 'preview' from a stale 'done' status of a prior
  // mount.
  const streamReady = useRef(false)

  // Reset all local state when the dialog opens fresh. We key this on `open`
  // toggling from false → true, so closing the dialog and re-opening starts
  // the user over at the input step.
  useEffect(() => {
    if (open) {
      streamReady.current = false
      setStep('input')
      setDescription('')
      setCount(DEFAULT_COUNT)
      setAdvancedOpen(false)
      setApplyLoading(false)
      setAppliedResult(null)
      reset()
    }
  }, [open, reset])

  // Auto-advance from generating → preview when the stream finishes.
  useEffect(() => {
    if (!streamReady.current) return
    if (state.status === 'done' && step === 'generating') {
      setStep('preview')
    }
  }, [state.status, step])

  const parsedScenes: ParsedScene[] = useMemo(() => {
    if (state.status !== 'done') return []
    return splitChapterToScenes(state.text)
  }, [state.text, state.status])

  const trimmedDesc = description.trim()
  // Description is optional — the AI reads the chapter tail via chapterId,
  // so the user only needs to specify how many scenes to generate. The
  // description, if provided, is layered into the prompt as explicit guidance.
  const canStart = count >= MIN_COUNT && count <= MAX_COUNT

  const handleStart = () => {
    if (!canStart) return
    streamReady.current = true
    setStep('generating')
    // Pack the count + (optional) description into inputText. When the user
    // leaves the description empty we still give the model a fallback cue so
    // it doesn't try to summarize nothing.
    const promptSection = trimmedDesc
      ? `共 ${count} 个场景。\n\n${trimmedDesc}`
      : `共 ${count} 个场景。基于当前章节末尾自然续写，无需用户提供额外大纲。`
    void start({
      projectId,
      chapterId,
      mode: 'generate_chapter',
      model,
      inputText: promptSection,
    })
  }

  const handleCancelStream = async () => {
    await cancel()
    streamReady.current = false
    setStep('input')
    reset()
  }

  const handleRegenerate = () => {
    reset()
    streamReady.current = false
    // Re-kick off the same request.
    handleStart()
  }

  const handleApply = async () => {
    if (parsedScenes.length === 0) return
    setApplyLoading(true)
    try {
      const result = await applyGeneratedScenes({
        projectId,
        chapterId,
        scenes: parsedScenes,
        qc,
      })
      setAppliedResult(result)
      const firstId = result.createdIds[0]
      if (firstId !== undefined) {
        onApplied({ firstId, createdIds: result.createdIds, failedTitles: result.failedTitles })
      }
      // Only close the dialog when at least one scene was created — if
      // every scene failed the user should see the failure state and
      // decide to retry.
      if (result.createdIds.length > 0) {
        onOpenChange(false)
      }
    } finally {
      setApplyLoading(false)
    }
  }

  const handleClose = () => {
    // While the stream is running, treat "close" as a cancel — abort the
    // fetch, throw away the partial text, and snap back to the input step
    // so the dialog is in a known-good state if the user re-opens it.
    // (We don't actually pop the dialog here — that's `onOpenChange`'s job.
    // This is only the body of the close, called from the X / overlay click.)
    if (step === 'generating') {
      void cancel()
      streamReady.current = false
      setStep('input')
      reset()
    }
    onOpenChange(false)
  }

  /**
   * While a generate or apply is in flight, lock the rest of the page so
   * the user can't fire a second request, navigate to a different scene,
   * or otherwise start work that would race with the in-progress one. The
   * dialog itself stays interactive (cancel/apply buttons must keep
   * working) — only the rest of the page is dimmed.
   */
  const busy = step === 'generating' || applyLoading

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Block closing the dialog via overlay click / Esc while a stream is
        // in flight or while we're applying the batch — the user has to
        // explicitly cancel the stream (or wait for apply to finish) before
        // they can dismiss. This prevents the "click away and lose state"
        // footgun.
        if (o || !busy) {
          if (!o) handleClose()
          else onOpenChange(true)
        }
      }}
    >
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onInteractOutside={(e) => {
          // Same as the `onOpenChange` guard: don't let the user click
          // outside to dismiss during a run.
          if (busy) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault()
        }}
      >
        {step === 'input' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> 一键生成场景
              </DialogTitle>
              <DialogDescription>
                AI 会读取「{chapterTitle}」末尾作为上下文，一次性生成多个场景并按顺序插入到该章节末尾。
              </DialogDescription>
            </DialogHeader>
            <form
              className="grid gap-3 overflow-y-auto"
              onSubmit={(e) => {
                e.preventDefault()
                void handleStart()
              }}
            >
              <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                ℹ️ AI 将基于「{chapterTitle}」末尾自动续写，无需输入描述。
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="gen-count" className="text-xs font-medium text-foreground">
                  场景数量
                </label>
                <Input
                  id="gen-count"
                  type="number"
                  min={MIN_COUNT}
                  max={MAX_COUNT}
                  value={count}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    setCount(Number.isFinite(n) ? n : DEFAULT_COUNT)
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  范围 {MIN_COUNT}-{MAX_COUNT} 个。建议 2-5 个，每个 800-1500 字。
                </p>
              </div>

              {/* Advanced options — hidden by default. Lets the user add a
                  chapter outline / specific direction the AI should follow.
                  Even when open, this remains optional. */}
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="flex items-center gap-1 self-start rounded text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                aria-expanded={advancedOpen}
              >
                <ChevronDown className={cn('h-3 w-3 transition-transform', advancedOpen && 'rotate-180')} />
                高级选项
              </button>
              {advancedOpen && (
                <div className="grid gap-1.5">
                  <label htmlFor="gen-desc" className="text-xs font-medium text-foreground">
                    章节描述 <span className="text-muted-foreground">（可选）</span>
                  </label>
                  <Textarea
                    id="gen-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={5}
                    placeholder="例如：主角在雨夜的咖啡馆偶遇旧友，发现他正在被人追杀；两人决定连夜逃离…… 留空则让 AI 自由发挥。"
                    autoFocus
                  />
                </div>
              )}

              <DialogFooter className="mt-2">
                <Button type="button" variant="outline" onClick={handleClose}>
                  取消
                </Button>
                <Button type="submit" disabled={!canStart}>
                  <Sparkles className="mr-1.5 h-4 w-4" />
                  生成
                </Button>
              </DialogFooter>
            </form>
          </>
        )}

        {step === 'generating' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                正在生成 {count} 个场景
              </DialogTitle>
              <DialogDescription>
                AI 正在按你的描述生成场景…可以随时取消，已生成的内容会丢弃。
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 overflow-y-auto">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-mono tabular-nums text-foreground">{state.text.length} 字</span>
                {state.usage?.completionTokens ? (
                  <>
                    <span>·</span>
                    <span className="font-mono tabular-nums">~{state.usage.completionTokens} tokens</span>
                  </>
                ) : null}
                <span>·</span>
                <span className="font-mono tabular-nums">{(state.elapsedMs / 1000).toFixed(1)}s</span>
                <span className="ml-auto font-mono tabular-nums text-foreground">{state.progressPct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${state.progressPct}%` }}
                />
              </div>
              <pre className="max-h-72 min-h-32 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-foreground">
                {state.text || '（等待 AI 输出…）'}
              </pre>
              {state.status === 'error' && state.errorMessage && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  {state.errorMessage}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleCancelStream}>
                <X className="mr-1.5 h-4 w-4" />
                取消
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'preview' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-600" />
                已生成 {parsedScenes.length} 个场景
              </DialogTitle>
              <DialogDescription>
                确认后将按顺序插入到当前章节末尾。点「应用」即跳到第一个新场景。
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 overflow-y-auto">
              {parsedScenes.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  AI 未输出可识别的场景（缺少 <code className="rounded bg-muted px-1">###</code> 标题）。
                  请点「重新生成」并细化描述。
                </div>
              ) : (
                parsedScenes.map((s, i) => {
                  const charCount = s.markdown.replace(/\s/g, '').length
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-md border bg-background px-3 py-2"
                    >
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {i + 1}
                      </Badge>
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.title}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {charCount} 字
                      </span>
                    </div>
                  )
                })
              )}
              {appliedResult && appliedResult.failedTitles.length > 0 && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
                  <p className="font-medium text-destructive">
                    {appliedResult.failedTitles.length} 个场景创建失败：
                  </p>
                  <ul className="mt-1 list-disc pl-4 text-xs text-destructive">
                    {appliedResult.failedTitles.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleRegenerate} disabled={applyLoading}>
                <RotateCcw className="mr-1.5 h-4 w-4" />
                重新生成
              </Button>
              <Button variant="outline" onClick={handleClose} disabled={applyLoading}>
                取消
              </Button>
              <Button
                onClick={handleApply}
                disabled={applyLoading || parsedScenes.length === 0}
                className={cn(applyLoading && 'opacity-60')}
              >
                {applyLoading ? (
                  <>
                    <div className="mr-1.5 h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    应用中…
                  </>
                ) : (
                  <>
                    <Check className="mr-1.5 h-4 w-4" />
                    应用 {parsedScenes.length > 0 ? `${parsedScenes.length} 个场景` : ''}
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
