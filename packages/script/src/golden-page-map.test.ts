import { describe, expect, it } from 'vitest'

import type { MeasurementRecord } from './paginate'
import { formatEighths, paginate, tallyBreaks } from './paginate'
import { resolveSheet } from './sheet'
import goldenUsLetter from './testing/golden/us-letter.json'
import { featureLengthNodes } from './testing/pagination-corpus'

/**
 * The golden page maps.
 *
 * A contract, not a snapshot. AGENTS.md, Export: "Export must agree with
 * on-screen pagination exactly. This is why the layout engine is ours." These
 * files are that agreement written down - the page boundaries and the eighths
 * the PDF exporter will have to reproduce line for line - so they are checked
 * in, reviewed like code, and regenerated deliberately.
 *
 * ## Regenerating one
 *
 * There is no `-u`. Vitest's snapshot mechanism is deliberately not used here:
 * `vitest -u` rewrites a snapshot as a side effect of running the suite, which
 * is exactly the property a contract must not have - a break in the exporter
 * contract would be silently absorbed by the next test run.
 *
 * Instead: run this file. On a mismatch it prints the complete replacement JSON
 * to stdout and fails. Paste it into `src/testing/golden/us-letter.json`,
 * commit it as its own change, and the diff shows exactly which pages moved.
 * Two human acts - reading the diff and committing it - which is what makes it
 * deliberate.
 *
 *     pnpm --filter @folio/script exec vitest run src/golden-page-map.test.ts
 *
 * ## There is no map for `format: asian`
 *
 * Deliberately. AGENTS.md open decision 8 is the A4 sheet width and it is
 * unruled, so there is no geometry to generate one from. A map generated at
 * Letter width and labelled A4 would be the worst possible artefact here: a
 * checked-in contract that looks authoritative and is wrong. The test at the
 * foot of this file asserts the absence.
 *
 * ## The corpus
 *
 * `featureLengthFdx()` from `testing/fdx-corpus.ts`, 220 scenes, imported
 * through the real `importFinalDraft`. It is synthetic - assembled
 * deterministically, not a real screenplay - so the *shape* of the numbers is
 * real (scene lengths, speech lengths, the mix of elements at volume) while the
 * prose is not. That is enough for a page map to be a contract: the exporter
 * has to match these boundaries for this input, whatever the words are.
 */

type GoldenMap = {
  readonly corpus: string
  readonly format: string
  readonly sheet: Record<string, number | string>
  readonly totals: Record<string, number | string>
  readonly breaks: Record<string, number>
  readonly pageColumns: string
  readonly pages: readonly string[]
  readonly sceneColumns: string
  readonly scenes: readonly string[]
}

const PAGE_COLUMNS = 'ordinal | label | lines | first node | artefacts'
const SCENE_COLUMNS = 'number | heading node | first page | last page | lines | eighths'

const pageRow = (record: MeasurementRecord, ordinal: number): string => {
  const page = record.pages[ordinal - 1]
  if (page === undefined) return `${ordinal} | -`
  const artefacts =
    page.artefacts.length === 0
      ? '-'
      : page.artefacts.map((entry) => `${entry.kind}@${entry.kind === 'more' ? entry.afterNode : entry.beforeNode}`).join(' ')
  return [page.ordinal, page.label, page.linesUsed, page.firstNode ?? '-', artefacts].join(' | ')
}

const buildGolden = (record: MeasurementRecord, corpus: string): GoldenMap => ({
  corpus,
  format: record.format,
  sheet: {
    paper: record.sheet.paper,
    widthPx: record.sheet.widthPx,
    heightPx: record.sheet.heightPx,
    dpi: record.sheet.dpi,
    linesPerInch: record.sheet.linesPerInch,
    linesPerPage: record.sheet.linesPerPage,
    charWidthPx: record.sheet.charWidthPx,
  },
  totals: {
    pages: record.totals.pages,
    lines: record.totals.lines,
    scenes: record.totals.scenes,
    eighths: record.totals.eighths,
    eighthsPrinted: formatEighths(record.totals.eighths),
  },
  breaks: tallyBreaks(record),
  pageColumns: PAGE_COLUMNS,
  pages: record.pages.map((page) => pageRow(record, page.ordinal)),
  sceneColumns: SCENE_COLUMNS,
  scenes: record.scenes.map((scene) =>
    [
      scene.number,
      scene.id,
      scene.startPage,
      scene.endPage,
      scene.lines,
      formatEighths(scene.eighths),
    ].join(' | '),
  ),
})

const featureLengthRecord = (): MeasurementRecord => {
  const feature = featureLengthNodes()
  const record = paginate(feature.nodes, {
    format: 'hollywood',
    pageMode: 'paged',
    liveRepaginate: false,
  })
  if (!record.ok) throw new Error(`pagination refused: ${JSON.stringify(record.error)}`)
  return record.value
}

describe('the golden page map for US Letter', () => {
  it('matches the checked-in contract, page for page and eighth for eighth', () => {
    const built = buildGolden(featureLengthRecord(), 'testing/fdx-corpus.ts featureLengthFdx(220)')
    const wanted = JSON.stringify(built, null, 2)
    const held = JSON.stringify(goldenUsLetter, null, 2)
    if (wanted !== held) {
      // Deliberate regeneration: the replacement file, in full, on stdout.
      // Nothing here writes it. See the header.
      console.log(
        [
          '--- BEGIN src/testing/golden/us-letter.json ---',
          wanted,
          '--- END src/testing/golden/us-letter.json ---',
        ].join('\n'),
      )
    }
    expect(wanted).toBe(held)
  })

  it('is stable across runs: the same corpus gives the same map', () => {
    const first = buildGolden(featureLengthRecord(), 'x')
    const second = buildGolden(featureLengthRecord(), 'x')
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('is a map of pages, and holds no node content', () => {
    const map: GoldenMap = goldenUsLetter
    expect(map.pageColumns).toBe(PAGE_COLUMNS)
    expect(map.sceneColumns).toBe(SCENE_COLUMNS)
    expect(map.pages.length).toBe(map.totals['pages'])
    expect(map.scenes.length).toBe(map.totals['scenes'])
  })

  it('was generated at the sheet the engine still resolves', () => {
    const sheet = resolveSheet('hollywood')
    expect(sheet.ok).toBe(true)
    if (!sheet.ok) return
    const map: GoldenMap = goldenUsLetter
    expect(map.sheet['linesPerPage']).toBe(sheet.value.linesPerPage)
    expect(map.sheet['linesPerInch']).toBe(sheet.value.linesPerInch)
    expect(map.sheet['widthPx']).toBe(sheet.value.widthPx)
  })
})

describe('the golden page map for format: asian', () => {
  it('does not exist, because the sheet width is an open decision', () => {
    const sheet = resolveSheet('asian')
    expect(sheet.ok).toBe(false)
    if (sheet.ok) return
    expect(sheet.error.openDecision).toBe(8)
    // A map generated at Letter width and filed under A4 would be a contract
    // that is confidently wrong. There is nothing to check in until 8 is ruled.
  })
})
