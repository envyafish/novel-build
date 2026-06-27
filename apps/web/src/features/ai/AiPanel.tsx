import { useState } from 'react'
import type { CompletionMode } from '@novel/shared'
import type { AiStreamState } from '../../hooks/useAiStream.js'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Sparkles, X, RotateCcw, Check, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Scene-level editing modes. `selectionOnly: true` modes (polish/rewrite/expand/condense)
 * operate on the current selection when one is set; otherwise they operate on the
 * whole scene content.
 *
 * Other modes that lived in the old Sheet drawer were intentionally removed
 * when this sidebar replaced it:
 *  - generate_chapter / suggest_next_chapter: chapter-level flows, triggered
 *    from the outline sidebar (right-click chapter → review / extract).
 *  - generate_scene: also chapter-level.
 *  - "save to world" extraction: chapter-level extract dialog.
 *  - analyze_voice / plan_story_arc: project-level flows, triggered from the
 *    story-arc panel and world panel respectively.
 */
const EDIT_MODES: { id: 'continue' | 'polish' | 'rewrite' | 'expand' | 'condense'; label: string; description: string; selectionOnly?: boolean }[] = [
  { id: 'continue', label: '续写', description: '从结尾继续写', selectionOnly: false },
  { id: 'polish', label: '润色', description: '保留原意优化', selectionOnly: true },
  { id: 'rewrite', label: '重写', description: '相同含义新措辞', selectionOnly: true },
  { id: 'expand', label: '扩写', description: '1.5x~2x 展开', selectionOnly: true },
  { id: 'condense', label: '压缩', description: '精简到一半', selectionOnly: true },
]

interface AiSidebarProps {
  sceneId: number
  model: string
  content: string
  selection: string | null
  /** Shared AI stream state managed by EditorPage — keeps running when sidebar is rerendered. */
  aiState: AiStreamState
  aiStart: (body: object) => Promise<void>
  aiCancel: () => Promise<void>
  aiReset: () => void
  aiAccept: () => Promise<void>
  /** Called when the user accepts the generated text. Only the 5 edit modes are
   *  possible (continue/polish/rewrite/expand/condense) — `mode` is forwarded
   *  to EditorPage.applyAcceptedText for logging / future scope-aware behavior. */
  onAccept: (text: string, mode: CompletionMode) => void
  /** Width in pixels — owned by EditorPage's `useResizable` so the value
   *  persists across sessions. */
  width: number
  /** Spread onto the left-edge drag handle. */
  handleProps: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
    role: 'separator'
    'aria-orientation': 'vertical'
  }
}

export function AiSidebar({
  sceneId,
  model,
  content,
  selection,
  aiState: state,
  aiStart: start,
  aiCancel: cancel,
  aiReset: reset,
  aiAccept: accept,
  onAccept,
  width,
  handleProps,
}: AiSidebarProps) {
  // The sidebar tracks which mode was last kicked off so the accept button
  // can label itself correctly (continue → "接受并续写"; otherwise → "接受并替换").
  const [lastMode, setLastMode] = useState<CompletionMode>('continue')
  const hasSelection = !!(selection && selection.trim().length > 0)
  const streaming = state.status === 'streaming'

  const handleEdit = (mode: 'continue' | 'polish' | 'rewrite' | 'expand' | 'condense') => {
    setLastMode(mode)
    const modeDef = EDIT_MODES.find((m) => m.id === mode)
    if (modeDef?.selectionOnly && hasSelection) {
      void start({ sceneId, mode, model, inputText: selection ?? '' })
    } else {
      void start({ sceneId, mode, model, inputText: content })
    }
  }

  const handleAccept = () => {
    onAccept(state.text, lastMode)
    void accept()
  }

  const handleReset = () => {
    reset()
    setLastMode('continue')
  }

  const handleCancel = async () => {
    await cancel()
    setLastMode('continue')
  }

  return (
    <aside
      className="relative flex shrink-0 flex-col overflow-hidden border-l bg-background"
      style={{ width }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <Sparkles className="h-4 w-4" />
        <h2 className="text-sm font-semibold">AI 助手</h2>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {/* Selection banner */}
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

        {/* Edit mode buttons */}
        <div className="space-y-2">
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
                <Button variant="ghost" size="sm" onClick={handleCancel}>
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

            {/* Actions */}
            <div className="flex gap-2">
              {state.status === 'done' && (
                <Button onClick={handleAccept} className="flex-1">
                  <Check className="mr-1.5 h-4 w-4" />
                  接受并{lastMode === 'continue' ? '续写' : '替换'}
                </Button>
              )}
              {(state.status === 'done' || state.status === 'error') && (
                <Button variant="outline" onClick={handleReset}>
                  <RotateCcw className="mr-1.5 h-4 w-4" />
                  重置
                </Button>
              )}
            </div>
          </>
        )}
      </div>
      {/* Left-edge drag handle (this sidebar sits on the right of the screen). */}
      <div
        {...handleProps}
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-primary/30 active:bg-primary/50"
      />
    </aside>
  )
}
