import type { MeasurementRecord, NodeMeasurement, PageArtefact, SheetSpec } from '@folio/script'

/**
 * From a measurement record to pixels - the only arithmetic between the
 * engine and the sheet.
 *
 * The sheet is one contiguous editable column (Slate needs one), so a page
 * cannot be a DOM box that blocks live inside. Instead the blocks flow, and
 * three things are computed from the record so that the flow lands every
 * block exactly where the engine put it:
 *
 *   - **each block's top margin**, from the line it starts on relative to
 *     the line the previous block ended on - including the jump across a
 *     page boundary, which is the rest of the old page, the gap between
 *     sheets, and the new page's top margin;
 *   - **a gap inside a block that the engine split** across two pages, drawn
 *     after the last line on the first page, carrying `(MORE)` and the
 *     `(CONT'D)` cue the record says to draw there;
 *   - **the page frames**, absolutely positioned behind the flow at
 *     `ordinal x (height + gap)`, each with its printed label.
 *
 * Every number here is derived from `sheet.lineHeightPx` and the record's
 * `startLine` / `lines`. Nothing measures the DOM, so the layout is the same
 * on the server-rendered first paint and after hydration, and the same as
 * the PDF will be. A block the record does not know about yet - typed since
 * the last measurement - takes the sheet's own blank-line rule for its type
 * and flows on; the next measurement corrects it.
 *
 * Comment nodes occupy zero page space in the record, but they are drawn,
 * and they take *screen* space: the text under a comment moves down by its
 * height, and so does every page frame from that page on, whose own height
 * grows by the comments drawn inside it. Nothing in the record moves - a
 * comment is an inline note pinned between two lines of the printed page.
 * The drawn height is line-based and fixed (see `commentHeightPx`) so it can
 * be known without measuring the DOM.
 */

/** Space between sheets, in the desk. */
export const PAGE_GAP_PX = 24

/** The comment block's chrome: 8px above, 4px + 4px inside, one 16px label line. */
const COMMENT_MARGIN_TOP_PX = 8
const COMMENT_PADDING_PX = 8
const COMMENT_LABEL_PX = 16

export const commentHeightPx = (textLines: number, lineHeightPx: number): number =>
  COMMENT_MARGIN_TOP_PX + COMMENT_PADDING_PX + COMMENT_LABEL_PX + textLines * lineHeightPx

export type SplitGap = {
  /** After this many of the block's own lines, the page ends. */
  readonly afterLine: number
  readonly heightPx: number
  /** `(MORE)`, drawn at the foot of the first page, when the block is dialogue. */
  readonly more: string | null
  /** `NAME (CONT'D)`, drawn at the head of the next page, when the block is dialogue. */
  readonly continued: string | null
}

export type BlockLayout = {
  readonly marginTopPx: number
  readonly gap: SplitGap | null
  /** True when the record placed this block. False for a block typed since. */
  readonly measured: boolean
}

export type PageFrame = {
  readonly ordinal: number
  readonly label: string
  readonly topPx: number
  /** The sheet's height plus any comment drawn on this page. */
  readonly heightPx: number
  readonly locked: boolean
}

export type SheetLayout = {
  readonly blocks: ReadonlyMap<string, BlockLayout>
  readonly frames: readonly PageFrame[]
  /** The desk column's height: enough for every frame. */
  readonly heightPx: number
  readonly paged: boolean
}

/** What one block needs to have been told about itself to be laid out. */
export type BlockToLayout = {
  readonly id: string
  readonly type: string
  /** Lines the block occupies on screen, by the engine's own wrap. */
  readonly lines: number
}

const pageTopPx = (sheet: SheetSpec, page: number, paged: boolean): number =>
  paged ? (page - 1) * (sheet.heightPx + PAGE_GAP_PX) : 0

/** The y of a text line, page-relative lines into desk pixels. */
const lineY = (sheet: SheetSpec, page: number, line: number, paged: boolean): number =>
  pageTopPx(sheet, page, paged) + sheet.marginTopPx + line * sheet.lineHeightPx

const artefactsFor = (
  pages: MeasurementRecord['pages'],
  page: number,
): readonly PageArtefact[] => pages[page - 1]?.artefacts ?? []

/**
 * Lay the blocks out against the record.
 *
 * `blocks` is the editor's current block list, in order. Blocks the record
 * knows are placed by it; the rest flow on the sheet's blank-line rule.
 *
 * The walk keeps `endY`, the desk-pixel y where the previous block's text
 * ended *in record space* (comments excluded), and gives each block the
 * distance from there to where the record puts it. Comments push the whole
 * flow down by their drawn height; because every frame from that page on is
 * pushed by the same amount, the margins between text blocks never mention
 * a comment at all.
 *
 * A block whose text changed since the record was made is **stale**: its
 * drawn height is its current line count, not the record's. From a stale
 * block until the next page crossing the flow follows the blank-line rule
 * instead of snapping to recorded positions, so a block that grew by a line
 * cannot be overdrawn by the one below it. The next measurement puts
 * everything back exactly.
 */
