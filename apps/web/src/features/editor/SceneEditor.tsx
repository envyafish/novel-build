import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useCallback } from 'react'
import { AiSuggestion } from './extension-ai-suggestion.js'
import { textToHtml, htmlToText } from './html-utils.js'
import { EditorFormattingBar } from './EditorFormattingBar.js'
import { cn } from '@/lib/utils'

interface Props {
  initialMarkdown: string
  onChangeMarkdown: (md: string) => void
  onSelectionText?: ((text: string | null) => void) | undefined
  onAcceptSuggestion?: (() => void) | undefined
  onRejectSuggestion?: (() => void) | undefined
  onForceSave?: (() => void) | undefined
  placeholder?: string | undefined
  onEditorReady?: ((api: { setContentFromText: (text: string) => void }) => void) | undefined
  focusMode?: boolean | undefined
  className?: string | undefined
}

export function SceneEditor({
  initialMarkdown,
  onChangeMarkdown,
  onSelectionText,
  onAcceptSuggestion,
  onRejectSuggestion,
  onForceSave,
  placeholder = '开始写…',
  onEditorReady,
  focusMode = false,
  className,
}: Props) {
  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder }), AiSuggestion],
    content: initialMarkdown,
    onUpdate({ editor }) {
      onChangeMarkdown(htmlToText(editor.getHTML()))
    },
    onSelectionUpdate({ editor }) {
      if (!onSelectionText) return
      const { from, to } = editor.state.selection
      const text = from === to ? null : editor.state.doc.textBetween(from, to, ' ')
      onSelectionText(text)
    },
    editorProps: {
      handleKeyDown(_view, event) {
        if (event.key === 'Tab' && onAcceptSuggestion) {
          onAcceptSuggestion()
          return true
        }
        if (event.key === 'Escape' && onRejectSuggestion) {
          onRejectSuggestion()
          return true
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          onForceSave?.()
          event.preventDefault()
          return true
        }
        return false
      },
    },
  })

  const setContentFromText = useCallback(
    (text: string) => {
      if (!editor) return
      const html = textToHtml(text)
      editor.commands.setContent(html, false)
      onChangeMarkdown(htmlToText(html))
    },
    [editor, onChangeMarkdown],
  )

  useEffect(() => {
    if (onEditorReady && editor) {
      onEditorReady({ setContentFromText })
    }
  }, [editor, onEditorReady, setContentFromText])

  useEffect(() => {
    if (!editor) return
    const currentText = htmlToText(editor.getHTML())
    if (initialMarkdown !== currentText && initialMarkdown.trim() !== currentText.trim()) {
      const html = textToHtml(initialMarkdown)
      editor.commands.setContent(html, false)
    }
  }, [editor, initialMarkdown])

  return (
    <div className={cn('mx-auto max-w-3xl px-8 py-6', className)}>
      {editor && <EditorFormattingBar editor={editor} />}
      <EditorContent editor={editor} className={cn('tiptap', focusMode && 'tiptap-focus')} />
    </div>
  )
}
