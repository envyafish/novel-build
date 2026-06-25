import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  text: string
  targetWords?: number | null
  /** Hide when text is empty (so an empty editor doesn't show 0/0). */
  hideWhenEmpty?: boolean
}

export function WordCounter({ text, targetWords, hideWhenEmpty }: Props) {
  const [words, setWords] = useState(0)
  useEffect(() => {
    setWords(text.replace(/\s+/g, '').length)
  }, [text])

  if (hideWhenEmpty && words === 0) return null

  const hasTarget = typeof targetWords === 'number' && targetWords > 0
  const pct = hasTarget && targetWords ? Math.min(100, Math.round((words / targetWords) * 100)) : 0
  const over = hasTarget && words >= targetWords

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="font-mono tabular-nums" data-testid="word-count">
        {words.toLocaleString()}{hasTarget ? ` / ${targetWords.toLocaleString()}` : ''} 字
      </span>
      {hasTarget && (
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              over ? 'bg-green-500' : pct > 80 ? 'bg-amber-500' : 'bg-primary',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}
