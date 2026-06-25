import { useState } from 'react'
import { Download, FileText, Code, Globe, Book } from 'lucide-react'
import { projectsApi } from './api.js'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  projectName: string
}

interface FormatOption {
  id: string
  label: string
  description: string
  icon: typeof FileText
  ext: string
}

const FORMATS: FormatOption[] = [
  { id: 'txt', label: '纯文本', description: '简洁的 .txt 文件，适合任何阅读器', icon: FileText, ext: '.txt' },
  { id: 'markdown', label: 'Markdown', description: '保留标题结构的 .md 文件', icon: Code, ext: '.md' },
  { id: 'html', label: 'HTML 网页', description: '带排版样式的网页，可打印为 PDF', icon: Globe, ext: '.html' },
  { id: 'epub', label: 'EPUB 电子书', description: '带目录和封面的电子书，可在 iBooks/Kindle 等阅读', icon: Book, ext: '.epub' },
]

export function ExportDialog({ open, onOpenChange, projectId, projectName }: Props) {
  const [selected, setSelected] = useState('txt')

  const handleExport = () => {
    const url = projectsApi.exportUrl(projectId, selected)
    const a = document.createElement('a')
    a.href = url
    a.download = `${projectName}.${FORMATS.find((f) => f.id === selected)?.ext ?? 'txt'}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            导出「{projectName}」
          </DialogTitle>
          <DialogDescription>选择导出格式，将合并所有章节与场景为一个文件。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 py-2">
          {FORMATS.map((f) => {
            const Icon = f.icon
            const isSelected = selected === f.id
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelected(f.id)}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-accent',
                )}
              >
                <div
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
                    isSelected ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{f.label}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{f.ext}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{f.description}</p>
                </div>
                <div
                  className={cn(
                    'h-4 w-4 rounded-full border-2 transition-colors',
                    isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/30',
                  )}
                >
                  {isSelected && (
                    <div className="h-full w-full rounded-full bg-background scale-50" />
                  )}
                </div>
              </button>
            )
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleExport}>
            <Download className="mr-1.5 h-4 w-4" />
            导出
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
