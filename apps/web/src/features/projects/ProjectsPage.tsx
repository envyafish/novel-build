import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Plus, Sparkles } from 'lucide-react'
import { projectsApi } from './api.js'
import { ProjectCard } from './ProjectCard.js'
import { Layout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { usePrompt } from '@/components/ui/prompt-dialog'
import { useToast } from '@/components/ui/toast'

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || `novel-${Date.now().toString(36)}`
}

export function ProjectsPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { prompt } = usePrompt()
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  })
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    setCreating(true)
    try {
      const result = await prompt({
        title: '新建项目',
        description: '项目标识用于文件夹名称，创建后不可修改。',
        fields: [
          {
            name: 'name',
            label: '项目名称',
            placeholder: '《长河落日》',
            required: true,
            description: '可随时重命名。',
          },
          {
            name: 'slug',
            label: '项目标识',
            placeholder: 'chang-he-luo-ri',
            required: true,
            description: '小写字母、数字或连字符，留空自动生成。',
          },
        ],
        submitLabel: '创建',
      })
      if (!result) return
      const name = (result.name ?? '').trim()
      let slug = (result.slug ?? '').trim()
      if (!slug) slug = slugify(name)
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
        toast({ kind: 'error', title: '项目标识不合法', description: '仅限小写字母、数字、连字符。' })
        return
      }
      const created = await projectsApi.create(name, slug)
      qc.invalidateQueries({ queryKey: ['projects'] })
      toast({ kind: 'success', title: '项目已创建', description: created.name })
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('slug_taken')) {
        toast({ kind: 'error', title: '项目标识已被占用' })
      } else {
        toast({ kind: 'error', title: '创建失败', description: msg })
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <Layout>
      <div className="mx-auto max-w-3xl space-y-8 p-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <BookOpen className="h-6 w-6" />
              我的项目
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">所有数据保存在本地 {`~/Novels/<slug>/`}。</p>
          </div>
          <Button onClick={handleCreate} disabled={creating}>
            <Plus className="h-4 w-4" /> 新建项目
          </Button>
        </div>

        {isLoading ? (
          <p className="text-muted-foreground">读取中…</p>
        ) : projects.length === 0 ? (
          <EmptyProjectsState onCreate={handleCreate} disabled={creating} />
        ) : (
          <div className="grid gap-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}

function EmptyProjectsState({ onCreate, disabled }: { onCreate: () => void; disabled: boolean }) {
  return (
    <div className="rounded-xl border border-dashed bg-muted/30 p-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-5 w-5" />
      </div>
      <h2 className="mt-4 text-lg font-semibold">开始你的第一部小说</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        创建项目后会自动生成第一卷与第一章大纲；你可以在编辑页继续添加场景并开始写作。
      </p>
      <Button className="mt-5" onClick={onCreate} disabled={disabled}>
        <Plus className="h-4 w-4" /> 新建项目
      </Button>
    </div>
  )
}
