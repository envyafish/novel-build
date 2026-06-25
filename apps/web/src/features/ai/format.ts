/**
 * AI output formatter — cleans and normalizes generated text before inserting
 * into the editor. Handles common AI output artifacts in Chinese novel writing.
 */

export function formatAiOutput(text: string): string {
  let s = text

  // 1. Strip AI meta-commentary at the start/end
  s = s.replace(/^[\s\n]*(?:以下是|下面是|这是|这是生成的|输出|结果)[：:][\s\n]*/u, '')
  s = s.replace(/[\s\n]*(?:---+|===+|\*\*\*+)[\s\n]*$/u, '')
  s = s.replace(/^[\s\n]*(?:场景描述|章节内容|场景|章节)[：:][\s\n]*/u, '')

  // 2. Normalize line endings
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // 3. Remove excessive blank lines (max 1 blank line between paragraphs)
  s = s.replace(/\n{3,}/g, '\n\n')

  // 4. Trim each line's trailing whitespace
  s = s
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')

  // 5. Ensure paragraphs are separated by exactly one blank line
  //    (Chinese novels typically use a blank line between paragraphs in digital format)
  s = s.replace(/([^\n])\n([^\n])/g, '$1\n\n$2')

  // 6. Remove leading/trailing whitespace
  s = s.trim()

  // 7. Ensure the text ends with a newline
  if (s && !s.endsWith('\n')) {
    s += '\n'
  }

  return s
}

/**
 * Merge AI-generated text with existing editor content.
 * - If the editor is empty, just insert the generated text.
 * - If appending (continue), ensure proper paragraph separation.
 * - If replacing (rewrite/polish/expand/condense), the caller handles replacement.
 */
export function mergeWithExisting(existing: string, generated: string, mode: string): string {
  const formatted = formatAiOutput(generated)

  if (!existing.trim()) {
    return formatted
  }

  if (mode === 'continue') {
    // Ensure there's a paragraph break between existing and new text
    const trimmed = existing.trimEnd()
    return trimmed + '\n\n' + formatted
  }

  // For generate modes, replace the entire content
  if (mode === 'generate_scene' || mode === 'generate_chapter') {
    return formatted
  }

  // For edit modes (polish, rewrite, expand, condense), return just the formatted text
  // The caller will handle the replacement
  return formatted
}
