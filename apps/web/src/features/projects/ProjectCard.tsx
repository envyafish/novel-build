import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { BookOpen, MoreHorizontal, Trash2, Pencil, Download } from 'lucide-react'
import { useState } from 'react'
import type { ProjectDto } from '@novel/shared'
import { projectsApi, type ProjectStatsDto } from './api.js'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { usePrompt } from '@/components/ui/prompt-dialog'
import { ExportDialog } from './ExportDialog.js'
interface Props {
  project: ProjectDto
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const diff = Date.now() - t
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return new Date(iso).toLocaleDateString('zh-CN')
}

export function ProjectCard({ project }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const { prompt } = usePrompt()
  const [menuOpen, setMenuOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const stats = useQuery({
    queryKey: ['stats', project.id],
    queryFn: () => projectsApi.stats(project.id),
    staleTime: 30_000,
  })

  const handleDelete = async () => {
    const ok = await confirm({
      title: '删除项目？',
      description: `项目 “${project.name}” 及其大纲、章节、场景与磁盘草稿将被永久删除。`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      destructive: true,
    })
    if (!ok) return
    try {
      await projectsApi.remove(project.id)
      qc.invalidateQueries({ queryKey: ['projects'] })
      toast({ kind: 'success', title: '项目已删除' })
    } catch (e) {
      toast({ kind: 'error', title: '删除失败', description: (e as Error).message })
    }
  }

  const handleRename = async () => {
    const result = await prompt({
      title: '重命名项目',
      description: '修改项目显示名称。',
      fields: [{ name: 'name', label: '项目名称', defaultValue: project.name, required: true }],
      submitLabel: '保存',
    })
    if (!result) return
    try {
      await projectsApi.rename(project.id, result.name ?? project.name)
      qc.invalidateQueries({ queryKey: ['projects'] })
      toast({ kind: 'success', title: '已重命名' })
    } catch (e) {
      toast({ kind: 'error', title: '重命名失败', description: (e as Error).message })
    }
  }

  return (
    <>
    <Card className="group transition-colors hover:bg-accent/30">
      <CardContent className="flex items-center gap-3 p-4">
        <Link to={`/projects/${project.id}`} className="flex flex-1 items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <BookOpen className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-semibold leading-tight">{project.name}</h3>
              <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
                {project.slug}
              </Badge>
            </div>
            <ProjectStatsLine
              stats={stats.data}
              isLoading={stats.isLoading}
              updatedAt={project.updatedAt}
            />
          </div>
        </Link>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 opacity-60 transition-opacity group-hover:opacity-100"
              aria-label="项目操作"
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(true)
              }}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                setMenuOpen(false)
                void handleRename()
              }}
            >
              <Pencil className="h-3.5 w-3.5" /> 重命名
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setMenuOpen(false)
                setExportOpen(true)
              }}
            >
              <Download className="h-3.5 w-3.5" /> 导出
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => {
                setMenuOpen(false)
                void handleDelete()
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> 删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardContent>
    </Card>
    <ExportDialog
      open={exportOpen}
      onOpenChange={setExportOpen}
      projectId={project.id}
      projectName={project.name}
    />
    </>
  )
}

function ProjectStatsLine({
  stats,
  isLoading,
  updatedAt,
}: {
  stats: ProjectStatsDto | undefined
  isLoading: boolean
  updatedAt: string
}) {
  if (isLoading || !stats) {
    return <p className="mt-0.5 text-xs text-muted-foreground">读取统计中…</p>
  }
  const words = stats.words ?? 0
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
      <span>{stats.chapters} 章</span>
      <span aria-hidden>·</span>
      <span>{stats.scenes} 场</span>
      <span aria-hidden>·</span>
      <span>{words.toLocaleString()} 字</span>
      <span aria-hidden>·</span>
      <span>更新于 {formatRelative(updatedAt)}</span>
    </p>
  )
}
