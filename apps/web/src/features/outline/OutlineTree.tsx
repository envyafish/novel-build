import { useState, memo } from 'react'
import { ChevronRight, Plus, FileText, BookOpen, Layers, Trash2, Pencil, RefreshCw, PenLine, ShieldCheck } from 'lucide-react'
import type { OutlineNode } from './tree-utils.js'
import type { EntityStatus } from '@novel/shared'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

const STATUS_LABEL: Record<EntityStatus, string> = {
  draft: '草稿',
  revising: '修改',
  done: '定稿',
}

const STATUS_STYLES: Record<EntityStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  revising: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  done: 'bg-green-500/15 text-green-700 dark:text-green-300',
}

/**
 * Bundled event handlers. The whole object is passed as a single prop
 * (`handlers`) so consumers can memoize it once and avoid re-rendering
 * every tree node on each EditorPage keystroke. Each field may be
 * omitted if the consumer doesn't need that action.
 */
export interface OutlineHandlers {
  onSelectScene: (sceneId: number) => void
  onSelectChapter?: ((chapterId: number) => void) | undefined
  onAddVolume?: (() => void) | undefined
  onAddChapter?: ((volumeId: number) => void) | undefined
  onAddScene?: ((chapterId: number) => void) | undefined
  onCycleStatus?: ((sceneId: number) => void) | undefined
  onDeleteScene?: ((sceneId: number) => void) | undefined
  onDeleteChapter?: ((chapterId: number) => void) | undefined
  onRenameScene?: ((sceneId: number) => void) | undefined
  onRenameChapter?: ((chapterId: number) => void) | undefined
  onRenameVolume?: ((volumeId: number) => void) | undefined
  onReviewChapter?: ((chapterId: number) => void) | undefined
  onExtractChapter?: ((chapterId: number) => void) | undefined
}

interface Props {
  nodes: OutlineNode[]
  currentSceneId?: number | undefined
  /** Chapter currently selected for chapter-level AI actions. Highlights in the tree. */
  selectedChapterId?: number | undefined
  handlers: OutlineHandlers
}

export const OutlineTree = memo(function OutlineTree({
  nodes,
  currentSceneId,
  selectedChapterId,
  handlers,
}: Props) {
  return (
    <ScrollArea className="h-full">
      <div className="min-w-0 space-y-1 p-2">
        {nodes.map((v) => (
          <VolumeNode
            key={v.id}
            node={v}
            currentSceneId={currentSceneId}
            selectedChapterId={selectedChapterId}
            handlers={handlers}
          />
        ))}
        {handlers.onAddVolume && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full justify-start gap-1.5 text-xs text-muted-foreground"
            onClick={handlers.onAddVolume}
          >
            <Plus className="h-3 w-3" /> 新建卷
          </Button>
        )}
      </div>
    </ScrollArea>
  )
})

const VolumeNode = memo(function VolumeNode({
  node,
  currentSceneId,
  selectedChapterId,
  handlers,
}: {
  node: OutlineNode
  currentSceneId?: number | undefined
  selectedChapterId?: number | undefined
  handlers: OutlineHandlers
}) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <div className="group/vol flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-semibold text-foreground hover:bg-accent">
        <button
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronRight
            className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')}
          />
          <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{node.label}</span>
        </button>
        {handlers.onRenameVolume && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handlers.onRenameVolume!(node.id)
            }}
            className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover/vol:opacity-100"
            aria-label="重命名卷"
            title="重命名"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>
      {open && node.children && (
        <div className="ml-3 min-w-0 space-y-0.5 border-l pl-1">
          {node.children.map((c) => (
            <ChapterNode
              key={c.id}
              node={c}
              currentSceneId={currentSceneId}
              selectedChapterId={selectedChapterId}
              handlers={handlers}
            />
          ))}
          {handlers.onAddChapter && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-0.5 w-full justify-start gap-1.5 text-xs text-muted-foreground"
              onClick={() => handlers.onAddChapter!(node.id)}
            >
              <Plus className="h-3 w-3" /> 新建章节
            </Button>
          )}
        </div>
      )}
    </div>
  )
})

