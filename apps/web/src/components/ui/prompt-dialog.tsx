import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog'
import { Button } from './button'
import { Input } from './input'

export interface PromptField {
  name: string
  label: string
  placeholder?: string
  defaultValue?: string
  type?: 'text' | 'number'
  required?: boolean
  description?: string
}

interface PromptOptions {
  title: string
  description?: string
  fields: PromptField[]
  submitLabel?: string
  cancelLabel?: string
}

type PromptResult = Record<string, string> | null

interface PromptState extends PromptOptions {
  resolve: (v: PromptResult) => void
}

interface PromptContextValue {
  prompt: (opts: PromptOptions) => Promise<PromptResult>
}

const PromptContext = React.createContext<PromptContextValue | null>(null)

export function usePrompt(): PromptContextValue {
  const ctx = React.useContext(PromptContext)
  if (!ctx) throw new Error('usePrompt must be used within <PromptProvider>')
  return ctx
}

export function PromptProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<PromptState | null>(null)
  const valuesRef = React.useRef<Record<string, string>>({})
  const resolvedRef = React.useRef(false)

  const prompt = React.useCallback(
    (opts: PromptOptions) => {
      resolvedRef.current = false
      return new Promise<PromptResult>((resolve) => {
        const initial: Record<string, string> = {}
        for (const f of opts.fields) {
          initial[f.name] = f.defaultValue ?? ''
        }
        valuesRef.current = initial
        setState({ ...opts, resolve })
      })
    },
    [],
  )

  const handleClose = React.useCallback((result: PromptResult) => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    setState((s) => {
      if (s) s.resolve(result)
      return null
    })
  }, [])

  const handleSubmit = React.useCallback(() => {
    if (!state) return
    const values: Record<string, string> = {}
    for (const f of state.fields) {
      const v = valuesRef.current[f.name] ?? ''
      if (f.required && !v.trim()) return
      values[f.name] = v
    }
    handleClose(values)
  }, [state, handleClose])

  const value = React.useMemo<PromptContextValue>(() => ({ prompt }), [prompt])

  return (
    <PromptContext.Provider value={value}>
      {children}
      <Dialog
        open={state !== null}
        onOpenChange={(open) => {
          if (!open) handleClose(null)
        }}
      >
        <DialogContent showClose={false}>
          {state && (
            <>
              <DialogHeader>
                <DialogTitle>{state.title}</DialogTitle>
                {state.description && <DialogDescription>{state.description}</DialogDescription>}
              </DialogHeader>
              <form
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  handleSubmit()
                }}
              >
                {state.fields.map((f) => (
                  <div key={f.name} className="grid gap-1.5">
                    <label htmlFor={`prompt-${f.name}`} className="text-xs font-medium text-foreground">
                      {f.label}
                      {f.required && <span className="ml-0.5 text-destructive">*</span>}
                    </label>
                    <Input
                      id={`prompt-${f.name}`}
                      type={f.type ?? 'text'}
                      defaultValue={f.defaultValue ?? ''}
                      placeholder={f.placeholder}
                      autoFocus
                      onChange={(e) => {
                        valuesRef.current[f.name] = e.target.value
                      }}
                    />
                    {f.description && <p className="text-xs text-muted-foreground">{f.description}</p>}
                  </div>
                ))}
                <DialogFooter className="mt-2">
                  <Button type="button" variant="outline" onClick={() => handleClose(null)}>
                    {state.cancelLabel ?? '取消'}
                  </Button>
                  <Button type="submit">{state.submitLabel ?? '确定'}</Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PromptContext.Provider>
  )
}
