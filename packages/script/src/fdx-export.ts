import type { FdxNode } from './fdx'
import { fdxNode } from './fdx'
import { writeCue } from './generated-text'
import type { NodeId } from './ids'
import type { LabelBook, MentionLabel, UnresolvedMention } from './measure'
import { labelBook, renderedText } from './measure'
import type { ScreenplayNode } from './node'

/**
 * A node list to Final Draft - the other half of `fdx.ts`.
 *
 * ## Why this returns a tree and not a string
 *
 * The same ruling as the importer's: the mapping is here and pure, the XML is
 * the caller's. `serialiseFinalDraft` returns an `FdxNode` tree - the contract
 * *we* own - and `apps/web` writes it out with `fast-xml-parser`'s
 * `XMLBuilder` (`preserveOrder: true`, the mirror of the parser's). This
 * package still has zero dependencies and this function runs identically in
 * the browser, in server code, in the worker and in tests.
 *
 * ## The mapping, and the round trip it keeps
 *
 * The contract is the Fountain writer's: `importFinalDraft(serialiseFinalDraft(nodes))`
 * is the identity on `type`, `content` and `modifiers` for every node that is
 * not reported in `omitted` or `unrepresentable`. So:
 *
 *   scene        `Type="Scene Heading"`. **No `SceneProperties`, no `Number`.**
 *                The importer discards them on the way in because a page number
 *                on a node is banned; nothing here can invent one on the way out.
 *   action       `Type="Action"`
 *   character    `Type="Character"`, the cue written by `writeCue` - name and
 *                authored modifiers, `MEERA (V.O.)` - which `readCue` reads back.
 *   paren        `Type="Parenthetical"`
 *   dialogue     one `Type="Dialogue"` paragraph per line of the speech. The
 *                importer joins consecutive Dialogue paragraphs with `\n`, so a
 *                speech that arrived as three paragraphs leaves as three.
 *   transition   `Type="Transition"`
 *   subtitle     `Type="General"` with `Alignment="Center"`. Final Draft has no
 *                subtitle; the importer coerces General to Action, so this is
 *                reported as `subtitle-as-general` - a fact the writer is
 *                entitled to before Final Draft shows them.
 *   comment      **omitted.** AGENTS.md, Export: comments never enter an
 *                export. Listed in `omitted` so the count is visible.
 *
 * `(MORE)` and `(CONT'D)` are never written. They are layout artefacts on a
 * measurement record, and Final Draft paginates for itself.
 *
 * A mention is written as its record's label, resolved through the same label
 * book the paginator uses; one with no record is written as the engine's
 * placeholder and reported. An empty block is written as an empty paragraph
 * and reported: the importer drops a paragraph with no text, so it would not
 * come back.
 */

export type FdxUnrepresentable =
  | { readonly id: NodeId; readonly reason: 'subtitle-as-general' }
  | { readonly id: NodeId; readonly reason: 'empty-block' }
  | { readonly id: NodeId; readonly reason: 'unresolved-mention'; readonly mention: UnresolvedMention }

export type FdxExport = {
  readonly root: FdxNode
  /** Comment nodes, which never enter an export. */
  readonly omitted: readonly NodeId[]
  readonly unrepresentable: readonly FdxUnrepresentable[]
}

export type FdxExportOptions = {
  readonly mentionLabels?: readonly MentionLabel[]
}

const paragraph = (attributes: Readonly<Record<string, string>>, text: string): FdxNode =>
  fdxNode('Paragraph', { attributes, children: [fdxNode('Text', { text })] })

const FINAL_DRAFT_ATTRIBUTES: Readonly<Record<string, string>> = {
  DocumentType: 'Script',
  Template: 'No',
  Version: '5',
}

export const serialiseFinalDraft = (nodes: readonly ScreenplayNode[], options: FdxExportOptions = {}): FdxExport => {
  const book: LabelBook = labelBook(options.mentionLabels ?? [])
  const paragraphs: FdxNode[] = []
  const omitted: NodeId[] = []
  const unrepresentable: FdxUnrepresentable[] = []

  for (const node of nodes) {
    if (node.type === 'comment') {
      omitted.push(node.id)
      continue
    }
    const rendered = renderedText(node.content, book)
    for (const mention of rendered.unresolved) unrepresentable.push({ id: node.id, reason: 'unresolved-mention', mention })
    if (rendered.text.trim() === '') unrepresentable.push({ id: node.id, reason: 'empty-block' })

    switch (node.type) {
      case 'scene':
        paragraphs.push(paragraph({ Type: 'Scene Heading' }, rendered.text))
        break
      case 'action':
        paragraphs.push(paragraph({ Type: 'Action' }, rendered.text))
        break
      case 'character':
        paragraphs.push(paragraph({ Type: 'Character' }, writeCue(rendered.text, node.modifiers)))
        break
      case 'paren':
        paragraphs.push(paragraph({ Type: 'Parenthetical' }, rendered.text))
        break
      case 'dialogue':
        for (const line of rendered.text.split('\n')) paragraphs.push(paragraph({ Type: 'Dialogue' }, line))
        break
      case 'transition':
        paragraphs.push(paragraph({ Type: 'Transition' }, rendered.text))
        break
      case 'subtitle':
        unrepresentable.push({ id: node.id, reason: 'subtitle-as-general' })
        paragraphs.push(paragraph({ Type: 'General', Alignment: 'Center' }, rendered.text))
        break
    }
  }

  const root = fdxNode('FinalDraft', {
    attributes: FINAL_DRAFT_ATTRIBUTES,
    children: [fdxNode('Content', { children: paragraphs })],
  })
  return { root, omitted, unrepresentable }
}
