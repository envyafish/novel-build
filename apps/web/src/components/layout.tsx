import type { ReactNode } from 'react'
import { TopBar } from '@/components/topbar'

interface LayoutProps {
  breadcrumbs?: { label: string; href?: string }[] | undefined
  projectId?: number | undefined
  children: ReactNode
}

export function Layout({ breadcrumbs, projectId, children }: LayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <TopBar breadcrumbs={breadcrumbs} projectId={projectId} />
      <main className="flex-1">{children}</main>
    </div>
  )
}
