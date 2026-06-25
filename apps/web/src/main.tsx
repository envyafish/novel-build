import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { ThemeProvider } from '@/components/theme-provider'
import { ToastProvider } from '@/components/ui/toast'
import { ConfirmProvider } from '@/components/ui/confirm-dialog'
import { PromptProvider } from '@/components/ui/prompt-dialog'
import { router } from './App.js'
import './index.css'

const qc = new QueryClient()
const root = createRoot(document.getElementById('root')!)
root.render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="novel-ui-theme">
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <PromptProvider>
            <ConfirmProvider>
              <RouterProvider router={router} />
            </ConfirmProvider>
          </PromptProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
