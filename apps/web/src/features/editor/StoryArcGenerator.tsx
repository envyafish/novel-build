import { useEffect, useState } from 'react'
import { Sparkles, Wand2, Loader2, Check, XCircle, RotateCw, ClipboardCopy, AlertTriangle } from 'lucide-react'
import { api } from '../../api/client.js'
import { useAiStream } from '../../hooks/useAiStream.js'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { stripThinking } from '@novel/shared'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  model: string
}

export function StoryArcGenerator({ open, onOpenChange, projectId, model }: Props) {
  const [premise, setPremise] = useState('')
  const { state, start, cancel, reset } = useAiStream()
  const [saving, setSaving] = useState(false)

  // Manual-edit fallback: if AI output fails some downstream step, let user
  // edit the markdown before saving.
  const [editMode, setEditMode] = useState(false)
  const [editedText, setEditedText] = useState('')
  const [editError, setEditError] = useState<string | null>(null)

  const { toast } = useToast()

  const handleGenerate = () => {
    if (!premise.trim()) return
    reset()
    setEditMode(false)
    setEditError(null)
    setEditedText('')
    start({
      projectId,
      mode: 'plan_story_arc',
      model,
      inputText: premise.trim(),
    })
  }

  const currentText = editMode ? editedText : state.text

  const saveArc = async (text: string) => {
    setSaving(true)
    try {
      await api(`/api/projects/${projectId}/story-arc`, {
        method: 'PATCH',
        body: JSON.stringify({ storyArcNotes: text }),
      })
      setEditMode(false)
      setEditError(null)
      onOpenChange(false)
      toast({ kind: 'success', title: '故事弧线笔记已保存' })
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    try {
      await saveArc(state.text)
    } catch (e) {
      setEditedText(state.text)
      setEditMode(true)
      setEditError((e as Error).message)
    }
  }

  const handleReSave = async () => {
    setEditError(null)
    try {
      await saveArc(editedText)
    } catch (e) {
      setEditError((e as Error).message)
    }
  }

  const handleRegenerate = () => {
    handleGenerate()
  }

  const handleCancelEdit = () => {
    setEditMode(false)
    setEditError(null)
    setEditedText('')
  }

  const handleCopyRaw = async () => {
    try {
      await navigator.clipboard.writeText(currentText)
      toast({ kind: 'info', title: '已复制原始输出', durationMs: 2000 })
    } catch {
      toast({ kind: 'error', title: '复制失败', description: '请手动选择文本复制' })
    }
  }

  const handleClose = () => {
    // While AI is streaming, treat close as a cancel — abort the fetch,
    // drop the partial output, and reset local state. Without this the
    // user could close the dialog mid-stream and the next time they open
    // it the partially-streamed text would be visible again from the
    // hook's stale state.
    if (state.status === 'streaming') {
      void cancel()
    }
    onOpenChange(false)
    reset()
    setEditMode(false)
    setEditError(null)
    setEditedText('')
    setPremise('')
  }

  useEffect(() => {
    if (editMode && !editedText && state.text) {
      setEditedText(state.text)
    }
  }, [editMode, editedText, state.text])

  // "Busy" covers both the AI generation stream AND the PATCH call that
  // saves the result. While busy, the user can't close the dialog via
  // outside click / Esc — they have to either cancel the stream or wait
  // for the save to complete. This mirrors the same pattern as
  // GenerateScenesDialog.
  const busy = state.status === 'streaming' || saving

  // View selection
  const showInputForm = !editMode && state.status !== 'streaming' && state.status !== 'done' && state.status !== 'error'
  const showStreaming = !editMode && state.status === 'streaming'
  const showPreview = !editMode && state.status === 'done'
  const showAiError = !editMode && state.status === 'error'
  const showEditMode = editMode

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o || !busy) {
          if (!o) handleClose()
          else onOpenChange(true)
        }
      }}
    >
      <DialogContent
        className="max-w-lg max-h-[80vh] overflow-y-auto"
        onInteractOutside={(e) => {
          if (busy) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            生成故事弧线笔记
          </DialogTitle>
          <DialogDescription>
            描述你的小说设定，AI 将规划出多卷多章的故事弧线（每卷核心冲突、每章情节概述、伏笔布局、人物成长线）。
          </DialogDescription>
        </DialogHeader>

        {showEditMode ? (
          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 p-3">
              <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">保存失败,可以手动修正后重试</p>
                  <p className="mt-0.5 text-xs opacity-80">
                    下面的文本框已预填 AI 原始输出。修正后点"重新保存"。
                  </p>
                </div>
              </div>
            </div>
            <Textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              rows={14}
              className="font-mono text-xs leading-relaxed"
              spellCheck={false}
            />
            {editError && <p className="text-xs text-destructive">保存错误:{editError}</p>}
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleReSave} disabled={saving} className="flex-1 min-w-[120px]">
                {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                {saving ? '保存中…' : '重新保存'}
              </Button>
              <Button variant="outline" onClick={handleRegenerate} className="flex-1 min-w-[120px]">
                <RotateCw className="mr-1.5 h-4 w-4" />
                重新生成
              </Button>
              <Button variant="outline" onClick={handleCopyRaw}>
                <ClipboardCopy className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={handleCancelEdit} className="flex-1">
                返回预览
              </Button>
            </div>
          </div>
        ) : showAiError ? (
          <div className="space-y-4 py-4">
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
                <XCircle className="h-4 w-4" />
                生成失败
              </div>
              <p className="mt-2 text-xs text-destructive/80">{state.errorMessage || '未知错误'}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleGenerate} className="flex-1">
                重试
              </Button>
            </div>
          </div>
        ) : showStreaming ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <div className="h-2 w-2 animate-spin rounded-full border border-primary border-t-transparent" />
                  AI 正在规划故事弧线…
                </span>
                <span className="font-mono tabular-nums">
                  {state.text.length} 字 · {Math.round(state.elapsedMs / 1000)}s
                  {state.progressPct > 0 && ` · ${state.progressPct}%`}
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-background">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${state.progressPct || Math.min(95, (state.text.length / 8000) * 100)}%` }}
                />
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <pre className="whitespace-pre-wrap text-xs leading-relaxed max-h-48 overflow-y-auto">
                {state.text}
              </pre>
            </div>
            <Button variant="outline" size="sm" onClick={cancel} className="w-full">
              取消生成
            </Button>
          </div>
        ) : showPreview ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">生成完成</span>
                <span className="font-mono tabular-nums">
                  {state.text.length} 字 · {Math.round(state.elapsedMs / 1000)}s
                </span>
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2">AI 生成的故事弧线预览：</p>
              <pre className="whitespace-pre-wrap text-xs leading-relaxed max-h-64 overflow-y-auto">
                {stripThinking(state.text)}
              </pre>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                {saving ? '保存中…' : '保存到项目'}
              </Button>
              <Button variant="outline" onClick={handleGenerate} disabled={saving}>
                <RotateCw className="mr-1.5 h-4 w-4" />
                重新生成
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Textarea
              value={premise}
              onChange={(e) => setPremise(e.target.value)}
              placeholder="描述你的小说设定，例如：&#10;&#10;修仙世界，天才少年因家族被灭而踏上复仇之路……"
              rows={6}
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Wand2 className="h-3.5 w-3.5" />
              越详细的设定，规划出的弧线越贴合你的预期
            </div>
          </div>
        )}

        {showInputForm && (
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>取消</Button>
            <Button onClick={handleGenerate} disabled={!premise.trim()}>
              <Sparkles className="mr-1.5 h-4 w-4" />
              开始生成
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}