export const layoutSheet = (
  blocks: readonly BlockToLayout[],
  record: MeasurementRecord | null,
  sheet: SheetSpec,
  paged: boolean,
): SheetLayout => {
  const measured = new Map<string, NodeMeasurement>(
    (record?.nodes ?? []).map((node) => [node.id, node]),
  )
  const out = new Map<string, BlockLayout>()
  const lh = sheet.lineHeightPx

  let endY = pageTopPx(sheet, 1, paged)
  let page = 1
  /** Comment height drawn on each page, by ordinal. Pushes that page's bottom and every later frame. */
  const extraOnPage = new Map<number, number>()
  let drift = false
  let first = true

  for (const block of blocks) {
    if (block.type === 'comment') {
      out.set(block.id, { marginTopPx: COMMENT_MARGIN_TOP_PX, gap: null, measured: true })
      extraOnPage.set(page, (extraOnPage.get(page) ?? 0) + commentHeightPx(block.lines, lh))
      continue
    }

    const flowMargin = first ? sheet.marginTopPx : blankLinesBefore(sheet, block.type) * lh
    const placed = measured.get(block.id)
    const run = placed?.runs[0]

    if (placed === undefined || run === undefined) {
      out.set(block.id, { marginTopPx: flowMargin, gap: null, measured: false })
      endY += flowMargin + block.lines * lh
      first = false
      drift = true
      continue
    }

    const stale = placed.lines !== block.lines
    const crossesPage = !first && run.page > page
    if (crossesPage) drift = false
    const start = lineY(sheet, run.page, run.startLine, paged)
    const nominal = drift && !crossesPage ? flowMargin : start - endY
    first = false
    page = run.page

    if (stale || drift) {
      // Stale, or downstream of something stale on this page: flow on reality.
      out.set(block.id, { marginTopPx: nominal, gap: null, measured: !stale })
      endY += nominal + block.lines * lh
      drift = true
      continue
    }

    let gap: SplitGap | null = null
    const second = placed.runs[1]
    if (second !== undefined && paged) {
      const firstEnd = lineY(sheet, run.page, run.startLine + run.lines, paged)
      const secondStart = lineY(sheet, second.page, second.startLine, paged)
      const more = artefactsFor(record?.pages ?? [], run.page).find(
        (artefact): artefact is Extract<PageArtefact, { kind: 'more' }> =>
          artefact.kind === 'more' && artefact.afterNode === block.id,
      )
      const continued = artefactsFor(record?.pages ?? [], second.page).find(
        (artefact): artefact is Extract<PageArtefact, { kind: 'cont-d' }> =>
          artefact.kind === 'cont-d' && artefact.beforeNode === block.id,
      )
      gap = {
        afterLine: run.lines,
        heightPx: secondStart - firstEnd,
        more: more?.text ?? null,
        continued: continued?.text ?? null,
      }
    }

    out.set(block.id, { marginTopPx: nominal, gap, measured: true })
    const last = placed.runs[placed.runs.length - 1] ?? run
    page = last.page
    endY = lineY(sheet, last.page, last.startLine + last.lines, paged)
  }

  const recorded = record?.pages ?? []
  const ordinals = paged && recorded.length > 0 ? recorded.map((entry) => entry.ordinal) : [1]
  let pushed = 0
  const frames: PageFrame[] = []
  if (paged) {
    for (const ordinal of ordinals) {
      const entry = recorded[ordinal - 1]
      const extra = extraOnPage.get(ordinal) ?? 0
      frames.push({
        ordinal,
        label: entry?.label ?? String(ordinal),
        topPx: pageTopPx(sheet, ordinal, paged) + pushed,
        heightPx: sheet.heightPx + extra,
        locked: entry?.locked ?? false,
      })
      pushed += extra
    }
  }
  const totalExtra = [...extraOnPage.values()].reduce((total, extra) => total + extra, 0)

  const pages = Math.max(1, ordinals.length)
  const heightPx = paged
    ? Math.max(pages * sheet.heightPx + (pages - 1) * PAGE_GAP_PX + totalExtra, endY + totalExtra + sheet.marginBottomPx)
    : Math.max(sheet.heightPx, endY + totalExtra + sheet.marginBottomPx)

  return { blocks: out, frames, heightPx, paged }
}

/** The blank lines the sheet puts above an element mid-page. Comments have none. */
export const blankLinesBefore = (sheet: SheetSpec, type: string): number => {
  switch (type) {
    case 'scene':
      return sheet.element.scene.blankLinesBefore
    case 'action':
      return sheet.element.action.blankLinesBefore
    case 'character':
      return sheet.element.character.blankLinesBefore
    case 'paren':
      return sheet.element.paren.blankLinesBefore
    case 'dialogue':
      return sheet.element.dialogue.blankLinesBefore
    case 'transition':
      return sheet.element.transition.blankLinesBefore
    case 'subtitle':
      return sheet.element.subtitle.blankLinesBefore
    default:
      return 0
  }
}

/** The measure, in characters, for an element type. Comments take the action measure. */
export const charsPerLineFor = (sheet: SheetSpec, type: string): number => {
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
