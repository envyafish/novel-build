import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'

const ProjectsPage = lazy(() => import('./features/projects/ProjectsPage.js').then(m => ({ default: m.ProjectsPage })))
const EditorPage = lazy(() => import('./features/editor/EditorPage.js').then(m => ({ default: m.EditorPage })))
const SettingsPage = lazy(() => import('./features/settings/SettingsPage.js').then(m => ({ default: m.SettingsPage })))

function Loading() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  )
}

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/projects" replace /> },
  { path: '/projects', element: <Suspense fallback={<Loading />}><ProjectsPage /></Suspense> },
  { path: '/projects/:id', element: <Suspense fallback={<Loading />}><EditorPage /></Suspense> },
  { path: '/projects/:id/settings', element: <Suspense fallback={<Loading />}><SettingsPage /></Suspense> },
])
