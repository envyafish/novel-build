import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { History, RotateCcw, Clock, GitCompare, X, ArrowRight } from 'lucide-react'
import { api } from '../../api/client.js'
import type { SnapshotMetaDto, SnapshotDiffDto } from '@novel/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'

interface SnapshotHistoryProps {
  sceneId: number
  onRestore: (markdown: string, baseHash?: string) => void
}

export function SnapshotHistory({ sceneId, onRestore }: SnapshotHistoryProps) {
  const [open, setOpen] = useState(false)
  const [compareMode, setCompareMode] = useState(false)
  const [selectedA, setSelectedA] = useState<string | null>(null)
  const [selectedB, setSelectedB] = useState<string | null>(null)
  const [diffResult, setDiffResult] = useState<SnapshotDiffDto | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ['snapshots', sceneId],
    queryFn: () => api<SnapshotMetaDto[]>(`/api/scenes/${sceneId}/snapshots`),
    enabled: open && sceneId > 0,
  })

  const handleRestore = async (hash: string) => {
    try {
      const result = await api<{ markdown: string; baseHash: string }>(`/api/scenes/${sceneId}/snapshots/${hash}/restore`, { method: 'POST' })
      onRestore(result.markdown, result.baseHash)
      setOpen(false)
    } catch (e) {
      toast({ kind: 'error', title: '恢复失败: ' + (e as Error).message })
    }
  }

  const handleSelect = (hash: string) => {
    if (!selectedA) {
      setSelectedA(hash)
    } else if (!selectedB && hash !== selectedA) {
      setSelectedB(hash)
    } else if (hash === selectedA) {
      setSelectedA(selectedB)
      setSelectedB(null)
    } else if (hash === selectedB) {
      setSelectedB(null)
    }
  }

  const handleCompare = async () => {
    if (!selectedA || !selectedB) return
    setDiffLoading(true)
    try {
      const result = await api<SnapshotDiffDto>(
        `/api/scenes/${sceneId}/snapshots/diff?hashA=${selectedA}&hashB=${selectedB}`
      )
      setDiffResult(result)
    } catch (e) {
      toast({ kind: 'error', title: '对比失败: ' + (e as Error).message })
    } finally {
      setDiffLoading(false)
    }
  }

  const resetCompare = () => {
    setCompareMode(false)
    setSelectedA(null)
    setSelectedB(null)
    setDiffResult(null)
  }

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso)
      if (isNaN(d.getTime())) return '时间未知'
      const now = new Date()
      const diffMs = now.getTime() - d.getTime()
      // Handle future dates (clock skew)
      if (diffMs < 0) return '刚刚'
      const diffSecs = Math.floor(diffMs / 1000)
      const diffMins = Math.floor(diffSecs / 60)
      const diffHours = Math.floor(diffMins / 60)
      const diffDays = Math.floor(diffHours / 24)

      if (diffSecs < 60) return '刚刚'
      if (diffMins < 60) return `${diffMins} 分钟前`
      if (diffHours < 24) return `${diffHours} 小时前`
      if (diffDays < 7) return `${diffDays} 天前`
      // Show actual date for older snapshots
      return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch {
      return '时间未知'
    }
  }

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7"
        onClick={() => setOpen(!open)}
        aria-label="快照历史"
        title="快照历史"
      >
        <History className="h-3.5 w-3.5" />
      </Button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); resetCompare() }} />

          {/* Panel */}
          <Card className="absolute right-0 top-8 z-50 w-96 shadow-lg">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4" />
                  快照历史
                </div>
                <div className="flex items-center gap-1">
                  {compareMode && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={resetCompare}
                    >
                      <X className="h-3 w-3 mr-1" />
                      退出对比
                    </Button>
                  )}
                  {!compareMode && snapshots.length >= 2 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={() => setCompareMode(true)}
                    >
                      <GitCompare className="h-3 w-3 mr-1" />
                      对比
                    </Button>
                  )}
                </div>
              </CardTitle>
              {compareMode && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  选择两个版本进行对比（先选旧版本，再选新版本）
                </p>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {diffResult ? (
                <DiffView
                  diff={diffResult}
                  onBack={() => setDiffResult(null)}
                  onRestore={() => handleRestore(diffResult.b.hash)}
                  formatTime={formatTime}
                />
              ) : (
                <>
                  <div className="max-h-80 overflow-y-auto">
                    {isLoading ? (
                      <div className="p-3 text-xs text-muted-foreground">加载中…</div>
                    ) : snapshots.length === 0 ? (
                      <div className="p-3 text-xs text-muted-foreground">暂无快照</div>
                    ) : (
                      <div className="divide-y">
                        {snapshots.map((s) => {
                          const isA = selectedA === s.hash
                          const isB = selectedB === s.hash
                          return (
                            <div
                              key={s.hash}
                              className={`flex items-center gap-2 p-2.5 transition-colors ${
                                isA ? 'bg-blue-50 dark:bg-blue-950/30' :
                                isB ? 'bg-green-50 dark:bg-green-950/30' :
                                'hover:bg-accent'
                              } ${compareMode ? 'cursor-pointer' : ''}`}
                              onClick={() => compareMode && handleSelect(s.hash)}
                            >
                              {compareMode && (
                                <div className="shrink-0">
                                  {isA ? (
                                    <Badge variant="default" className="text-[10px] bg-blue-500">A</Badge>
                                  ) : isB ? (
                                    <Badge variant="default" className="text-[10px] bg-green-500">B</Badge>
                                  ) : (
                                    <div className="h-4 w-4 rounded border border-dashed border-muted-foreground/30" />
                                  )}
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
                                  <span className="text-xs text-muted-foreground" title={new Date(s.createdAt).toLocaleString('zh-CN')}>
                                    {formatTime(s.createdAt)}
                                  </span>
                                  <Badge variant={s.kind === 'manual' ? 'default' : 'secondary'} className="text-[10px]">
                                    {s.kind === 'manual' ? '手动' : '自动'}
                                  </Badge>
                                </div>
                                <p className="mt-0.5 text-[10px] text-muted-foreground font-mono truncate">{s.hash.slice(0, 12)}…</p>
                              </div>
                              {!compareMode && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 shrink-0"
                                  onClick={(e) => { e.stopPropagation(); handleRestore(s.hash) }}
                                >
                                  <RotateCcw className="mr-1 h-3 w-3" />
                                  恢复
                                </Button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  {compareMode && selectedA && selectedB && (
                    <div className="border-t p-2">
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={handleCompare}
                        disabled={diffLoading}
                      >
                        <GitCompare className="mr-1.5 h-3.5 w-3.5" />
                        {diffLoading ? '对比中…' : '查看差异'}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function DiffView({
  diff,
  onBack,
  onRestore,
  formatTime,
}: {
  diff: SnapshotDiffDto
  onBack: () => void
  onRestore: () => void
  formatTime: (iso: string) => string
}) {
  return (
    <div className="flex flex-col max-h-[32rem]">
      {/* Header */}
      <div className="flex items-center gap-2 border-b p-2.5 text-xs">
        <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950/30 text-[10px]">
          A: {formatTime(diff.a.createdAt)}
        </Badge>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <Badge variant="outline" className="bg-green-50 dark:bg-green-950/30 text-[10px]">
          B: {formatTime(diff.b.createdAt)}
        </Badge>
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-y-auto p-3 leading-relaxed text-sm">
        {diff.lines.map((line, i) => {
          if (line.kind === 'eq') {
            return (
              <span key={i}>
                {line.text}
              </span>
            )
          }
          if (line.kind === 'del') {
            return (
              <span
                key={i}
                className="line-through bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded-sm px-0.5"
              >
                {line.text}
              </span>
            )
          }
          // add
          return (
            <span
              key={i}
              className="bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300 rounded-sm px-0.5"
            >
              {line.text}
            </span>
          )
        })}
      </div>

      {/* Actions */}
      <div className="flex gap-2 border-t p-2">
        <Button size="sm" variant="ghost" className="flex-1 h-7 text-xs" onClick={onBack}>
          返回列表
        </Button>
        <Button size="sm" className="flex-1 h-7 text-xs" onClick={onRestore}>
          <RotateCcw className="mr-1 h-3 w-3" />
          恢复到 B
        </Button>
      </div>
    </div>
  )
}
