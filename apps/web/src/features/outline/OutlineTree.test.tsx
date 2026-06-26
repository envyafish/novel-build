import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OutlineTree } from './OutlineTree.js'

describe('OutlineTree', () => {
  it('renders volumes/chapters/scenes and emits scene click', () => {
    const onSelect = vi.fn()
    render(
      <OutlineTree
        nodes={[
          {
            kind: 'volume',
            id: 1,
            label: 'Vol 1',
            children: [
              {
                kind: 'chapter',
                id: 2,
                label: 'Ch 1',
                status: 'draft',
                children: [{ kind: 'scene', id: 3, label: 'Scene 1', status: 'draft' }],
              },
            ],
          },
        ]}
        handlers={{
          onSelectScene: onSelect,
          onAddChapter: () => {},
          onAddScene: () => {},
        }}
      />,
    )
    fireEvent.click(screen.getByText('Scene 1'))
    expect(onSelect).toHaveBeenCalledWith(3)
  })

  it('shows status pill and triggers cycle when cycle button is clicked', () => {
    const onSelect = vi.fn()
    const onCycle = vi.fn()
    render(
      <OutlineTree
        nodes={[
          {
            kind: 'volume',
            id: 1,
            label: 'Vol 1',
            children: [
              {
                kind: 'chapter',
                id: 2,
                label: 'Ch 1',
                children: [{ kind: 'scene', id: 3, label: 'Scene 1', status: 'draft' }],
              },
            ],
          },
        ]}
        handlers={{
          onSelectScene: onSelect,
          onAddChapter: () => {},
          onAddScene: () => {},
          onCycleStatus: onCycle,
          onDeleteScene: () => {},
        }}
      />,
    )
    expect(screen.getByText('草稿')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('切换状态'))
    expect(onCycle).toHaveBeenCalledWith(3)
  })

  it('triggers delete when delete button is clicked', () => {
    const onDelete = vi.fn()
    render(
      <OutlineTree
        nodes={[
          {
            kind: 'volume',
            id: 1,
            label: 'Vol 1',
            children: [
              {
                kind: 'chapter',
                id: 2,
                label: 'Ch 1',
                children: [{ kind: 'scene', id: 3, label: 'Scene 1', status: 'draft' }],
              },
            ],
          },
        ]}
        handlers={{
          onSelectScene: () => {},
          onAddChapter: () => {},
          onAddScene: () => {},
          onDeleteScene: onDelete,
        }}
      />,
    )
    fireEvent.click(screen.getByLabelText('删除场景'))
    expect(onDelete).toHaveBeenCalledWith(3)
  })
})