/**
 * Convert plain text with paragraph breaks into HTML paragraphs for TipTap.
 * Each block separated by blank lines becomes a <p> tag.
 */
export function textToHtml(text: string): string {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim())
  if (paragraphs.length === 0) return '<p></p>'
  return paragraphs
    .map((p) => {
      // Single newlines within a paragraph become <br>
      const inner = p.trim().replace(/\n/g, '<br>')
      return `<p>${inner}</p>`
    })
    .join('')
}

/**
 * Convert TipTap HTML back to plain text with paragraph breaks.
 */
export function htmlToText(html: string): string {
  // Simple conversion: split on </p><p> and strip tags
  return html
    .replace(/<\/p>\s*<p[^>]*>/g, '\n\n')
    .replace(/<p[^>]*>/g, '')
    .replace(/<\/p>/g, '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim()
}
