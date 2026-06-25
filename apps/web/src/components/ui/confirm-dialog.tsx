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

interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

interface ConfirmState extends ConfirmOptions {
  resolve: (v: boolean) => void
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
}

const ConfirmContext = React.createContext<ConfirmContextValue | null>(null)

export function useConfirm(): ConfirmContextValue {
  const ctx = React.useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>')
  return ctx
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<ConfirmState | null>(null)
  const resolvedRef = React.useRef(false)

  const confirm = React.useCallback(
    (opts: ConfirmOptions) => {
      resolvedRef.current = false
      return new Promise<boolean>((resolve) => {
        setState({ ...opts, resolve })
      })
    },
    [],
  )

  const resolveOnce = React.useCallback(
    (value: boolean) => {
      if (resolvedRef.current) return
      resolvedRef.current = true
      setState((s) => {
        if (s) s.resolve(value)
        return null
      })
    },
    [],
  )

  const value = React.useMemo<ConfirmContextValue>(() => ({ confirm }), [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog
        open={state !== null}
        onOpenChange={(open) => {
          if (!open) resolveOnce(false)
        }}
      >
        <DialogContent
          showClose={false}
          onPointerDownOutside={() => resolveOnce(false)}
          onInteractOutside={() => resolveOnce(false)}
        >
          {state && (
            <>
              <DialogHeader>
                <DialogTitle>{state.title}</DialogTitle>
                {state.description && <DialogDescription>{state.description}</DialogDescription>}
              </DialogHeader>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => resolveOnce(false)}>
                  {state.cancelLabel ?? '取消'}
                </Button>
                <Button
                  type="button"
                  variant={state.destructive ? 'destructive' : 'default'}
                  onClick={() => resolveOnce(true)}
                >
                  {state.confirmLabel ?? '确认'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  )
}
