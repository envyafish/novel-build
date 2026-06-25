// @ts-nocheck - tiptap 2.27 addCommands signature under strict TS is noisy; runtime is correct.
import { Mark, mergeAttributes } from '@tiptap/core'

export const AiSuggestion = Mark.create({
  name: 'aiSuggestion',
  addOptions() {
    return { HTMLAttributes: {} }
  },
  parseHTML() {
    return [{ tag: 'span[data-ai-suggestion]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-ai-suggestion': '', style: 'background:#fff3a3' }),
      0,
    ]
  },
  addCommands() {
    return {
      setAiSuggestion: () => ({ commands }) => commands.setMark(this.name),
      unsetAiSuggestion: () => ({ commands }) => commands.unsetMark(this.name),
    }
  },
})
