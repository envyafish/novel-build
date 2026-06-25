// @ts-nocheck - Fastify 4 + @types/node 25 route inference under exactOptionalPropertyTypes is noisy; runtime is correct.
import type { Database } from '../db/sqlite.js'
import type { SceneRow, ChapterRow, VolumeRow } from '../db/types.js'
import { readManuscript } from '../manuscripts/io.js'
import { manuscriptPath } from '../projects/paths.js'
import { apiError } from '../errors.js'
import JSZip from 'jszip'
import path from 'node:path'

type ExportFormat = 'txt' | 'markdown' | 'html' | 'epub'

interface SceneWithMeta {
  scene: SceneRow
  chapter: ChapterRow
  volume: VolumeRow
}

function collectScenes(db: Database, projectId: number): SceneWithMeta[] {
  const volumes = db.prepare<VolumeRow>('SELECT * FROM volumes WHERE project_id = ? ORDER BY order_index').all(projectId)
  const result: SceneWithMeta[] = []
  for (const vol of volumes) {
    const chapters = db.prepare<ChapterRow>('SELECT * FROM chapters WHERE volume_id = ? ORDER BY order_index').all(vol.id)
    for (const chap of chapters) {
      const scenes = db.prepare<SceneRow>('SELECT * FROM scenes WHERE chapter_id = ? ORDER BY order_index').all(chap.id)
      for (const scene of scenes) {
        result.push({ scene, chapter: chap, volume: vol })
      }
    }
  }
  return result
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function mdToHtml(md: string): string {
  return md
    .split(/\n{2,}/)
    .map((p) => {
      const trimmed = p.trim()
      if (!trimmed) return ''
      if (trimmed.startsWith('# '))
        return `<h1>${escHtml(trimmed.slice(2))}</h1>`
      if (trimmed.startsWith('## '))
        return `<h2>${escHtml(trimmed.slice(3))}</h2>`
      if (trimmed.startsWith('### '))
        return `<h3>${escHtml(trimmed.slice(4))}</h3>`
      if (trimmed.startsWith('> '))
        return `<blockquote><p>${escHtml(trimmed.slice(2))}</p></blockquote>`
      return `<p style="text-indent:2em">${escHtml(trimmed)}</p>`
    })
    .filter(Boolean)
    .join('\n')
}

function buildTxt(projectName: string, items: Array<{ volume: string; chapter: string; text: string }>): string {
  const lines: string[] = [projectName, '='.repeat(projectName.length), '']
  let currentVol = ''
  for (const item of items) {
    if (item.volume !== currentVol) {
      currentVol = item.volume
      lines.push('')
      lines.push(currentVol)
      lines.push('-'.repeat(currentVol.length))
      lines.push('')
    }
    lines.push(item.chapter)
    lines.push('')
    if (item.text) {
      lines.push(item.text)
      lines.push('')
    }
  }
  return lines.join('\n')
}

function buildMarkdown(projectName: string, items: Array<{ volume: string; chapter: string; text: string }>): string {
  const lines: string[] = [`# ${projectName}`, '']
  let currentVol = ''
  for (const item of items) {
    if (item.volume !== currentVol) {
      currentVol = item.volume
      lines.push(`## ${currentVol}`, '')
    }
    lines.push(`### ${item.chapter}`, '')
    if (item.text) {
      lines.push(item.text, '')
    }
  }
  return lines.join('\n')
}

function buildHtml(projectName: string, items: Array<{ volume: string; chapter: string; text: string }>): string {
  let body = ''
  let currentVol = ''
  for (const item of items) {
    if (item.volume !== currentVol) {
      currentVol = item.volume
      body += `<h1 style="page-break-before:always">${escHtml(currentVol)}</h1>\n`
    }
    body += `<h2>${escHtml(item.chapter)}</h2>\n`
    if (item.text) {
      body += mdToHtml(item.text) + '\n'
    }
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escHtml(projectName)}</title>
<style>
  body { max-width: 42rem; margin: 2rem auto; padding: 0 1rem; font-family: "Source Han Serif SC","Noto Serif CJK SC","Songti SC",Georgia,serif; font-size: 1.1rem; line-height: 1.9; color: #222; }
  h1 { font-size: 1.6rem; margin: 2rem 0 1rem; text-align: center; }
  h2 { font-size: 1.3rem; margin: 1.5rem 0 0.8rem; }
  p { margin: 0 0 0.5rem; }
  blockquote { border-left: 3px solid #ccc; padding-left: 1rem; color: #555; margin: 1rem 0; }
  @media print { body { max-width: none; margin: 0; } }
</style>
</head>
<body>
<h1 style="text-align:center;font-size:2rem;margin-bottom:2rem">${escHtml(projectName)}</h1>
${body}
</body>
</html>`
}

// EPUB-specific CSS
const EPUB_CSS = `body {
  font-family: "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "Microsoft YaHei", Georgia, serif;
  line-height: 1.8;
  margin: 1em;
}
h1 { font-size: 1.6em; margin: 1.5em 0 0.8em; text-align: center; page-break-before: always; }
h2 { font-size: 1.3em; margin: 1.2em 0 0.6em; }
h3 { font-size: 1.1em; margin: 1em 0 0.5em; }
p { margin: 0.5em 0; text-indent: 2em; }
blockquote { border-left: 3px solid #ccc; padding-left: 1em; color: #555; margin: 1em 0; }
.title-page { text-align: center; padding: 30% 0; page-break-after: always; }
.title-page h1 { font-size: 2.2em; margin: 0; page-break-before: avoid; }
`

function buildEpubXhtml(projectName: string, projectTheme: string, items: Array<{ volume: string; chapter: string; text: string }>, isTitlePage: boolean = false): string {
  if (isTitlePage) {
    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escXml(projectName)}</title>
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
  <div class="title-page">
    <h1>${escXml(projectName)}</h1>
    ${projectTheme ? `<p style="text-indent:0;margin-top:2em;font-style:italic;color:#666">${escXml(projectTheme)}</p>` : ''}
  </div>
</body>
</html>`
  }

  let body = ''
  let currentVol = ''
  for (const item of items) {
    if (item.volume !== currentVol) {
      currentVol = item.volume
      body += `<h1>${escHtml(currentVol)}</h1>\n`
    }
    body += `<h2>${escHtml(item.chapter)}</h2>\n`
    if (item.text) {
      body += mdToHtml(item.text) + '\n'
    }
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escXml(projectName)}</title>
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
${body}
</body>
</html>`
}

async function buildEpub(projectName: string, projectTheme: string, items: Array<{ volume: string; chapter: string; text: string }>): Promise<Buffer> {
  // Group items into "chapters" (one per volume+chapter) for EPUB structure
  // Each unique volume+chapter pair becomes one xhtml file
  const chapterGroups: Map<string, { volume: string; chapter: string; texts: string[] }> = new Map()
  for (const item of items) {
    const key = `${item.volume}::${item.chapter}`
    if (!chapterGroups.has(key)) {
      chapterGroups.set(key, { volume: item.volume, chapter: item.chapter, texts: [] })
    }
    if (item.text) chapterGroups.get(key)!.texts.push(item.text)
  }

  const zip = new JSZip()

  // mimetype - must be stored uncompressed as the first entry
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })

  // META-INF/container.xml
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`)

  // OEBPS/style.css
  zip.file('OEBPS/style.css', EPUB_CSS)

  // Title page
  zip.file('OEBPS/title.xhtml', buildEpubXhtml(projectName, projectTheme, [], true))

  // Chapter xhtml files
  const chapterKeys: string[] = []
  let chNum = 1
  for (const [key, group] of chapterGroups) {
    chapterKeys.push(key)
    const fileName = `chapter-${chNum}.xhtml`
    const title = `${group.volume} - ${group.chapter}`
    const text = group.texts.join('\n\n')
    const itemsForChapter = [{ volume: group.volume, chapter: group.chapter, text }]
    zip.file(`OEBPS/${fileName}`, buildEpubXhtml(title, '', itemsForChapter, false))
    chNum++
  }

  // Build manifest items and spine
  const manifestItems: string[] = [
    `<item id="title" href="title.xhtml" media-type="application/xhtml+xml" />`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />`,
    `<item id="style" href="style.css" media-type="text/css" />`,
  ]
  const spineItems: string[] = [`<itemref idref="title" />`]
  const navPoints: string[] = []
  let navId = 1
  for (let i = 0; i < chapterKeys.length; i++) {
    const key = chapterKeys[i]
    const [vol, chap] = key.split('::')
    const id = `ch${i + 1}`
    const fileName = `chapter-${i + 1}.xhtml`
    manifestItems.push(`<item id="${id}" href="${fileName}" media-type="application/xhtml+xml" />`)
    spineItems.push(`<itemref idref="${id}" />`)
    navPoints.push(`<navPoint id="np${navId}" playOrder="${navId + 1}">
  <navLabel><text>${escXml(`${vol} - ${chap}`)}</text></navLabel>
  <content src="${fileName}" />
</navPoint>`)
    navId++
  }

  // OEBPS/content.opf
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${Date.now()}-${Math.random().toString(36).slice(2, 10)}</dc:identifier>
    <dc:title>${escXml(projectName)}</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:creator>${escXml(projectName)}</dc:creator>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${spineItems.join('\n    ')}
  </spine>
</package>`
  zip.file('OEBPS/content.opf', opf)

  // OEBPS/toc.ncx
  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${Date.now()}-${Math.random().toString(36).slice(2, 10)}" />
    <meta name="dtb:depth" content="1" />
  </head>
  <docTitle><text>${escXml(projectName)}</text></docTitle>
  <navMap>
    <navPoint id="navPoint-1" playOrder="1">
      <navLabel><text>封面</text></navLabel>
      <content src="title.xhtml" />
    </navPoint>
    ${navPoints.join('\n    ')}
  </navMap>
</ncx>`
  zip.file('OEBPS/toc.ncx', ncx)

  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

export function registerExportRoutes(app: any, db: Database, novelsDir: string) {
  app.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    '/api/projects/:id/export',
    async (req, reply) => {
      const projectId = Number(req.params.id)
      const format: ExportFormat = (req.query.format as ExportFormat) || 'txt'
      if (!['txt', 'markdown', 'html', 'epub'].includes(format)) {
        throw apiError(400, 'invalid_format', '支持的格式: txt, markdown, html, epub')
      }

      const project = db
        .prepare<{ name: string; slug: string; theme: string }>(
          'SELECT name, slug, theme FROM projects WHERE id = ?',
        )
        .get(projectId)
      if (!project) throw apiError(404, 'project_not_found', `project ${projectId} not found`)

      const sceneMetas = collectScenes(db, projectId)
      if (sceneMetas.length === 0) {
        throw apiError(422, 'empty_project', '项目没有场景，无法导出')
      }

      const items: Array<{ volume: string; chapter: string; text: string }> = []
      for (const { scene, chapter, volume } of sceneMetas) {
        const file = manuscriptPath(path.join(novelsDir, project.slug), volume.slug, chapter.slug, scene.slug)
        const { text } = await readManuscript(file)
        items.push({ volume: volume.name, chapter: chapter.title, text })
      }

      if (format === 'epub') {
        const buf = await buildEpub(project.name, project.theme ?? '', items)
        reply
          .header('Content-Type', 'application/epub+zip')
          .header(
            'Content-Disposition',
            `attachment; filename="${encodeURIComponent(project.name)}.epub"`,
          )
        return reply.send(buf)
      }

      let content: string
      let contentType: string
      let ext: string

      if (format === 'txt') {
        content = buildTxt(project.name, items)
        contentType = 'text/plain; charset=utf-8'
        ext = 'txt'
      } else if (format === 'markdown') {
        content = buildMarkdown(project.name, items)
        contentType = 'text/markdown; charset=utf-8'
        ext = 'md'
      } else {
        content = buildHtml(project.name, items)
        contentType = 'text/html; charset=utf-8'
        ext = 'html'
      }

      reply
        .header('Content-Type', contentType)
        .header('Content-Disposition', `attachment; filename="${encodeURIComponent(project.name)}.${ext}"`)
      return reply.send(content)
    },
  )
}
