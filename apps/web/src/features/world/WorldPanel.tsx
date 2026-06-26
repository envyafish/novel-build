import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Edit3, Users, Settings, Clock, Eye, ChevronDown, ChevronRight, Save, X, Sparkles, Wand2, Swords, Loader2 } from 'lucide-react'
import type { CharacterDto, WorldElementDto, TimelineEventDto, ForeshadowDto, ConflictDto, WorldCategory, ForeshadowStatus, ConflictType, ConflictPhase, CompletionMode } from '@novel/shared'
import { worldApi } from './api.js'
import { useAiStream } from '../../hooks/useAiStream.js'
import { parseAiJson } from '@novel/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type Tab = 'characters' | 'world' | 'timeline' | 'foreshadows' | 'conflicts'

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: 'characters', label: '人物', icon: Users },
  { id: 'world', label: '设定', icon: Settings },
  { id: 'timeline', label: '时间线', icon: Clock },
  { id: 'foreshadows', label: '伏笔', icon: Eye },
  { id: 'conflicts', label: '冲突', icon: Swords },
]

const WORLD_CATEGORIES: { value: WorldCategory; label: string }[] = [
  { value: 'location', label: '地点' },
  { value: 'organization', label: '组织' },
  { value: 'item', label: '道具' },
  { value: 'concept', label: '概念' },
  { value: 'rule', label: '规则' },
]

const FORESHADOW_STATUS: { value: ForeshadowStatus; label: string; color: string }[] = [
  { value: 'planted', label: '埋设', color: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300' },
  { value: 'revealed', label: '揭示', color: 'bg-blue-500/20 text-blue-700 dark:text-blue-300' },
  { value: 'resolved', label: '回收', color: 'bg-green-500/20 text-green-700 dark:text-green-300' },
]

const CONFLICT_TYPES: { value: ConflictType; label: string }[] = [
  { value: 'person_vs_person', label: '人与人' },
  { value: 'person_vs_self', label: '人与自我' },
  { value: 'person_vs_society', label: '人与社会' },
  { value: 'person_vs_nature', label: '人与自然' },
  { value: 'person_vs_fate', label: '人与命运' },
]

const CONFLICT_PHASES: { value: ConflictPhase; label: string; color: string }[] = [
  { value: 'setup', label: '铺垫', color: 'bg-gray-500/20 text-gray-700 dark:text-gray-300' },
  { value: 'escalation', label: '升级', color: 'bg-orange-500/20 text-orange-700 dark:text-orange-300' },
  { value: 'climax', label: '高潮', color: 'bg-red-500/20 text-red-700 dark:text-red-300' },
  { value: 'resolution', label: '解决', color: 'bg-green-500/20 text-green-700 dark:text-green-300' },
]

interface WorldPanelProps {
  projectId: number
  model?: string
}

export function WorldPanel({ projectId, model = 'gpt-4o-mini' }: WorldPanelProps) {
  const [tab, setTab] = useState<Tab>('characters')
  const qc = useQueryClient()

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1 py-2 text-xs font-medium transition-colors',
              tab === t.id ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'characters' && <CharactersTab projectId={projectId} qc={qc} model={model} />}
        {tab === 'world' && <WorldTab projectId={projectId} qc={qc} model={model} />}
        {tab === 'timeline' && <TimelineTab projectId={projectId} qc={qc} model={model} />}
        {tab === 'foreshadows' && <ForeshadowsTab projectId={projectId} qc={qc} model={model} />}
        {tab === 'conflicts' && <ConflictsTab projectId={projectId} qc={qc} model={model} />}
      </div>
    </div>
  )
}

// ========== AI Generate Section ==========