const ChapterNode = memo(function ChapterNode({
  node,
  currentSceneId,
  selectedChapterId,
  handlers,
}: {
  node: OutlineNode
  currentSceneId?: number | undefined
  selectedChapterId?: number | undefined
  handlers: OutlineHandlers
}) {
  const [open, setOpen] = useState(true)
  const isSelected = node.id === selectedChapterId
  return (
    <div>
      <div
        className={cn(
          'group/ch flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-foreground transition-colors',
          isSelected ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-accent',
        )}
      >
        <button
          onClick={() => setOpen(!open)}
          className="flex shrink-0 items-center"
          aria-label={open ? '折叠章节' : '展开章节'}
        >
          <ChevronRight
            className={cn('h-3 w-3 transition-transform', open && 'rotate-90')}
          />
        </button>
        <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {handlers.onSelectChapter ? (
          <button
            type="button"
            onClick={() => handlers.onSelectChapter!(node.id)}
            className="min-w-0 flex-1 cursor-pointer truncate text-left"
            title="选择章节以触发 AI 审稿 / 提取"
          >
            {node.label}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate">{node.label}</span>
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          {handlers.onReviewChapter && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handlers.onReviewChapter!(node.id)
              }}
              className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
              aria-label="审章节"
              title="审章节"
            >
              <PenLine className="h-3 w-3" />
            </button>
          )}
          {handlers.onExtractChapter && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handlers.onExtractChapter!(node.id)
              }}
              className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
              aria-label="从章节提取设定"
              title="提取章节设定"
            >
              <ShieldCheck className="h-3 w-3" />
            </button>
          )}
          {handlers.onRenameChapter && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handlers.onRenameChapter!(node.id)
              }}
              className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground opacity-60 transition-opacity group-hover/ch:opacity-100"
              aria-label="重命名章节"
              title="重命名"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
          {handlers.onDeleteChapter && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handlers.onDeleteChapter!(node.id)
              }}
              className="rounded p-1 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950 opacity-60 transition-opacity group-hover/ch:opacity-100"
              aria-label="删除章节"
              title="删除"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      {open && node.children && (
        <div className="ml-4 min-w-0 space-y-0.5 border-l pl-1">
          {node.children.map((s) => (
            <SceneNode
              key={s.id}
              node={s}
              isCurrent={s.id === currentSceneId}
              handlers={handlers}
            />
          ))}
          {handlers.onAddScene && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-0.5 w-full justify-start gap-1.5 text-xs text-muted-foreground"
              onClick={() => handlers.onAddScene!(node.id)}
            >
              <Plus className="h-3 w-3" /> 新建场景
            </Button>
          )}
        </div>
      )}
    </div>
  )
})

const SceneNode = memo(function SceneNode({
  node,
  isCurrent,
  handlers,
}: {
  node: OutlineNode
  isCurrent: boolean
  handlers: OutlineHandlers
}) {
  const status = (node.status ?? 'draft') as EntityStatus
  return (
    <div
      className={cn(
        'group/scene relative flex items-center gap-0.5 overflow-hidden rounded-md transition-colors',
        isCurrent
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      <button
        onClick={() => handlers.onSelectScene(node.id)}
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden px-2 py-1 text-left text-sm"
      >
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{node.label}</span>
        <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px]', STATUS_STYLES[status])}>
          {STATUS_LABEL[status]}
        </span>
      </button>
      <div className="absolute right-0 top-0 flex h-full items-center gap-0.5 bg-inherit px-1 opacity-0 transition-opacity group-hover/scene:opacity-100">
        {handlers.onRenameScene && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handlers.onRenameScene!(node.id)
            }}
            className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
            aria-label="重命名场景"
            title="重命名"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
        {handlers.onCycleStatus && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handlers.onCycleStatus!(node.id)
            }}
            className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
            aria-label="切换状态"
            title="切换状态"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        )}
        {handlers.onDeleteScene && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handlers.onDeleteScene!(node.id)
            }}
            className="rounded p-1 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950"
            aria-label="删除场景"
            title="删除"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
})
