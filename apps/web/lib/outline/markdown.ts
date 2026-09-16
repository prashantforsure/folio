import type { OutlineNode } from '@folio/script'
import { outlineNodeText } from '@folio/script'
import type { LabelBook } from '@folio/script'

/**
 * The outline as Markdown - the `⋯` menu's `Export as Markdown` (ruled
 * 2026-09-16, the Outline's v2 pass: the mockup titles the button "Export
 * outline" and nothing exported an outline, so the smallest honest export
 * is the one every editor reads).
 *
 * One block, one Markdown construct, in document order:
 *
 *   h1 / h2 / h3   `#` / `##` / `###`
 *   body           a paragraph
 *   quote          `> ` on every line
 *   beat           `1. ` with its ordinal among the beats - the number is
 *                  computed here as the page computes it, never stored -
 *                  and the lead (to the first colon) in bold, as drawn
 *   rule           `---`
 *
 * Mentions render as their label through the same book the page uses. A
 * block with no text still takes its line, so what comes out has the shape
 * the writer sees. Pure, and tested; the download itself is the
 * workspace's three lines of DOM.
 */

const BEAT_SEPARATOR = ':'

const boldLead = (text: string): string => {
  const at = text.indexOf(BEAT_SEPARATOR)
  if (at === -1) return text
  const lead = text.slice(0, at + 1)
  const rest = text.slice(at + 1)
  return `**${lead}**${rest}`
}

export const outlineMarkdown = (title: string, nodes: readonly OutlineNode[], labels: LabelBook): string => {
  const lines: string[] = [`# ${title}`]
  let beat = 0
  for (const node of nodes) {
    const text = outlineNodeText(node, labels)
    switch (node.type) {
      case 'h1':
        lines.push('', `## ${text}`)
        break
      case 'h2':
        lines.push('', `### ${text}`)
        break
      case 'h3':
        lines.push('', `#### ${text}`)
        break
      case 'body':
        lines.push('', text)
        break
      case 'quote':
        lines.push('', ...text.split('\n').map((line) => `> ${line}`))
        break
      case 'beat':
        beat += 1
        // Consecutive beats stay one list: no blank line between them.
        if (lines[lines.length - 1]?.match(/^\d+\. /u) === null) lines.push('')
        lines.push(`${String(beat)}. ${boldLead(text)}`)
        break
      case 'rule':
        lines.push('', '---')
        break
    }
  }
  return `${lines.join('\n')}\n`
}

/** `not-magic-just-this-outline.md`: the title as a slug, ASCII only, never empty. */
export const outlineFilename = (title: string): string => {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return `${slug === '' ? 'outline' : slug}-outline.md`
}
