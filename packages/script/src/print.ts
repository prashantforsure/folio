import type { NodeId } from './ids'
import type { MentionLabel } from './measure'
import { labelBook, renderedText, wrapText } from './measure'
import { modifiersOf } from './node'
import type { ScreenplayNode } from './node'
import type { MeasuredPage, MeasurementRecord, PlacedRun } from './paginate'
import type { Result } from './result'
import { err, ok } from './result'
import type { SheetSpec } from './sheet'
import type { RenderableNode } from './stream'
import { renderableNodes } from './stream'
import { MORE_TEXT, writeCue } from './generated-text'

/**
 * The printed page - roadmap task 5.3, AGENTS.md *Export*: "Export must agree
 * with on-screen pagination exactly. This is why the layout engine is ours."
 *
 * Pure: a node list and a **measurement record** in, every line of every page
 * out, each at the line and the inset the record and the sheet put it at. A
 * PDF writer (`apps/web/lib/script/pdf.ts`) draws what this returns and decides
 * nothing about where anything goes - so a page break, a `(MORE)` or a scene's
 * first page in the PDF is the one the Script route draws and the Scenes route
 * counts, because it is read off the same record.
 *
 * ## What the record gives, and what is recomputed
 *
 * A node's `runs` say which page each of its lines is on and at which line of
 * that page's text area; a page's `artefacts` say where a speech split. The
 * *text* of each line is not stored - it is recomputed here with the engine's
 * own `renderedText` and `wrapText`, at the element's measure, which is how the
 * engine counted it. If the recomputed wrap does not have the number of lines
 * the record placed, the record is not a measurement of this node list, and
 * this refuses (`measure-mismatch`) rather than draw a page nobody measured.
 *
 * ## What is a rendering decision, and only that
 *
 * Scene headings, cues and transitions are drawn upper case (the engine
 * measures them as typed: in a monospace sheet case cannot change a width, and
 * a letter whose upper case is longer - `ß` - is left as typed so it cannot
 * either). A cue's authored modifiers (`V.O.`, `O.S.`) are written after the
 * name on its last line, as the Script route draws them. A subtitle is italic.
 * `(MORE)` sits on the line under the last line it follows, at the cue's
 * inset; `(CONT'D)` - the cue again - opens the page it continues on.
 */

export type PrintStyle = 'plain' | 'italic'

export type PrintedLine = {
  /** 0-based line of the page's text area, as the record counts lines. */
  readonly line: number
  /** Inset from the sheet's left edge, in px at 96 dpi - the sheet's own unit. */
  readonly leftPx: number
  readonly text: string
  readonly style: PrintStyle
  readonly kind: RenderableNode['type'] | 'more' | 'cont-d'
}

export type PrintedPage = {
  readonly ordinal: number
  /** As printed: `12`, `12A`. Open decision 12's numbering past a lock is the engine's, printed as measured. */
  readonly label: string
  readonly lines: readonly PrintedLine[]
}

/** What printing reads of a measurement: the sheet, the pages, and each node's runs. A stored record and a fresh one both give it. */
export type PrintMeasure = {
  readonly sheet: SheetSpec
  readonly pages: readonly Pick<MeasuredPage, 'ordinal' | 'label' | 'linesUsed' | 'artefacts'>[]
  readonly runs: ReadonlyMap<string, readonly PlacedRun[]>
}

export type PrintMismatch = {
  readonly kind: 'measure-mismatch'
  readonly node: NodeId
  /** `unplaced`: the record has no line for it. `line-count`: it wraps to a different number of lines than the record placed. */
  readonly reason: 'unplaced' | 'line-count'
}

/** A fresh engine record, as printing reads it. */
export const printMeasureOf = (record: MeasurementRecord): PrintMeasure => ({
  sheet: record.sheet,
  pages: record.pages,
  runs: new Map(record.nodes.map((node) => [String(node.id), node.runs])),
})

const UPPER: readonly RenderableNode['type'][] = ['scene', 'character', 'transition']

/** Upper case that never changes a line's length - the sheet counted it as typed. */
export const upperKeepingWidth = (text: string): string => [...text].map((char) => (char.toUpperCase().length === char.length ? char.toUpperCase() : char)).join('')

/** A node's lines as printed: its wrapped text, cased, a cue carrying its modifiers on its last line. */
const printedText = (node: RenderableNode, wrapped: readonly string[]): readonly string[] => {
  const cased = UPPER.includes(node.type) ? wrapped.map(upperKeepingWidth) : wrapped
  const modifiers = modifiersOf(node)
  if (node.type !== 'character' || modifiers.length === 0) return cased
  const last = cased.length - 1
  return cased.map((line, index) => (index === last ? writeCue(line, modifiers) : line))
}

/**
 * Every page of the script as printed. `labels` names the records the
 * `@mentions` point at, as the engine was given them when it measured.
 */
