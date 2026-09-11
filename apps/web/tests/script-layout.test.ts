// @vitest-environment node
import { nodeId, paginate, resolveSheet, text, typed } from '@folio/script'
import type { ScreenplayNode } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { PAGE_GAP_PX, commentHeightPx, layoutSheet } from '../lib/script/layout'
import type { BlockToLayout } from '../lib/script/layout'

/**
 * The record to pixels, checked against the engine's own record.
 *
 * A short script is paginated by `paginate` - the real engine, the real
 * sheet - and laid out. Every assertion is a line count times the line
 * height: block margins, the jump across a page boundary, the gap inside a
 * split speech, and how a comment pushes the flow and the frames without
 * touching a single recorded position.
 */

const sheet = (() => {
  const resolved = resolveSheet('hollywood')
  if (!resolved.ok) throw new Error('US Letter must resolve')
  return resolved.value
})()

const LH = sheet.lineHeightPx
const LINES = sheet.linesPerPage

const words = (count: number): string =>
  Array.from({ length: count }, (_, index) => String.fromCharCode(97 + (index % 26)).repeat(4)).join(' ')

/** Exactly `lines` lines of action at the 60-character measure: 12 five-character words per line. */
const action = (id: string, lines: number): ScreenplayNode => ({
  type: 'action',
  id: nodeId(id),
  provenance: typed(),
  content: [text(words(12 * lines))],
})

const node = (id: string, type: ScreenplayNode['type'], value: string): ScreenplayNode =>
  type === 'character'
    ? { type, id: nodeId(id), provenance: typed(), content: [text(value)], modifiers: [] }
    : ({ type, id: nodeId(id), provenance: typed(), content: [text(value)] } as ScreenplayNode)

const measure = (nodes: readonly ScreenplayNode[]) => {
  const record = paginate(nodes, { format: 'hollywood', pageMode: 'paged', liveRepaginate: false })
  if (!record.ok) throw new Error('pagination refused')
  return record.value
}

/** Blocks as the workspace hands them: the engine's own line counts. */
const blocksFor = (nodes: readonly ScreenplayNode[], record: ReturnType<typeof measure>): readonly BlockToLayout[] =>
  nodes.map((entry) => ({
    id: entry.id,
    type: entry.type,
    lines: entry.type === 'comment' ? 1 : (record.nodes.find((placed) => placed.id === entry.id)?.lines ?? 1),
  }))

describe('layoutSheet', () => {
  it('puts the first block at the top margin and the next one a blank line below', () => {
    const nodes = [node('h', 'scene', 'INT. A ROOM - DAY'), action('a', 2)]
    const record = measure(nodes)
    const layout = layoutSheet(blocksFor(nodes, record), record, sheet, true)
    expect(layout.blocks.get('h')?.marginTopPx).toBe(sheet.marginTopPx)
    // One blank line above action, mid-page.
    expect(layout.blocks.get('a')?.marginTopPx).toBe(sheet.element.action.blankLinesBefore * LH)
    expect(layout.frames).toHaveLength(1)
    expect(layout.frames[0]).toMatchObject({ ordinal: 1, label: '1', topPx: 0, heightPx: sheet.heightPx })
  })

  it('jumps across a page boundary by the rest of the page, the gap, and the top margin', () => {
    // Fill page one exactly, then one more action that must open page two.
    const nodes = [action('fill', LINES), action('next', 3)]
    const record = measure(nodes)
    expect(record.totals.pages).toBe(2)
    const layout = layoutSheet(blocksFor(nodes, record), record, sheet, true)
    const fill = layout.blocks.get('fill')
    const next = layout.blocks.get('next')
    expect(fill?.marginTopPx).toBe(sheet.marginTopPx)
    // The first block used every line: the next starts at the next page's first line.
    expect(next?.marginTopPx).toBe(sheet.marginBottomPx + PAGE_GAP_PX + sheet.marginTopPx)
    expect(layout.frames[1]?.topPx).toBe(sheet.heightPx + PAGE_GAP_PX)
    expect(layout.heightPx).toBe(2 * sheet.heightPx + PAGE_GAP_PX)
  })

  it('opens a gap inside a split speech carrying (MORE) and the continued cue', () => {
    // Leave eight lines: blank, cue, five of speech, (MORE); the rest overleaf.
    const speech = Array.from({ length: 10 }, () => 'aaaa bbbb cccc dddd eeee ffff'.repeat(1)).join(' ')
    const nodes = [action('fill', LINES - 8), node('cue', 'character', 'MEERA'), node('say', 'dialogue', speech)]
    const record = measure(nodes)
    const placed = record.nodes.find((entry) => entry.id === 'say')
    expect(placed?.runs).toHaveLength(2)
    const layout = layoutSheet(blocksFor(nodes, record), record, sheet, true)
    const say = layout.blocks.get('say')
    expect(say?.gap).not.toBeNull()
    expect(say?.gap?.afterLine).toBe(placed?.runs[0]?.lines)
    expect(say?.gap?.more).toBe('(MORE)')
    expect(say?.gap?.continued).toBe("MEERA (CONT'D)")
    // From the end of the first run to the start of the second, in pixels.
    const first = placed?.runs[0]
    const second = placed?.runs[1]
    if (first === undefined || second === undefined) throw new Error('two runs')
    const firstEnd = sheet.marginTopPx + (first.startLine + first.lines) * LH
    const secondStart = sheet.heightPx + PAGE_GAP_PX + sheet.marginTopPx + second.startLine * LH
    expect(say?.gap?.heightPx).toBe(secondStart - firstEnd)
  })

  it('a comment takes screen space, no page space: the flow and the frames move, the margins do not', () => {
    const plain = [action('a', 2), action('b', 2)]
    const withComment = [action('a', 2), node('c', 'comment', 'is the rain too much'), action('b', 2)]
    const record = measure(withComment)
    const bare = layoutSheet(blocksFor(plain, measure(plain)), measure(plain), sheet, true)
    const noted = layoutSheet(blocksFor(withComment, record), record, sheet, true)
    // The record is identical - a comment is not in it.
    expect(record.totals).toEqual(measure(plain).totals)
    // `b` keeps the same margin: the comment's box is in the flow above it.
    expect(noted.blocks.get('b')?.marginTopPx).toBe(bare.blocks.get('b')?.marginTopPx)
    // The page grows by the comment's drawn height, and the desk with it.
    const extra = commentHeightPx(1, LH)
    expect(noted.frames[0]?.heightPx).toBe(sheet.heightPx + extra)
    expect(noted.heightPx).toBe(bare.heightPx + extra)
  })

  it('in continuous mode there are no frames and the desk is as tall as the flow', () => {
    const nodes = [action('a', LINES + 10)]
    const record = paginate(nodes, { format: 'hollywood', pageMode: 'continuous', liveRepaginate: false })
    if (!record.ok) throw new Error('refused')
    const layout = layoutSheet(blocksFor(nodes, record.value), record.value, sheet, false)
    expect(layout.frames).toEqual([])
    expect(layout.heightPx).toBe(sheet.marginTopPx + (LINES + 10) * LH + sheet.marginBottomPx)
  })
})
