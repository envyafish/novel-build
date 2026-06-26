import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { Save, ArrowLeft, Bot, Sliders, MessageSquare, Plus, Trash2, Star, Palette, Target } from 'lucide-react'
import { aiApi, type ProviderFullInfo } from '../ai/api.js'
import { api } from '../../api/client.js'
import type { ProjectDto } from '@novel/shared'
import { Layout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'

export function SettingsPage() {
  const params = useParams()
  const projectId = Number(params.id)
  const qc = useQueryClient()

  const settings = useQuery({
    queryKey: ['ai', projectId],
    queryFn: () => aiApi.getSettings(projectId),
    enabled: projectId > 0,
  })
  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api<ProjectDto>(`/api/projects/${projectId}`),
    enabled: projectId > 0,
  })
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: aiApi.providers,
  })
  const stats = useQuery({
    queryKey: ['stats', projectId],
    queryFn: () => api<{ goal: { daily_target_words: number; weekly_target_scenes: number } }>(`/api/projects/${projectId}/stats`),
    enabled: projectId > 0,
  })

  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [contextPrevChars, setContextPrevChars] = useState(1500)
  const [theme, setTheme] = useState('')
  const [dailyTarget, setDailyTarget] = useState(2000)
  const [weeklyTarget, setWeeklyTarget] = useState(5)
  const [showAddForm, setShowAddForm] = useState(false)

  useEffect(() => {
    if (settings.data) {
      setProviderId(settings.data.providerId)
      setModel(settings.data.model)
      setSystemPrompt(settings.data.systemPrompt)
      setContextPrevChars(settings.data.contextPrevChars)
    }
  }, [settings.data])

  useEffect(() => {
    if (project.data) {
      setTheme(project.data.theme ?? '')
    }
  }, [project.data])

  useEffect(() => {
    if (stats.data?.goal) {
      setDailyTarget(stats.data.goal.daily_target_words)
      setWeeklyTarget(stats.data.goal.weekly_target_scenes)
    }
  }, [stats.data?.goal])

  const put = useMutation({
    mutationFn: () => aiApi.putSettings({ projectId, providerId, model, systemPrompt, contextPrevChars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai', projectId] }),
  })

  const saveTheme = useMutation({
    mutationFn: () => api<ProjectDto>(`/api/projects/${projectId}/theme`, { method: 'PATCH', body: JSON.stringify({ theme }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }),
  })

  const saveGoal = useMutation({
    mutationFn: () => api<{ ok: boolean }>(`/api/projects/${projectId}/writing-goal`, {
      method: 'PUT',
      body: JSON.stringify({ dailyTargetWords: dailyTarget, weeklyTargetScenes: weeklyTarget }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stats', projectId] }),
  })

  const addProvider = useMutation({
    mutationFn: (p: { id: string; label: string; baseUrl: string; apiKey: string }) => aiApi.addProvider(p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providers'] })
      setShowAddForm(false)
    },
  })

  const removeProvider = useMutation({
    mutationFn: (id: string) => aiApi.removeProvider(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['providers'] }),
  })

  const setDefault = useMutation({
    mutationFn: (id: string) => aiApi.setDefault(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['providers'] }),
  })

  if (settings.isLoading) {
    return (
      <Layout projectId={projectId}>
        <div className="p-8 text-muted-foreground">Loading…</div>
      </Layout>
    )
  }
  if (settings.error || !settings.data) {
    return (
      <Layout projectId={projectId}>
        <div className="p-8 text-destructive">加载设置失败: {(settings.error as Error)?.message ?? '未知错误'}</div>
      </Layout>
    )
  }

  return (
    <Layout breadcrumbs={[{ label: 'AI 设置', href: `/projects/${projectId}` }]} projectId={projectId}>
      <div className="mx-auto max-w-2xl space-y-6 p-8">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to={`/projects/${projectId}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AI 设置</h1>
            <p className="text-sm text-muted-foreground">配置 AI 提供商、模型和写作参数</p>
          </div>
        </div>

        <Separator />

        {/* Theme */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              小说主题
            </CardTitle>
            <CardDescription>
              核心主题思想，AI 在生成和一致性检查时会参考此设定。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              rows={3}
              placeholder="例如：成长与牺牲——在命运的洪流中，每个人都在寻找自己的意义，而真正的强大来自于为他人承担责任的勇气。"
            />
            <Button size="sm" onClick={() => saveTheme.mutate()} disabled={saveTheme.isPending}>
              <Save className="mr-1 h-3 w-3" />
              {saveTheme.isPending ? '保存中…' : '保存主题'}
            </Button>
            {saveTheme.isSuccess && <span className="text-sm text-green-600 dark:text-green-400">已保存 ✓</span>}
          </CardContent>
        </Card>

        {/* Writing Goals */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              写作目标
            </CardTitle>
            <CardDescription>
              设定每日写作目标，追踪创作进度。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">每日字数目标</label>
                <Input
                  type="number"
                  value={dailyTarget}
                  onChange={(e) => setDailyTarget(Number(e.target.value))}
                  min={0}
                  step={500}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">每周场景目标</label>
                <Input
                  type="number"
                  value={weeklyTarget}
                  onChange={(e) => setWeeklyTarget(Number(e.target.value))}
                  min={0}
                />
              </div>
            </div>
            <Button size="sm" onClick={() => saveGoal.mutate()} disabled={saveGoal.isPending}>
              <Save className="mr-1 h-3 w-3" />
              {saveGoal.isPending ? '保存中…' : '保存目标'}
            </Button>
            {saveGoal.isSuccess && <span className="text-sm text-green-600 dark:text-green-400">已保存 ✓</span>}
          </CardContent>
        </Card>

        {/* Provider management */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  AI 提供商
                </CardTitle>
                <CardDescription>管理可用的 AI 服务</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setShowAddForm(!showAddForm)}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                添加
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Provider list */}
            {providers.data && providers.data.length > 0 ? (
              <div className="space-y-2">
                {providers.data.map((p) => (
                  <ProviderRow
                    key={p.id}
                    provider={p}
                    isSelected={providerId === p.id}
                    onSelect={() => setProviderId(p.id)}
                    onRemove={() => removeProvider.mutate(p.id)}
                    onSetDefault={() => setDefault.mutate(p.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                尚无 AI 提供商，点击上方"添加"按钮配置。
              </div>
            )}

            {/* Add form */}
            {showAddForm && <AddProviderForm onSubmit={(p) => addProvider.mutate(p)} onCancel={() => setShowAddForm(false)} isLoading={addProvider.isPending} />}
          </CardContent>
        </Card>

        {/* Model selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sliders className="h-5 w-5" />
              模型
            </CardTitle>
            <CardDescription>选择或输入模型名称</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Preset models */}
            <div className="flex flex-wrap gap-2">
              {['gpt-4o-mini', 'gpt-4o', 'claude-3-haiku', 'deepseek-chat', 'qwen2.5:7b'].map((m) => (
                <Button
                  key={m}
                  variant={model === m ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setModel(m)}
                >
                  {m}
                </Button>
              ))}
            </div>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4o-mini"
            />
            <p className="text-xs text-muted-foreground">
              输入提供商支持的任意模型名
            </p>
          </CardContent>
        </Card>

        {/* Context window */}
        <Card>
          <CardHeader>
            <CardTitle>上下文窗口</CardTitle>
            <CardDescription>
              AI 续写时参考前文的字符数。越大越有上下文感，但消耗更多 token。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={0}
                max={10000}
                step={500}
                value={contextPrevChars}
                onChange={(e) => setContextPrevChars(Number(e.target.value))}
                className="flex-1 accent-primary"
              />
              <Input
                type="number"
                value={contextPrevChars}
                onChange={(e) => setContextPrevChars(Number(e.target.value))}
                className="w-24 text-center"
                min={0}
                max={20000}
                step={500}
              />
            </div>
            <p className="text-xs text-muted-foreground">推荐: 1000–3000 字（约 1–2 页）</p>
          </CardContent>
        </Card>

        {/* System prompt */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              系统提示词
            </CardTitle>
            <CardDescription>指导 AI 的写作风格和语气。留空使用默认提示。</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={6}
              placeholder="你是一位中文小说写作助手，保持已有的风格、视角和时态…"
            />
          </CardContent>
        </Card>

        {/* Save */}
        <div className="flex items-center gap-3">
          <Button onClick={() => put.mutate()} disabled={put.isPending}>
            <Save className="mr-1.5 h-4 w-4" />
            {put.isPending ? '保存中…' : '保存设置'}
          </Button>
          {put.isSuccess && <span className="text-sm text-green-600 dark:text-green-400">已保存 ✓</span>}
          {put.error && <p className="text-sm text-destructive">{(put.error as Error).message}</p>}
        </div>
      </div>
    </Layout>
  )
}

function ProviderRow({
  provider,
  isSelected,
  onSelect,
  onRemove,
  onSetDefault,
}: {
  provider: ProviderFullInfo
  isSelected: boolean
  onSelect: () => void
  onRemove: () => void
  onSetDefault: () => void
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-3 transition-colors cursor-pointer ${
        isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'
      }`}
      onClick={onSelect}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{provider.label}</span>
          {provider.isDefault && (
            <Badge variant="default" className="gap-0.5">
              <Star className="h-2.5 w-2.5 fill-current" /> 默认
            </Badge>
          )}
          {isSelected && <Badge variant="secondary">项目已选</Badge>}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground truncate">{provider.baseUrl}</span>
          {provider.hasApiKey ? (
            <span className="text-[10px] text-green-600 dark:text-green-400">✓ API Key</span>
          ) : (
            <span className="text-[10px] text-muted-foreground">无 Key</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onSetDefault} title="设为默认">
          <Star className={`h-3.5 w-3.5 ${provider.isDefault ? 'fill-amber-400 text-amber-400' : ''}`} />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onRemove} title="删除">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

function AddProviderForm({
  onSubmit,
  onCancel,
  isLoading,
}: {
  onSubmit: (p: { id: string; label: string; baseUrl: string; apiKey: string }) => void
  onCancel: () => void
  isLoading: boolean
}) {
  const [id, setId] = useState('')
  const [label, setLabel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')

  const presets = [
    { label: 'OpenAI', id: 'openai', baseUrl: 'https://api.openai.com/v1' },
    { label: 'DeepSeek', id: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' },
    { label: 'SiliconFlow', id: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1' },
    { label: 'Ollama (本地)', id: 'ollama', baseUrl: 'http://localhost:11434/v1' },
  ]

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">快捷预设</p>
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <Button
            key={p.id}
            variant="outline"
            size="sm"
            onClick={() => {
              setId(p.id)
              setLabel(p.label)
              setBaseUrl(p.baseUrl)
            }}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <Separator />
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="text-xs text-muted-foreground">ID</label>
          <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="openai" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">名称</label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="OpenAI" />
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Base URL</label>
        <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">API Key</label>
        <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder="sk-..." />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!id || !label || !baseUrl || isLoading}
          onClick={() => onSubmit({ id, label, baseUrl, apiKey })}
        >
          {isLoading ? '添加中…' : '确认添加'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  )
}