export const printPages = (nodes: readonly ScreenplayNode[], measure: PrintMeasure, labels: readonly MentionLabel[]): Result<readonly PrintedPage[], PrintMismatch> => {
  const book = labelBook(labels)
  const byPage = new Map<number, PrintedLine[]>(measure.pages.map((page) => [page.ordinal, []]))
  const put = (page: number, line: PrintedLine): void => {
    const list = byPage.get(page)
    if (list === undefined) byPage.set(page, [line])
    else list.push(line)
  }
  const endOf = new Map<string, { readonly page: number; readonly line: number }>()

  for (const node of renderableNodes(nodes)) {
    const runs = measure.runs.get(String(node.id))
    if (runs === undefined || runs.length === 0) return err({ kind: 'measure-mismatch', node: node.id, reason: 'unplaced' })
    const metric = measure.sheet.element[node.type]
    const wrapped = wrapText(renderedText(node.content, book).text, metric.charsPerLine)
    const placed = runs.reduce((total, run) => total + run.lines, 0)
    if (wrapped.length !== placed) return err({ kind: 'measure-mismatch', node: node.id, reason: 'line-count' })
    const text = printedText(node, wrapped)
    let offset = 0
    for (const run of runs) {
      for (let at = 0; at < run.lines; at += 1) {
        put(run.page, { line: run.startLine + at, leftPx: metric.leftPx, text: text[offset + at] ?? '', style: node.type === 'subtitle' ? 'italic' : 'plain', kind: node.type })
      }
      offset += run.lines
      endOf.set(`${String(node.id)}@${String(run.page)}`, { page: run.page, line: run.startLine + run.lines })
    }
  }

  const cueInset = measure.sheet.element.character.leftPx
  for (const page of measure.pages) {
    for (const artefact of page.artefacts) {
      if (artefact.kind === 'cont-d') {
        // The continuation opens its page: the engine commits it first, on a fresh page.
        put(page.ordinal, { line: 0, leftPx: cueInset, text: upperKeepingWidth(artefact.text), style: 'plain', kind: 'cont-d' })
        continue
      }
      const after = endOf.get(`${String(artefact.afterNode)}@${String(page.ordinal)}`)
      put(page.ordinal, { line: after?.line ?? Math.max(0, page.linesUsed - 1), leftPx: cueInset, text: MORE_TEXT, style: 'plain', kind: 'more' })
    }
  }

  return ok(
    measure.pages.map((page) => ({
      ordinal: page.ordinal,
      label: page.label,
      lines: [...(byPage.get(page.ordinal) ?? [])].sort((a, b) => a.line - b.line || a.leftPx - b.leftPx),
    })),
  )
}

// ---------------------------------------------------------------------------
// The title page
// ---------------------------------------------------------------------------

/** The cover's fields - Fountain's title-page keys, as `title_pages` stores them. Every one may be missing. */
export type TitlePageFields = {
  readonly title: string | null
  readonly credit: string | null
  readonly author: string | null
  readonly source: string | null
  readonly draftDate: string | null
  readonly contact: string | null
  readonly copyright: string | null
  readonly notes: string | null
}

export type TitleLine = { readonly line: number; readonly leftPx: number; readonly text: string; readonly style: 'plain' | 'bold' }

const filled = (value: string | null): readonly string[] =>
  value === null ? [] : value.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length > 0)

/**
 * The title page, on the same sheet (AGENTS.md *Export*: "a separate document
 * on the same sheet geometry, exported with the script"): the title in bold
 * capitals a third of the way down, the credit, the author and the source
 * centred under it; the contact bottom left and the draft date, the copyright
 * and the notes bottom right. Every line is wrapped at the action measure, so
 * nothing runs off the sheet. A cover with no fields still prints the title
 * it is given.
 */
export const printTitlePage = (fields: TitlePageFields, sheet: SheetSpec): readonly TitleLine[] => {
  const measure = sheet.element.action.charsPerLine
  const width = (text: string): number => [...text].length * sheet.charWidthPx
  const centred = (text: string): number => Math.max(0, Math.round((sheet.widthPx - width(text)) / 2))
  const rightEdge = sheet.widthPx - sheet.element.action.rightPx
  const wrap = (lines: readonly string[]): readonly string[] => lines.flatMap((line) => wrapText(line, measure))

  const out: TitleLine[] = []
  let line = Math.floor(sheet.linesPerPage / 3)
  for (const text of wrap(filled(fields.title)).map(upperKeepingWidth)) out.push({ line: line++, leftPx: centred(text), text, style: 'bold' })
  line += 1
  for (const block of [fields.credit, fields.author, fields.source]) {
    const lines = wrap(filled(block))
    if (lines.length === 0) continue
    for (const text of lines) out.push({ line: line++, leftPx: centred(text), text, style: 'plain' })
    line += 1
  }

  // Bottom left: the contact. Bottom right: the date, the copyright, the notes - both ending on the last line.
  const contact = wrap(filled(fields.contact))
  contact.forEach((text, index) => out.push({ line: sheet.linesPerPage - contact.length + index, leftPx: sheet.element.action.leftPx, text, style: 'plain' }))
  const right = wrap([...filled(fields.draftDate), ...filled(fields.copyright), ...filled(fields.notes)])
  right.forEach((text, index) => out.push({ line: sheet.linesPerPage - right.length + index, leftPx: Math.max(sheet.element.action.leftPx, Math.round(rightEdge - width(text))), text, style: 'plain' }))
  return out
}
