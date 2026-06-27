import { Link } from 'react-router-dom'
import { Loader2, Settings } from 'lucide-react'
import { useIsMutating } from '@tanstack/react-query'
import { NovelBuildIcon } from '@/components/icon/NovelBuildIcon'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

interface BreadcrumbEntry {
  label: string
  href?: string
}

interface TopBarProps {
  breadcrumbs?: BreadcrumbEntry[] | undefined
  projectId?: number | undefined
}

export function TopBar({ breadcrumbs = [], projectId }: TopBarProps) {
  // Global "saving" indicator: any in-flight mutation across the app
  // (create chapter, delete scene, cycle status, save character, etc.)
  // shows a spinner in the top bar. Local operations like the AI streaming
  // panel or the chapter review modal use their own dedicated progress UI;
  // this is just for the "I clicked a button and nothing seems to happen"
  // feedback gap that brief mutation round-trips used to leave open.
  const pending = useIsMutating()
  return (
    <header className="sticky top-0 z-40 flex h-12 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <Link to="/projects" className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-foreground/80">
        <NovelBuildIcon size={18} />
        Novel Build
      </Link>

      {breadcrumbs.length > 0 && (
        <>
          <Separator orientation="vertical" className="mx-1 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.map((item, i) => (
                <BreadcrumbItem key={i}>
                  {i > 0 && <BreadcrumbSeparator />}
                  {item.href ? (
                    <BreadcrumbLink asChild>
                      <Link to={item.href}>{item.label}</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{item.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </>
      )}

      <div className="flex-1" />

      {pending > 0 && (
        <div
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          aria-live="polite"
          aria-label="正在保存"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>保存中</span>
        </div>
      )}

      {projectId && (
        <Button variant="ghost" size="icon" asChild>
          <Link to={`/projects/${projectId}/settings`}>
            <Settings className="h-4 w-4" />
            <span className="sr-only">Settings</span>
          </Link>
        </Button>
      )}
      <ThemeToggle />
    </header>
  )
}