function AiGenerateSection({
  mode,
  label,
  placeholder,
  model,
  sceneId,
  onGenerated,
}: {
  mode: CompletionMode
  label: string
  placeholder: string
  model: string
  sceneId?: number
  onGenerated: (json: string) => void
}) {
  const { state, start, cancel, reset } = useAiStream()
  const [prompt, setPrompt] = useState('')
  // Tracks the last AI output we successfully parsed and forwarded to the
  // parent. Used to make the auto-parse effect idempotent: under React
  // StrictMode the effect fires twice, and parent re-renders can also
  // re-fire it. Without this guard, the same successful text would produce
  // duplicate create-mutation requests.
  const lastHandledRef = useRef<string | null>(null)

  const handleGenerate = () => {
    if (!prompt.trim()) return
    start({ sceneId: sceneId ?? 0, mode, model, inputText: prompt.trim() })
  }

  // Auto-parse JSON when done. Runs in an effect (not during render) so we
  // don't setState during render — which would trigger React 18 warnings
  // and could double-fire when the parent re-renders for unrelated reasons.
  useEffect(() => {
    if (state.status !== 'done' || !state.text) return
    if (lastHandledRef.current === state.text) return
    const parsed = parseAiJson<Record<string, unknown>>(state.text)
    if (parsed === null) return // leave raw output visible for the user to inspect
    lastHandledRef.current = state.text
    onGenerated(JSON.stringify(parsed))
    reset()
  }, [state.status, state.text, onGenerated, reset])

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Wand2 className="h-3.5 w-3.5" />
        AI 生成{label}
      </div>
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="text-sm"
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!prompt.trim() || state.status === 'streaming'}
          onClick={handleGenerate}
        >
          <Sparkles className="mr-1 h-3 w-3" />
          {state.status === 'streaming' ? '生成中…' : 'AI 生成'}
        </Button>
        {state.status === 'streaming' && (
          <Button size="sm" variant="ghost" onClick={cancel}>
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
      {state.status === 'error' && (
        <p className="text-xs text-destructive">{state.errorMessage}</p>
      )}
      {state.status === 'done' && state.text && (
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{state.text}</pre>
      )}
    </div>
  )
}

// ========== Characters Tab ==========

