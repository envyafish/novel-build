import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProjectsPage } from './ProjectsPage.js'
import { ToastProvider } from '@/components/ui/toast'
import { ConfirmProvider } from '@/components/ui/confirm-dialog'
import { PromptProvider } from '@/components/ui/prompt-dialog'

const sampleProject = {
  id: 1,
  slug: 'a',
  name: 'A',
  createdAt: '',
  updatedAt: new Date().toISOString(),
  currentVolumeId: 1,
}

function makeFetch(projects: unknown[]) {
  return vi.fn(async (url: string) => {
    if (url === '/api/projects') {
      return new Response(JSON.stringify(projects), { status: 200 })
    }
    if (url.startsWith('/api/projects/') && url.endsWith('/stats')) {
      return new Response(JSON.stringify({ chapters: 3, scenes: 7, words: 1234 }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }) as typeof fetch
}

function renderPage() {
  const qc = new QueryClient()
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <PromptProvider>
            <ConfirmProvider>
              <ProjectsPage />
            </ConfirmProvider>
          </PromptProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('ProjectsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', makeFetch([sampleProject]))
  })

  it('lists existing projects with stats', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText(/1,234 字/)).toBeInTheDocument())
  })

  it('shows empty state when there are no projects', async () => {
    vi.stubGlobal('fetch', makeFetch([]))
    renderPage()
    await waitFor(() => expect(screen.getByText(/开始你的第一部小说/)).toBeInTheDocument())
  })

  it('clicking 新建项目 opens a prompt dialog', async () => {
    const user = userEvent.setup()
    renderPage()
    const btn = await screen.findByRole('button', { name: /新建项目/ })
    await user.click(btn)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByText('项目名称')).toBeInTheDocument()
  })
})
