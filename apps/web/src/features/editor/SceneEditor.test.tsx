import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SceneEditor } from './SceneEditor.js'

describe('SceneEditor', () => {
  it('mounts the editor (contenteditable surface)', () => {
    const onChange = vi.fn()
    render(<SceneEditor initialMarkdown="hi" onChangeMarkdown={onChange} />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('Tab triggers onAcceptSuggestion', () => {
    const onAccept = vi.fn()
    render(<SceneEditor initialMarkdown="hi" onChangeMarkdown={() => {}} onAcceptSuggestion={onAccept} />)
    const el = screen.getByRole('textbox') as HTMLElement
    el.focus()
    fireEvent.keyDown(el, { key: 'Tab' })
    expect(onAccept).toHaveBeenCalled()
  })

  it('Cmd+S triggers onForceSave', () => {
    const onSave = vi.fn()
    render(<SceneEditor initialMarkdown="hi" onChangeMarkdown={() => {}} onForceSave={onSave} />)
    const el = screen.getByRole('textbox') as HTMLElement
    el.focus()
    fireEvent.keyDown(el, { key: 's', metaKey: true })
    expect(onSave).toHaveBeenCalled()
  })
})
