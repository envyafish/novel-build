import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles, Wand2, Loader2, Check, BookOpen, XCircle } from 'lucide-react'
import { api } from '../../api/client.js'
import { useAiStream } from '../../hooks/useAiStream.js'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
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

export function SkeletonGenerator({ open, onOpenChange, projectId, model }: Props) {
  const [premise, setPremise] = useState('')
  const { state, start, cancel, reset } = useAiStream()
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; counts?: Record<string, number> } | null>(null)
  const qc = useQueryClient()
  const { toast } = useToast()
  const navigate = useNavigate()

  const handleGenerate = () => {
    if (!premise.trim()) return
    reset()
    start({
      sceneId: 1, // dummy — skeleton mode doesn't need real scene
      mode: 'generate_novel_skeleton',
      model,
      inputText: premise.trim(),
      draftProjectId: projectId,
    })
  }

  const handleSave = async () => {
    if (!state.text) return
    setSaving(true)
    try {
      // Parse JSON from AI output
      const jsonMatch = state.text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('无法解析 AI 输出的 JSON')
      const data = JSON.parse(jsonMatch[0])

      const res = await api<{ ok: boolean; counts: Record<string, number> }>(
        `/api/projects/${projectId}/generate-skeleton`,
        { method: 'POST', body: JSON.stringify(data) },
      )

      setResult(res)
      qc.invalidateQueries({ queryKey: ['outline', projectId] })
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      toast({ kind: 'success', title: '小说骨架已生成！' })
    } catch (e) {
      toast({ kind: 'error', title: '保存失败', description: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    if (result) {
      qc.invalidateQueries({ queryKey: ['outline', projectId] })
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      onOpenChange(false)
      navigate('/projects', { replace: true })
    } else {
      onOpenChange(false)
      reset()
      setResult(null)
      setPremise('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            一键生成小说骨架
          </DialogTitle>
          <DialogDescription>
            描述你的小说设定，AI 将自动生成人物、世界观、时间线和大纲结构。
          </DialogDescription>
        </DialogHeader>

        {result ? (
          /* Success result */
          <div className="space-y-4 py-4">
            <div className="rounded-lg border bg-green-50 dark:bg-green-950/20 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-green-700 dark:text-green-300">
                <Check className="h-4 w-4" />
                生成成功！
              </div>
              <ul className="mt-2 space-y-1 text-sm text-green-600 dark:text-green-400">
                {result.counts?.characters ? <li>👤 {result.counts.characters} 个人物</li> : null}
                {result.counts?.worldElements ? <li>🌍 {result.counts.worldElements} 个世界观设定</li> : null}
                {result.counts?.timeline ? <li>📅 {result.counts.timeline} 个时间线事件</li> : null}
                {result.counts?.volumes ? <li>📚 {result.counts.volumes} 卷</li> : null}
                {result.counts?.chapters ? <li>📖 {result.counts.chapters} 章</li> : null}
                {result.counts?.scenes ? <li>🎬 {result.counts.scenes} 个场景</li> : null}
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">
              所有内容已保存到世界观数据库和大纲中，可在编辑器中查看和修改。
            </p>
          </div>
        ) : state.status === 'error' ? (
          /* Error state */
          <div className="space-y-4 py-4">
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
                <XCircle className="h-4 w-4" />
                生成失败
              </div>
              <p className="mt-2 text-xs text-destructive/80">{state.errorMessage || '未知错误'}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { reset(); setResult(null) }} className="flex-1">
                重试
              </Button>
            </div>
          </div>
        ) : state.status === 'streaming' || state.status === 'done' ? (
          /* AI output preview */
          <div className="space-y-4">
            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  {state.status === 'streaming' && (
                    <div className="h-2 w-2 animate-spin rounded-full border border-primary border-t-transparent" />
                  )}
                  {state.status === 'streaming' ? 'AI 正在生成骨架…' : '生成完成'}
                </span>
                <span className="font-mono tabular-nums">
                  {state.text.length} 字 · {Math.round(state.elapsedMs / 1000)}s
                  {state.progressPct > 0 && ` · ${state.progressPct}%`}
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-background">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${state.status === 'done' ? 100 : state.progressPct || Math.min(95, (state.text.length / 8000) * 100)}%` }}
                />
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2">AI 生成的大纲预览：</p>
              <pre className="whitespace-pre-wrap text-xs leading-relaxed max-h-48 overflow-y-auto">
                {state.text}
              </pre>
            </div>
            {state.status === 'done' && (
              <div className="flex gap-2">
                <Button onClick={handleSave} disabled={saving} className="flex-1">
                  {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                  {saving ? '保存中…' : '保存并进入编辑器'}
                </Button>
                <Button variant="outline" onClick={() => { reset(); setResult(null) }}>
                  重新生成
                </Button>
              </div>
            )}
            {state.status === 'streaming' && (
              <Button variant="outline" size="sm" onClick={cancel} className="w-full">
                取消生成
              </Button>
            )}
          </div>
        ) : (
          /* Input form */
          <div className="space-y-4">
            <Textarea
              value={premise}
              onChange={(e) => setPremise(e.target.value)}
              placeholder="描述你的小说设定，例如：&#10;&#10;修仙世界，天才少年因家族被灭而踏上复仇之路。在这个以灵气为根基的大陆上，修炼分为炼气、筑基、金丹、元婴等境界。主角在旅途中结识伙伴，逐渐揭开家族覆灭的阴谋，最终发现背后是整个修仙界秩序崩塌的征兆…"
              rows={6}
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Wand2 className="h-3.5 w-3.5" />
              越详细的设定，生成的骨架越符合你的预期
            </div>
          </div>
        )}

        {!result && state.status !== 'streaming' && state.status !== 'done' && (
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
