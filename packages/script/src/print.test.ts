import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { CONTINUED_TEXT, MORE_TEXT } from './generated-text'
import { characterId, nodeId } from './ids'
import { mention, text } from './inline'
import { wrapText } from './measure'
import type { ScreenplayNode } from './node'
import type { MeasurementRecord } from './paginate'
import { paginate } from './paginate'
import { printMeasureOf, printPages, printTitlePage, upperKeepingWidth } from './print'
import type { PrintedPage } from './print'
import { typed } from './provenance'
import { resolveSheet } from './sheet'
import { buildScript, scriptSpecsArb } from './testing/pagination-arbitraries'
import { featureLengthNodes, linesOfText, node, resetIds } from './testing/pagination-corpus'

/**
 * The printed page - roadmap task 5.3. The claim under test is AGENTS.md's:
 * "Export must agree with on-screen pagination exactly." Every printed line is
 * where the measurement record put it - checked against the record on random
 * scripts and on the feature-length import - `(MORE)` and `(CONT'D)` are where
 * the split left them, and a record that is not a measurement of the node list
 * is refused rather than drawn.
 */

const measured = (nodes: readonly ScreenplayNode[]): MeasurementRecord => {
  const record = paginate(nodes, { format: 'hollywood', pageMode: 'paged', liveRepaginate: false })
  if (!record.ok) throw new Error('the engine refused')
  return record.value
}

const printed = (nodes: readonly ScreenplayNode[], record: MeasurementRecord = measured(nodes)): readonly PrintedPage[] => {
  const pages = printPages(nodes, printMeasureOf(record), [])
  if (!pages.ok) throw new Error(`printing refused: ${JSON.stringify(pages.error)}`)
  return pages.value
}

/** The record's own account: every (page, line) a node's run covers, with the node. */
const placements = (record: MeasurementRecord): ReadonlyMap<string, string> =>
  new Map(record.nodes.flatMap((entry) => entry.runs.flatMap((run) => Array.from({ length: run.lines }, (_, at) => [`${String(run.page)}:${String(run.startLine + at)}`, String(entry.id)] as const))))

const holdsTheRecord = (nodes: readonly ScreenplayNode[]): void => {
  const record = measured(nodes)
  const pages = printed(nodes, record)
  const places = placements(record)
  expect(pages.map((page) => [page.ordinal, page.label])).toEqual(record.pages.map((page) => [page.ordinal, page.label]))
  let nodeLines = 0
  for (const page of pages) {
    const used = record.pages[page.ordinal - 1]?.linesUsed ?? 0
    const seen = new Set<number>()
    for (const line of page.lines) {
      // Inside the page's text area, and never two lines on one.
      expect(line.line).toBeGreaterThanOrEqual(0)
      expect(line.line).toBeLessThan(used)
      expect(seen.has(line.line)).toBe(false)
      seen.add(line.line)
      if (line.kind === 'more' || line.kind === 'cont-d') continue
      nodeLines += 1
      expect(places.has(`${String(page.ordinal)}:${String(line.line)}`)).toBe(true)
    }
  }
  expect(nodeLines).toBe(record.nodes.reduce((total, entry) => total + entry.lines, 0))
}

