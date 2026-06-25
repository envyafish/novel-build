import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'

type Root = { type: 'root'; children: unknown[] }

const processor = unified().use(remarkParse).use(remarkStringify, { bullet: '-', listItemIndent: 'one' })

export function mdToMdast(md: string): Root {
  return processor.parse(md) as unknown as Root
}

export function mdastToMd(root: Root): string {
  return processor.stringify(root as unknown as Parameters<typeof processor.stringify>[0])
}

export function wordCount(md: string): number {
  return md.replace(/\s+/g, '').length
}
