import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen,
  FileText,
  Sparkles,
  Settings as SettingsIcon,
  Target,
  type LucideIcon,
} from 'lucide-react'
import { projectsApi } from '../projects/api.js'
import { cn } from '@/lib/utils'

interface Props {
  projectId: number
  projectName: string
  projectSlug: string
}

export function ProjectStatsCard({ projectId, projectName, projectSlug }: Props) {
  const navigate = useNavigate()
  const stats = useQuery({
    queryKey: ['stats', projectId],
    queryFn: () => projectsApi.stats(projectId),
    staleTime: 30_000,
  })

  const goal = stats.data?.goal
  const hasGoal = goal && goal.daily_target_words > 0
  const todayWords = stats.data?.todayWords ?? 0

  return (
    <div className="border-b bg-background/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{projectName}</h2>
          <p className="font-mono text-[10px] text-muted-foreground">{projectSlug}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate(`/projects/${projectId}/settings`)}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="项目设置"
          title="项目设置"
        >
          <SettingsIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1 text-center">
        <Stat icon={BookOpen} label="章" value={stats.data?.chapters ?? 0} loading={stats.isLoading} />
        <Stat icon={FileText} label="场" value={stats.data?.scenes ?? 0} loading={stats.isLoading} />
        <Stat
          icon={Sparkles}
          label="字"
          value={stats.data?.words ?? 0}
          loading={stats.isLoading}
          format
        />
      </div>
      {hasGoal && (
        <div className="mt-2 rounded-md border bg-muted/30 p-2">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Target className="h-3 w-3" />
            <span>每日目标 {goal.daily_target_words.toLocaleString()} 字</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                todayWords >= goal.daily_target_words ? 'bg-green-500' : 'bg-primary',
              )}
              style={{ width: `${Math.min(100, (todayWords / goal.daily_target_words) * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  loading,
  format,
}: {
  icon: LucideIcon
  label: string
  value: number
  loading: boolean
  format?: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-md border bg-muted/30 px-1 py-1.5">
      <Icon className="h-3 w-3 text-muted-foreground" />
      <span className="font-mono text-xs font-semibold tabular-nums">
        {loading ? '–' : format ? value.toLocaleString() : value}
      </span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  )
}