describe('printPages', () => {
  it('puts every line of every node exactly where the measurement record placed it - random scripts', () => {
    fc.assert(
      fc.property(scriptSpecsArb, (specs) => {
        holdsTheRecord(buildScript(specs, 'p'))
      }),
      { numRuns: 60 },
    )
  })

  it('holds for the feature-length import, page for page', () => {
    holdsTheRecord(featureLengthNodes(60).nodes)
  })

  it('draws (MORE) under the split and the cue again, continued, at the top of the next page', () => {
    resetIds()
    const nodes = [node('action', linesOfText(46, 60)), node('character', 'Meera', ['V.O.']), node('dialogue', linesOfText(10, 35))]
    const record = measured(nodes)
    expect(record.pages).toHaveLength(2)
    const pages = printed(nodes, record)
    const first = pages[0]?.lines ?? []
    const more = first.find((line) => line.kind === 'more')
    const lastSpeech = [...first].reverse().find((line) => line.kind === 'dialogue')
    expect(more).toMatchObject({ text: MORE_TEXT, leftPx: record.sheet.element.character.leftPx })
    expect(more?.line).toBe((lastSpeech?.line ?? -2) + 1)
    const second = pages[1]?.lines ?? []
    expect(second[0]).toMatchObject({ line: 0, kind: 'cont-d', text: `MEERA (V.O.) ${CONTINUED_TEXT}` })
    // The cue itself is printed upper case with its modifier, as the Script route draws it.
    expect(first.find((line) => line.kind === 'character')?.text).toBe('MEERA (V.O.)')
  })

  it('prints a mention as the record`s name, and the lines wrap where the engine wrapped them', () => {
    const meera = characterId('c1')
    const nodes: readonly ScreenplayNode[] = [
      { type: 'action', id: nodeId('a1'), provenance: typed(), content: [mention({ entity: 'character', id: meera }), text(' steps off the ferry and looks back at the jetty for a long time, as if it might leave without her.')] },
    ]
    const labels = [{ entity: 'character' as const, id: meera, label: 'Meera' }]
    const record = paginate(nodes, { format: 'hollywood', pageMode: 'paged', liveRepaginate: false, mentionLabels: labels })
    if (!record.ok) throw new Error('refused')
    const pages = printPages(nodes, printMeasureOf(record.value), labels)
    if (!pages.ok) throw new Error('refused')
    const lines = pages.value[0]?.lines.map((line) => line.text) ?? []
    expect(lines).toEqual(wrapText('Meera steps off the ferry and looks back at the jetty for a long time, as if it might leave without her.', 60))
  })

  it('refuses a record that is not a measurement of this node list', () => {
    resetIds()
    const nodes = [node('action', linesOfText(3, 60))]
    const record = measured(nodes)
    const longer = [{ ...nodes[0], content: [text(linesOfText(4, 60))] } as ScreenplayNode]
    expect(printPages(longer, printMeasureOf(record), [])).toEqual({ ok: false, error: { kind: 'measure-mismatch', node: nodes[0]?.id, reason: 'line-count' } })
    expect(printPages([...nodes, node('action', 'x')], printMeasureOf(record), [])).toMatchObject({ ok: false, error: { reason: 'unplaced' } })
  })

  it('never lets upper case change a line`s width', () => {
    expect(upperKeepingWidth('int. straße - day')).toBe('INT. STRAßE - DAY')
    expect(upperKeepingWidth('कमरा')).toBe('कमरा')
  })
})

describe('printTitlePage', () => {
  const sheet = (() => {
    const resolved = resolveSheet('hollywood')
    if (!resolved.ok) throw new Error('no sheet')
    return resolved.value
  })()

  it('centres the title a third of the way down, and puts the contact bottom left and the date bottom right', () => {
    const lines = printTitlePage({ title: 'The Last Ferry', credit: 'Written by', author: 'A. Writer', source: null, draftDate: 'Blue revision, 2 Sep 2026', contact: 'agent@example.com\n+91 98 0000 0000', copyright: null, notes: null }, sheet)
    const title = lines[0]
    expect(title).toMatchObject({ line: Math.floor(sheet.linesPerPage / 3), text: 'THE LAST FERRY', style: 'bold' })
    expect((title?.leftPx ?? 0) * 2 + 'THE LAST FERRY'.length * sheet.charWidthPx).toBeCloseTo(sheet.widthPx, -1)
    expect(lines.filter((line) => line.text === 'Written by' || line.text === 'A. Writer').map((line) => line.line)).toEqual([(title?.line ?? 0) + 2, (title?.line ?? 0) + 4])
    expect(lines.filter((line) => line.leftPx === sheet.element.action.leftPx).map((line) => [line.line, line.text])).toEqual([
      [sheet.linesPerPage - 2, 'agent@example.com'],
      [sheet.linesPerPage - 1, '+91 98 0000 0000'],
    ])
    const date = lines.find((line) => line.text === 'Blue revision, 2 Sep 2026')
    expect((date?.leftPx ?? 0) + 'Blue revision, 2 Sep 2026'.length * sheet.charWidthPx).toBeCloseTo(sheet.widthPx - sheet.element.action.rightPx, 0)
  })

  it('prints only the title it is given on an empty cover', () => {
    expect(printTitlePage({ title: 'Pilot', credit: null, author: null, source: null, draftDate: null, contact: null, copyright: null, notes: null }, sheet).map((line) => line.text)).toEqual(['PILOT'])
  })
})