function CharactersTab({ projectId, qc, model }: { projectId: number; qc: ReturnType<typeof useQueryClient>; model: string }) {
  const { data: items = [] } = useQuery({ queryKey: ['characters', projectId], queryFn: () => worldApi.listCharacters(projectId) })
  const [editing, setEditing] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)

  const del = useMutation({
    mutationFn: (id: number) => worldApi.deleteCharacter(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['characters', projectId] }),
  })

  const create = useMutation({
    mutationFn: (data: Partial<CharacterDto>) => worldApi.createCharacter(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['characters', projectId] }),
  })

  const handleAiGenerated = useCallback((json: string) => {
    try {
      const data = JSON.parse(json)
      create.mutate({
        name: data.name || '未命名',
        aliases: data.aliases || [],
        appearance: data.appearance || '',
        personality: data.personality || '',
        background: data.background || '',
        relationships: data.relationships || '',
        voiceProfile: data.voiceProfile || '',
        notes: data.notes || '',
      })
    } catch {
      // JSON parse failed, ignore
    }
  }, [create])

  return (
    <ScrollArea className="h-full">
      <div className="space-y-2 p-3">
        {items.map((c) => (
          <CharacterCard key={c.id} item={c} isEditing={editing === c.id} onEdit={() => setEditing(c.id)} onCancel={() => setEditing(null)} projectId={projectId} qc={qc} onDelete={() => del.mutate(c.id)} isDeleting={del.isPending && del.variables === c.id} />
        ))}
        {showForm ? (
          <CharacterForm projectId={projectId} qc={qc} onCancel={() => setShowForm(false)} />
        ) : (
          <div className="space-y-2">
            <Button variant="outline" size="sm" className="w-full" onClick={() => setShowForm(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> 新建人物
            </Button>
            <AiGenerateSection
              mode="generate_character"
              label="人物"
              placeholder="描述你想要的人物，例如：一个沉默寡言的剑客，曾是宫廷侍卫…"
              model={model}
              onGenerated={handleAiGenerated}
            />
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

function CharacterCard({ item, isEditing, onEdit, onCancel, projectId, qc, onDelete, isDeleting }: { item: CharacterDto; isEditing: boolean; onEdit: () => void; onCancel: () => void; projectId: number; qc: ReturnType<typeof useQueryClient>; onDelete: () => void; isDeleting?: boolean }) {
  const [open, setOpen] = useState(false)
  if (isEditing) return <CharacterForm projectId={projectId} qc={qc} initial={item} onCancel={onCancel} />

  return (
    <div className="rounded-lg border p-2.5">
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen(!open)} className="flex flex-1 items-center gap-1.5 text-sm font-medium">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {item.name}
        </button>
        {item.aliases.length > 0 && <Badge variant="outline" className="text-[10px]">{item.aliases.join(', ')}</Badge>}
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onEdit}><Edit3 className="h-3 w-3" /></Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" disabled={isDeleting} onClick={onDelete}>
          {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        </Button>
      </div>
      {open && (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {item.personality && <p><strong>性格:</strong> {item.personality}</p>}
          {item.appearance && <p><strong>外貌:</strong> {item.appearance}</p>}
          {item.background && <p><strong>背景:</strong> {item.background}</p>}
          {item.relationships && <p><strong>关系:</strong> {item.relationships}</p>}
          {item.voiceProfile && <p className="whitespace-pre-wrap"><strong>语音档案:</strong> {item.voiceProfile}</p>}
          {item.notes && <p><strong>备注:</strong> {item.notes}</p>}
        </div>
      )}
    </div>
  )
}

function CharacterForm({ projectId, qc, initial, onCancel }: { projectId: number; qc: ReturnType<typeof useQueryClient>; initial?: CharacterDto; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [aliases, setAliases] = useState(initial?.aliases.join(', ') ?? '')
  const [personality, setPersonality] = useState(initial?.personality ?? '')
  const [appearance, setAppearance] = useState(initial?.appearance ?? '')
  const [background, setBackground] = useState(initial?.background ?? '')
  const [relationships, setRelationships] = useState(initial?.relationships ?? '')
  const [voiceProfile, setVoiceProfile] = useState(initial?.voiceProfile ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  const save = useMutation({
    mutationFn: () => {
      const data = { name, aliases: aliases.split(',').map(s => s.trim()).filter(Boolean), personality, appearance, background, relationships, voiceProfile, notes }
      return initial ? worldApi.updateCharacter(initial.id, data) : worldApi.createCharacter(projectId, data)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['characters', projectId] }); onCancel() },
  })

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <Input placeholder="姓名" value={name} onChange={(e) => setName(e.target.value)} />
      <Input placeholder="别名（逗号分隔）" value={aliases} onChange={(e) => setAliases(e.target.value)} />
      <Textarea placeholder="性格" value={personality} onChange={(e) => setPersonality(e.target.value)} rows={2} />
      <Textarea placeholder="外貌" value={appearance} onChange={(e) => setAppearance(e.target.value)} rows={2} />
      <Textarea placeholder="背景" value={background} onChange={(e) => setBackground(e.target.value)} rows={2} />
      <Textarea placeholder="人物关系" value={relationships} onChange={(e) => setRelationships(e.target.value)} rows={2} />
      <Textarea placeholder="语音档案" value={voiceProfile} onChange={(e) => setVoiceProfile(e.target.value)} rows={3} />
      <Textarea placeholder="备注" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      <div className="flex gap-2">
        <Button size="sm" disabled={!name || save.isPending} onClick={() => save.mutate()}>
          <Save className="mr-1 h-3 w-3" /> {save.isPending ? '保存中…' : '保存'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}><X className="mr-1 h-3 w-3" /> 取消</Button>
      </div>
    </div>
  )
}

// ========== World Elements Tab ==========

function WorldTab({ projectId, qc, model }: { projectId: number; qc: ReturnType<typeof useQueryClient>; model: string }) {
  const { data: items = [] } = useQuery({ queryKey: ['worldElements', projectId], queryFn: () => worldApi.listWorldElements(projectId) })
  const [editing, setEditing] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)

  const del = useMutation({
    mutationFn: (id: number) => worldApi.deleteWorldElement(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['worldElements', projectId] }),
  })

  const create = useMutation({
    mutationFn: (data: Partial<WorldElementDto>) => worldApi.createWorldElement(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['worldElements', projectId] }),
  })

  const handleAiGenerated = useCallback((json: string) => {
    try {
      const data = JSON.parse(json)
      create.mutate({
        name: data.name || '未命名',
        category: data.category || 'concept',
        description: data.description || '',
        notes: data.notes || '',
      })
    } catch {
      // JSON parse failed, ignore
    }
  }, [create])

  // Group by category
  const grouped = WORLD_CATEGORIES.map((cat) => ({
    ...cat,
    items: items.filter((w) => w.category === cat.value),
  })).filter((g) => g.items.length > 0)

  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-3">
        {grouped.map((group) => (
          <div key={group.value}>
            <h4 className="mb-1.5 text-xs font-semibold text-muted-foreground">{group.label}</h4>
            <div className="space-y-1.5">
              {group.items.map((w) => (
                editing === w.id ? (
                  <WorldForm key={w.id} projectId={projectId} qc={qc} initial={w} onCancel={() => setEditing(null)} />
                ) : (
                  <div key={w.id} className="rounded-lg border p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-sm font-medium">{w.name}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditing(w.id)}><Edit3 className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" disabled={del.isPending && del.variables === w.id} onClick={() => del.mutate(w.id)}>
                        {del.isPending && del.variables === w.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      </Button>
                    </div>
                    {w.description && <p className="mt-1 text-xs text-muted-foreground">{w.description}</p>}
                  </div>
                )
              ))}
            </div>
          </div>
        ))}
        {showForm ? (
          <WorldForm projectId={projectId} qc={qc} onCancel={() => setShowForm(false)} />
        ) : (
          <div className="space-y-2">
            <Button variant="outline" size="sm" className="w-full" onClick={() => setShowForm(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> 新建设定
            </Button>
            <AiGenerateSection
              mode="generate_world"
              label="设定"
              placeholder="描述你想要的设定，例如：一座悬浮在云端的古城，城中居民靠风力飞行…"
              model={model}
              onGenerated={handleAiGenerated}
            />
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

function WorldForm({ projectId, qc, initial, onCancel }: { projectId: number; qc: ReturnType<typeof useQueryClient>; initial?: WorldElementDto; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [category, setCategory] = useState<WorldCategory>(initial?.category ?? 'concept')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  const save = useMutation({
    mutationFn: () => {
      const data = { name, category, description, notes }
      return initial ? worldApi.updateWorldElement(initial.id, data) : worldApi.createWorldElement(projectId, data)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['worldElements', projectId] }); onCancel() },
  })

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <Input placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} />
      <select value={category} onChange={(e) => setCategory(e.target.value as WorldCategory)} className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm">
        {WORLD_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      <Textarea placeholder="描述" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      <Textarea placeholder="备注" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      <div className="flex gap-2">
        <Button size="sm" disabled={!name || save.isPending} onClick={() => save.mutate()}>
          <Save className="mr-1 h-3 w-3" /> {save.isPending ? '保存中…' : '保存'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}><X className="mr-1 h-3 w-3" /> 取消</Button>
      </div>
    </div>
  )
}

// ========== Timeline Tab ==========

function TimelineTab({ projectId, qc, model }: { projectId: number; qc: ReturnType<typeof useQueryClient>; model: string }) {
  const { data: items = [] } = useQuery({ queryKey: ['timeline', projectId], queryFn: () => worldApi.listTimeline(projectId) })
  const [editing, setEditing] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)

  const del = useMutation({
    mutationFn: (id: number) => worldApi.deleteTimelineEvent(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timeline', projectId] }),
  })

  const create = useMutation({
    mutationFn: (data: Partial<TimelineEventDto>) => worldApi.createTimelineEvent(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timeline', projectId] }),
  })

  const handleAiGenerated = useCallback((json: string) => {
    try {
      const data = JSON.parse(json)
      create.mutate({
        title: data.title || '未命名',
        era: data.era || '',
        description: data.description || '',
        notes: data.notes || '',
        orderIndex: items.length,
      })
    } catch {
      // JSON parse failed, ignore
    }
  }, [create, items.length])

  return (
    <ScrollArea className="h-full">
      <div className="space-y-2 p-3">
        {items.map((t) => (
          editing === t.id ? (
            <TimelineForm key={t.id} projectId={projectId} qc={qc} initial={t} onCancel={() => setEditing(null)} />
          ) : (
            <div key={t.id} className="rounded-lg border p-2.5">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {t.era && <Badge variant="outline" className="text-[10px]">{t.era}</Badge>}
                    <span className="text-sm font-medium">{t.title}</span>
                  </div>
                  {t.description && <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>}
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditing(t.id)}><Edit3 className="h-3 w-3" /></Button>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" disabled={del.isPending && del.variables === t.id} onClick={() => del.mutate(t.id)}>
                  {del.isPending && del.variables === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                </Button>
              </div>
            </div>
          )
        ))}
        {showForm ? (
          <TimelineForm projectId={projectId} qc={qc} onCancel={() => setShowForm(false)} />
        ) : (
          <div className="space-y-2">
            <Button variant="outline" size="sm" className="w-full" onClick={() => setShowForm(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> 新建事件
            </Button>
            <AiGenerateSection
              mode="generate_timeline"
              label="时间线事件"
              placeholder="描述事件，例如：王国覆灭之战，三方势力在落日峡谷决战…"
              model={model}
              onGenerated={handleAiGenerated}
            />
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

function TimelineForm({ projectId, qc, initial, onCancel }: { projectId: number; qc: ReturnType<typeof useQueryClient>; initial?: TimelineEventDto; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [era, setEra] = useState(initial?.era ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  const save = useMutation({
    mutationFn: () => {
      const data = { title, era, description, notes, orderIndex: initial?.orderIndex ?? 0 }
      return initial ? worldApi.updateTimelineEvent(initial.id, data) : worldApi.createTimelineEvent(projectId, data)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['timeline', projectId] }); onCancel() },
  })

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <Input placeholder="事件标题" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Input placeholder="时间标记（如：第一章、三年前）" value={era} onChange={(e) => setEra(e.target.value)} />
      <Textarea placeholder="描述" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      <Textarea placeholder="备注" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      <div className="flex gap-2">
        <Button size="sm" disabled={!title || save.isPending} onClick={() => save.mutate()}>
          <Save className="mr-1 h-3 w-3" /> {save.isPending ? '保存中…' : '保存'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}><X className="mr-1 h-3 w-3" /> 取消</Button>
      </div>
    </div>
  )
}

// ========== Foreshadows Tab ==========

function ForeshadowsTab({ projectId, qc, model }: { projectId: number; qc: ReturnType<typeof useQueryClient>; model: string }) {
  const { data: items = [] } = useQuery({ queryKey: ['foreshadows', projectId], queryFn: () => worldApi.listForeshadows(projectId) })
  const [editing, setEditing] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)

  const del = useMutation({
    mutationFn: (id: number) => worldApi.deleteForeshadow(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['foreshadows', projectId] }),
  })

  const cycleStatus = useMutation({
    mutationFn: (item: ForeshadowDto) => {
      const next = item.status === 'planted' ? 'revealed' : item.status === 'revealed' ? 'resolved' : 'planted'
      return worldApi.updateForeshadow(item.id, { status: next })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['foreshadows', projectId] }),
  })

  const create = useMutation({
    mutationFn: (data: Partial<ForeshadowDto>) => worldApi.createForeshadow(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['foreshadows', projectId] }),
  })

  const handleAiGenerated = useCallback((json: string) => {
    try {
      const data = JSON.parse(json)
      create.mutate({
        title: data.title || '未命名',
        description: data.description || '',
        status: data.status || 'planted',
        notes: data.notes || '',
      })
    } catch {
      // JSON parse failed, ignore
    }
  }, [create])

  return (
    <ScrollArea className="h-full">
      <div className="space-y-2 p-3">
        {items.map((f) => (
          editing === f.id ? (
            <ForeshadowForm key={f.id} projectId={projectId} qc={qc} initial={f} onCancel={() => setEditing(null)} />
          ) : (
            <div key={f.id} className="rounded-lg border p-2.5">
              <div className="flex items-center gap-2">
                <button onClick={() => cycleStatus.mutate(f)} className="shrink-0">
                  <Badge className={FORESHADOW_STATUS.find((s) => s.value === f.status)?.color}>
                    {FORESHADOW_STATUS.find((s) => s.value === f.status)?.label}
                  </Badge>
                </button>
                <span className="flex-1 text-sm font-medium">{f.title}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditing(f.id)}><Edit3 className="h-3 w-3" /></Button>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" disabled={del.isPending && del.variables === f.id} onClick={() => del.mutate(f.id)}>
                  {del.isPending && del.variables === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                </Button>
              </div>
              {f.description && <p className="mt-1 text-xs text-muted-foreground">{f.description}</p>}
            </div>
          )
        ))}
        {showForm ? (
          <ForeshadowForm projectId={projectId} qc={qc} onCancel={() => setShowForm(false)} />
        ) : (
          <div className="space-y-2">
            <Button variant="outline" size="sm" className="w-full" onClick={() => setShowForm(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> 新建伏笔
            </Button>
            <AiGenerateSection
              mode="generate_foreshadow"
              label="伏笔"
              placeholder="描述伏笔，例如：主角随身携带的玉佩，上面刻着一个陌生的符号…"
              model={model}
              onGenerated={handleAiGenerated}
            />
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

function ForeshadowForm({ projectId, qc, initial, onCancel }: { projectId: number; qc: ReturnType<typeof useQueryClient>; initial?: ForeshadowDto; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [status, setStatus] = useState<ForeshadowStatus>(initial?.status ?? 'planted')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  const save = useMutation({
    mutationFn: () => {
      const data = { title, description, status, notes }
      return initial ? worldApi.updateForeshadow(initial.id, data) : worldApi.createForeshadow(projectId, data)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['foreshadows', projectId] }); onCancel() },
  })

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <Input placeholder="伏笔标题" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea placeholder="描述" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      <select value={status} onChange={(e) => setStatus(e.target.value as ForeshadowStatus)} className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm">
        {FORESHADOW_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <Textarea placeholder="备注" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      <div className="flex gap-2">
        <Button size="sm" disabled={!title || save.isPending} onClick={() => save.mutate()}>
          <Save className="mr-1 h-3 w-3" /> {save.isPending ? '保存中…' : '保存'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}><X className="mr-1 h-3 w-3" /> 取消</Button>
      </div>
    </div>
  )
}

// ========== Conflicts Tab ==========

function ConflictsTab({ projectId, qc, model }: { projectId: number; qc: ReturnType<typeof useQueryClient>; model: string }) {
  const { data: items = [] } = useQuery({ queryKey: ['conflicts', projectId], queryFn: () => worldApi.listConflicts(projectId) })
  const [editing, setEditing] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)

  const del = useMutation({
    mutationFn: (id: number) => worldApi.deleteConflict(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conflicts', projectId] }),
  })

  const cyclePhase = useMutation({
    mutationFn: (item: ConflictDto) => {
      const next = item.status === 'setup' ? 'escalation' : item.status === 'escalation' ? 'climax' : item.status === 'climax' ? 'resolution' : 'setup'
      return worldApi.updateConflict(item.id, { status: next })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conflicts', projectId] }),
  })

  const create = useMutation({
    mutationFn: (data: Partial<ConflictDto>) => worldApi.createConflict(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conflicts', projectId] }),
  })

  const handleAiGenerated = useCallback((json: string) => {
    try {
      const data = JSON.parse(json)
      create.mutate({
        title: data.title || '未命名',
        type: data.type || 'person_vs_person',
        description: data.description || '',
        setup: data.setup || '',
        escalation: data.escalation || '',
        climax: data.climax || '',
        resolution: data.resolution || '',
        status: 'setup',
        notes: data.notes || '',
      })
    } catch {
      // JSON parse failed, ignore
    }
  }, [create])

  return (
    <ScrollArea className="h-full">
      <div className="space-y-2 p-3">
        {items.map((c) => (
          editing === c.id ? (
            <ConflictForm key={c.id} projectId={projectId} qc={qc} initial={c} onCancel={() => setEditing(null)} />
          ) : (
            <ConflictCard key={c.id} item={c} onEdit={() => setEditing(c.id)} onDelete={() => del.mutate(c.id)} isDeleting={del.isPending && del.variables === c.id} onCyclePhase={() => cyclePhase.mutate(c)} />
          )
        ))}
        {showForm ? (
          <ConflictForm projectId={projectId} qc={qc} onCancel={() => setShowForm(false)} />
        ) : (
          <div className="space-y-2">
            <Button variant="outline" size="sm" className="w-full" onClick={() => setShowForm(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> 新建冲突
            </Button>
            <AiGenerateSection
              mode="generate_conflict"
              label="冲突"
              placeholder="描述冲突，例如：主角与宿敌在王位之争中的对峙，双方各有一段不可告人的秘密…"
              model={model}
              onGenerated={handleAiGenerated}
            />
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

function ConflictCard({ item, onEdit, onDelete, onCyclePhase, isDeleting }: { item: ConflictDto; onEdit: () => void; onDelete: () => void; onCyclePhase: () => void; isDeleting?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border p-2.5">
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen(!open)} className="flex flex-1 items-center gap-1.5 text-sm font-medium">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {item.title}
        </button>
        <button onClick={onCyclePhase} className="shrink-0">
          <Badge className={CONFLICT_PHASES.find((s) => s.value === item.status)?.color}>
            {CONFLICT_PHASES.find((s) => s.value === item.status)?.label}
          </Badge>
        </button>
        <Badge variant="outline" className="text-[10px]">
          {CONFLICT_TYPES.find((t) => t.value === item.type)?.label ?? item.type}
        </Badge>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onEdit}><Edit3 className="h-3 w-3" /></Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" disabled={isDeleting} onClick={onDelete}>
          {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        </Button>
      </div>
      {open && (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {item.description && <p><strong>概述:</strong> {item.description}</p>}
          {item.setup && <p><strong>铺垫:</strong> {item.setup}</p>}
          {item.escalation && <p><strong>升级:</strong> {item.escalation}</p>}
          {item.climax && <p><strong>高潮:</strong> {item.climax}</p>}
          {item.resolution && <p><strong>解决:</strong> {item.resolution}</p>}
          {item.notes && <p><strong>备注:</strong> {item.notes}</p>}
        </div>
      )}
    </div>
  )
}

function ConflictForm({ projectId, qc, initial, onCancel }: { projectId: number; qc: ReturnType<typeof useQueryClient>; initial?: ConflictDto; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [type, setType] = useState<ConflictType>(initial?.type ?? 'person_vs_person')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [setup, setSetup] = useState(initial?.setup ?? '')
  const [escalation, setEscalation] = useState(initial?.escalation ?? '')
  const [climax, setClimax] = useState(initial?.climax ?? '')
  const [resolution, setResolution] = useState(initial?.resolution ?? '')
  const [status, setStatus] = useState<ConflictPhase>(initial?.status ?? 'setup')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  const save = useMutation({
    mutationFn: () => {
      const data = { title, type, description, setup, escalation, climax, resolution, status, notes }
      return initial ? worldApi.updateConflict(initial.id, data) : worldApi.createConflict(projectId, data)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['conflicts', projectId] }); onCancel() },
  })

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <Input placeholder="冲突标题" value={title} onChange={(e) => setTitle(e.target.value)} />
      <select value={type} onChange={(e) => setType(e.target.value as ConflictType)} className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm">
        {CONFLICT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      <Textarea placeholder="冲突概述" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      <Textarea placeholder="铺垫阶段" value={setup} onChange={(e) => setSetup(e.target.value)} rows={2} />
      <Textarea placeholder="升级阶段" value={escalation} onChange={(e) => setEscalation(e.target.value)} rows={2} />
      <Textarea placeholder="高潮阶段" value={climax} onChange={(e) => setClimax(e.target.value)} rows={2} />
      <Textarea placeholder="解决阶段" value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2} />
      <select value={status} onChange={(e) => setStatus(e.target.value as ConflictPhase)} className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm">
        {CONFLICT_PHASES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <Textarea placeholder="备注" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      <div className="flex gap-2">
        <Button size="sm" disabled={!title || save.isPending} onClick={() => save.mutate()}>
          <Save className="mr-1 h-3 w-3" /> {save.isPending ? '保存中…' : '保存'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}><X className="mr-1 h-3 w-3" /> 取消</Button>
      </div>
    </div>
  )
}
