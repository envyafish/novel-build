import type { Editor } from '@tiptap/react'
import {
  Bold,
  Italic,
  Strikethrough,
  Quote,
  Code,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  editor: Editor | null
}

interface Button {
  key: string
  label: string
  icon: LucideIcon
  isActive?: (e: Editor) => boolean
  isDisabled?: (e: Editor) => boolean
  run: (e: Editor) => void
}

const BUTTONS: Button[] = [
  {
    key: 'h1',
    label: '一级标题',
    icon: Heading1,
    isActive: (e) => e.isActive('heading', { level: 1 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    key: 'h2',
    label: '二级标题',
    icon: Heading2,
    isActive: (e) => e.isActive('heading', { level: 2 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    key: 'bold',
    label: '加粗 (⌘B)',
    icon: Bold,
    isActive: (e) => e.isActive('bold'),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    key: 'italic',
    label: '斜体 (⌘I)',
    icon: Italic,
    isActive: (e) => e.isActive('italic'),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    key: 'strike',
    label: '删除线',
    icon: Strikethrough,
    isActive: (e) => e.isActive('strike'),
    run: (e) => e.chain().focus().toggleStrike().run(),
  },
  {
    key: 'quote',
    label: '引用',
    icon: Quote,
    isActive: (e) => e.isActive('blockquote'),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    key: 'code',
    label: '行内代码',
    icon: Code,
    isActive: (e) => e.isActive('code'),
    run: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    key: 'ul',
    label: '无序列表',
    icon: List,
    isActive: (e) => e.isActive('bulletList'),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    key: 'ol',
    label: '有序列表',
    icon: ListOrdered,
    isActive: (e) => e.isActive('orderedList'),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
]

export function EditorFormattingBar({ editor }: Props) {
  if (!editor) return null
  return (
    <div className="mb-2 inline-flex items-center gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
      {BUTTONS.map((b) => {
        const Icon = b.icon
        const active = b.isActive ? b.isActive(editor) : false
        const disabled = b.isDisabled ? b.isDisabled(editor) : false
        return (
          <button
            key={b.key}
            type="button"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => b.run(editor)}
            title={b.label}
            aria-label={b.label}
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded text-xs transition-colors',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        )
      })}
    </div>
  )
}
