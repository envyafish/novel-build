import { Link, useParams } from 'react-router-dom'
import { BookOpen, Settings } from 'lucide-react'
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
  return (
    <header className="sticky top-0 z-40 flex h-12 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <Link to="/projects" className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-foreground/80">
        <BookOpen className="h-4 w-4" />
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
