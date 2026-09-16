import type { MeasurementRecord, PageArtefact } from '@folio/script'

/**
 * From a measurement record to the page breaks the screen draws - the only
 * arithmetic left between the engine and the page since the redesign.
 *
 * `docs/ui design/README.md`, "Dark canvas, no paper": the script is text on
 * the app background, and the mockup marks a page as a hairline with `Page
 * 2` beside it. Ruled 2026-09-16: the body is Geist, proportional, wrapping
 * on its own; the engine still paginates in Courier for counts, eighths and
 * export, and what the screen draws of that is **where each page begins**,
 * as a divider placed from the record. The screen no longer wraps where the
 * engine wraps, so nothing here is a pixel: a break is a node, and for a
 * block the engine split across two pages, a character offset inside it.
 *
 * Page 1 has no divider - a document starts on it. A page whose first node
 * the record does not name (an empty page) has none either.
 *
 * `lib/script/layout.ts`, which turned the same record into per-block
 * margins and 816x1056 frames, went with the paper.
 */

export type PageBreak = {
  readonly ordinal: number
  /** The record's label - `12`, `12A` - so a locked page reads on screen as it will print. */
  readonly label: string
  readonly locked: boolean
  /** The node the page starts in. */
  readonly nodeId: string
  /**
   * The engine's line count of this node on the page before, when the page
   * begins inside the node; `null` when it begins at the node's start.
   */
  readonly afterLine: number | null
  /** `(MORE)` at the foot of the page before, when the record wrote one. */
  readonly more: string | null
  /** `NAME (CONT'D)` at the head of this page, when the record wrote one. */
  readonly continued: string | null
}

const artefactsOn = (record: MeasurementRecord, page: number): readonly PageArtefact[] =>
  record.pages[page - 1]?.artefacts ?? []

export const pageBreaksOf = (record: MeasurementRecord | null): readonly PageBreak[] => {
  if (record === null) return []
  const runsOf = new Map(record.nodes.map((node) => [node.id as string, node.runs]))
  const out: PageBreak[] = []
  for (const page of record.pages) {
    if (page.ordinal < 2 || page.firstNode === null) continue
    const nodeId = page.firstNode as string
    const runs = runsOf.get(nodeId) ?? []
    const before = runs.find((run) => run.page === page.ordinal - 1)
    const afterLine = before === undefined ? null : before.lines
    const more = artefactsOn(record, page.ordinal - 1).find(
      (artefact): artefact is Extract<PageArtefact, { kind: 'more' }> =>
        artefact.kind === 'more' && (artefact.afterNode as string) === nodeId,
    )
    const continued = artefactsOn(record, page.ordinal).find(
      (artefact): artefact is Extract<PageArtefact, { kind: 'cont-d' }> =>
        artefact.kind === 'cont-d' && (artefact.beforeNode as string) === nodeId,
    )
    out.push({
      ordinal: page.ordinal,
      label: page.label,
      locked: page.locked,
      nodeId,
      afterLine,
      more: more?.text ?? null,
      continued: continued?.text ?? null,
    })
  }
  return out
}

/** The breaks keyed by the node each begins in; a node can begin at most one page... except a very long one. */
export const pageBreaksByNode = (breaks: readonly PageBreak[]): ReadonlyMap<string, readonly PageBreak[]> => {
  const out = new Map<string, PageBreak[]>()
  for (const entry of breaks) {
    const list = out.get(entry.nodeId)
    if (list === undefined) out.set(entry.nodeId, [entry])
    else list.push(entry)
  }
  return out
}

/** The measure, in characters, for an element type. Comments take the action measure. */
export const charsPerLineFor = (sheet: MeasurementRecord['sheet'], type: string): number => {
  switch (type) {
    case 'scene':
      return sheet.element.scene.charsPerLine
    case 'character':
      return sheet.element.character.charsPerLine
    case 'paren':
      return sheet.element.paren.charsPerLine
    case 'dialogue':
      return sheet.element.dialogue.charsPerLine
    case 'transition':
      return sheet.element.transition.charsPerLine
    case 'subtitle':
      return sheet.element.subtitle.charsPerLine
    default:
      return sheet.element.action.charsPerLine
  }
}
