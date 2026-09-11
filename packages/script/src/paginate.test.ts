import { describe, expect, it } from 'vitest'

import { CONTINUED_TEXT, MORE_TEXT, readCue } from './generated-text'
import type { NodeId } from './ids'
import { characterId, nodeId } from './ids'
import { mention, text } from './inline'
import type { ScreenplayNode } from './node'
import { PAGINATION_FIELDS } from './node'
import type { MeasurementRecord, PaginationOptions } from './paginate'
import { PAGE_MODES, artefactsOf, isPageMode, paginate, tallyBreaks } from './paginate'
import type { LockedPage } from './revision'
import { REVISION_COLOURS, isRevisionColour, nextRevisionColour, suffixLetters } from './revision'
import { typed } from './provenance'
import { resolveSheet } from './sheet'
import { linesOfText, node, resetIds } from './testing/pagination-corpus'

/**
 * The pagination engine.
 *
 * Five break rules are named in AGENTS.md and each has its own test here, plus
 * the one the brief asks for explicitly: the heading rule and the two-lines-of-
 * dialogue rule deciding the *same* break, where a heading with two lines of
 * room under it is still an orphan because those two lines could only be a cue
 * and a single line of speech.
 *
 * The arithmetic these tests are built on: a US Letter page holds 54 lines,
 * action measures 60 characters, dialogue 35, a cue 38. `linesOfText(n, m)`
 * produces text that measures exactly `n` lines at measure `m`, so a test can
 * say "leave four lines at the foot of the page" and mean it.
 */

const LINES_PER_PAGE = 54
const ACTION = 60
const DIALOGUE = 35

const paged: PaginationOptions = {
  format: 'hollywood',
  pageMode: 'paged',
  liveRepaginate: false,
}

const run = (nodes: readonly ScreenplayNode[], options: PaginationOptions = paged) => {
  const record = paginate(nodes, options)
  if (!record.ok) throw new Error(`pagination refused: ${JSON.stringify(record.error)}`)
  return record.value
}

/** One action node that fills `lines` lines from the top of an empty page. */
const filler = (lines: number): ScreenplayNode => node('action', linesOfText(lines, ACTION))

/** A cue plus one speech of `lines` lines. */
const speech = (lines: number, name = 'MEERA'): readonly ScreenplayNode[] => [
  node('character', name),
  node('dialogue', linesOfText(lines, DIALOGUE)),
]

const rules = (record: MeasurementRecord): readonly string[] =>
  record.breaks.map((entry) => entry.rule)

const linesOn = (record: MeasurementRecord, page: number): number =>
  record.pages[page - 1]?.linesUsed ?? -1

const nodesOn = (record: MeasurementRecord, page: number): readonly NodeId[] =>
  record.nodes.flatMap((entry) =>
    entry.runs.some((placed) => placed.page === page) ? [entry.id] : [],
  )

// ---------------------------------------------------------------------------
// The record, and what may not be on it
// ---------------------------------------------------------------------------

describe('the measurement record', () => {
  it('carries page numbers and eighths, keyed to nodes', () => {
    resetIds()
    const nodes = [node('scene', 'INT. MEERAS FLAT - NIGHT'), filler(4), ...speech(3)]
    const record = run(nodes)
    expect(record.nodes.map((entry) => entry.id)).toEqual(nodes.map((entry) => entry.id))
    expect(record.scenes).toEqual([
      { id: nodes[0]?.id, number: 1, startPage: 1, endPage: 1, lines: 11, eighths: 2 },
    ])
    expect(record.totals.pages).toBe(1)
  })

  it('never writes a page onto a node', () => {
    resetIds()
    const nodes = [node('scene', 'INT. A ROOM - DAY'), filler(200), ...speech(9)]
    const before = JSON.stringify(nodes)
    run(nodes)
    expect(JSON.stringify(nodes)).toBe(before)
    for (const entry of nodes) {
      for (const field of PAGINATION_FIELDS) {
        expect(Object.prototype.hasOwnProperty.call(entry, field)).toBe(false)
      }
    }
  })

  it('holds node ids, never nodes: the record cannot carry content back', () => {
    resetIds()
    const record = run([filler(2)])
    for (const entry of record.nodes) {
      expect(Object.keys(entry).sort()).toEqual(['id', 'lines', 'runs', 'type'])
    }
  })

  it('names its two modes and nothing else', () => {
    expect(PAGE_MODES).toEqual(['paged', 'continuous'])
    expect(isPageMode('paged')).toBe(true)
    expect(isPageMode('continuous')).toBe(true)
    // The design bundle's third value is a cadence, not a mode. See
    // docs/build-decisions.md#pagination-two-modes-and-a-cadence-flag.
    expect(isPageMode('live')).toBe(false)
    expect(isPageMode('minimal')).toBe(false)
  })

  it('carries the format, the mode and the cadence flag it was given', () => {
    resetIds()
    const record = run([filler(1)], { ...paged, liveRepaginate: true })
    expect(record.format).toBe('hollywood')
    expect(record.pageMode).toBe('paged')
    expect(record.liveRepaginate).toBe(true)
    expect(record.sheet.linesPerPage).toBe(LINES_PER_PAGE)
  })
})

// ---------------------------------------------------------------------------
// format
// ---------------------------------------------------------------------------

describe('format is an input', () => {
  it('refuses format: asian rather than paginating it at Letter width', () => {
    resetIds()
    const record = paginate([filler(1)], { ...paged, format: 'asian' })
    expect(record.ok).toBe(false)
    if (record.ok) return
    expect(record.error.kind).toBe('sheet-width-unresolved')
    expect(record.error.openDecision).toBe(8)
  })

  it('refuses it before measuring anything, so no partial map escapes', () => {
    resetIds()
    const nodes = [filler(400)]
    const record = paginate(nodes, { ...paged, format: 'asian' })
    expect(record.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// (MORE) and (CONT'D)
// ---------------------------------------------------------------------------

describe('a speech split across a page', () => {
  it('draws (MORE) at the split and (CONT’D) on the continuation', () => {
    resetIds()
    // A page less eight lines of action, then a cue (one blank, one line) and ten lines of
    // speech. Eight lines are left: blank, cue, five of speech, (MORE).
    const nodes = [filler(LINES_PER_PAGE - 8), ...speech(10, 'MEERA')]
    const record = run(nodes)

    expect(record.totals.pages).toBe(2)
    expect(linesOn(record, 1)).toBe(LINES_PER_PAGE)
    expect(record.pages[0]?.artefacts).toEqual([
      { kind: 'more', text: MORE_TEXT, afterNode: nodes[2]?.id },
    ])
    expect(record.pages[1]?.artefacts).toEqual([
      { kind: 'cont-d', text: "MEERA (CONT'D)", beforeNode: nodes[2]?.id },
    ])
    expect(rules(record)).toEqual(['dialogue-split'])
  })

  it('keeps authored modifiers on the continuation cue and adds the continued', () => {
    resetIds()
    const nodes = [
      filler(LINES_PER_PAGE - 8),
      node('character', 'MEERA', ['V.O.']),
      node('dialogue', linesOfText(10, DIALOGUE)),
    ]
    const record = run(nodes)
    const artefact = record.pages[1]?.artefacts[0]
    expect(artefact?.kind).toBe('cont-d')
    expect(artefact?.text).toBe(`MEERA (V.O.) ${CONTINUED_TEXT}`)

    // Read back the way an import reads it: the modifier is authored and kept,
    // the continued is generated and stripped. AGENTS.md, generated text.
    const reading = readCue(artefact?.text ?? '')
    expect(reading.name).toBe('MEERA')
    expect(reading.modifiers).toEqual(['V.O.'])
    expect(reading.artefacts.map((entry) => entry.kind)).toEqual(['cont-d'])
  })

  it('puts the split inside the speech, never between the cue and the speech', () => {
    resetIds()
    const nodes = [filler(LINES_PER_PAGE - 8), ...speech(10)]
    const record = run(nodes)
    const cue = record.nodes.find((entry) => entry.type === 'character')
    const dialogue = record.nodes.find((entry) => entry.type === 'dialogue')
    expect(cue?.runs).toHaveLength(1)
    expect(cue?.runs[0]?.page).toBe(1)
    expect(dialogue?.runs.map((placed) => placed.page)).toEqual([1, 2])
    expect(dialogue?.lines).toBe(10)
  })

  it('puts neither artefact in the node stream', () => {
    resetIds()
    const nodes = [filler(LINES_PER_PAGE - 8), ...speech(10)]
    run(nodes)
    const text = JSON.stringify(nodes)
    expect(text).not.toContain('MORE')
    expect(text).not.toContain("CONT'D")
  })
})

// ---------------------------------------------------------------------------
// At least two lines of dialogue before a legal break
// ---------------------------------------------------------------------------

describe('the two-lines-of-dialogue minimum', () => {
  it('moves the whole speech rather than break after one line', () => {
    resetIds()
    // Four lines left: a blank, a cue, one line of speech and a (MORE) would
    // fit exactly - and are exactly what the rule forbids.
    const nodes = [filler(LINES_PER_PAGE - 4), ...speech(10)]
    const record = run(nodes)

    expect(linesOn(record, 1)).toBe(LINES_PER_PAGE - 4)
    expect(rules(record)).toEqual(['dialogue-minimum'])
    expect(nodesOn(record, 1)).toEqual([nodes[0]?.id])
    expect(nodesOn(record, 2)).toEqual([nodes[1]?.id, nodes[2]?.id])
    expect(artefactsOf(record)).toEqual([])
  })

  it('splits as soon as two lines and a (MORE) do fit', () => {
    resetIds()
    const nodes = [filler(LINES_PER_PAGE - 5), ...speech(10)]
    const record = run(nodes)
    expect(rules(record)).toEqual(['dialogue-split'])
    expect(record.nodes[2]?.runs[0]?.lines).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// No stranded single dialogue lines
// ---------------------------------------------------------------------------

describe('the stranded-line rule', () => {
  it('will not leave one line of a speech overleaf', () => {
    resetIds()
    // A three-line speech could only ever split two-and-one.
    const nodes = [filler(LINES_PER_PAGE - 3), ...speech(3)]
    const record = run(nodes)
    expect(rules(record)).toEqual(['stranded-dialogue'])
    expect(record.nodes[2]?.runs).toHaveLength(1)
    expect(record.nodes[2]?.runs[0]?.page).toBe(2)
  })

  it('splits a four-line speech two and two', () => {
    resetIds()
    const nodes = [filler(LINES_PER_PAGE - 5), ...speech(4)]
    const record = run(nodes)
    expect(rules(record)).toEqual(['dialogue-split'])
    expect(record.nodes[2]?.runs.map((placed) => placed.lines)).toEqual([2, 2])
  })

  it('never breaks a speech so that either side holds a single line', () => {
    resetIds()
    for (let fill = LINES_PER_PAGE - 12; fill <= LINES_PER_PAGE - 2; fill += 1) {
      resetIds()
      const nodes = [filler(fill), ...speech(6)]
      const record = run(nodes)
      const dialogue = record.nodes[2]
      for (const placed of dialogue?.runs ?? []) expect(placed.lines).toBeGreaterThanOrEqual(2)
    }
  })
})

// ---------------------------------------------------------------------------
// No orphaned scene headings
// ---------------------------------------------------------------------------

describe('the orphan rule', () => {
  it('moves a heading that would end a page with nothing legal under it', () => {
    resetIds()
    // Five lines left. The heading takes three (two blanks and its line); the
    // action under it needs six and cannot legally divide into two.
    const nodes = [filler(LINES_PER_PAGE - 5), node('scene', 'INT. THE CHAWL - NIGHT'), filler(5)]
    const record = run(nodes)
    expect(rules(record)).toEqual(['orphaned-heading'])
    expect(linesOn(record, 1)).toBe(LINES_PER_PAGE - 5)
    expect(record.scenes[0]?.startPage).toBe(2)
  })

  it('leaves the heading alone when what follows can legally start', () => {
    resetIds()
    const nodes = [filler(LINES_PER_PAGE - 8), node('scene', 'INT. THE CHAWL - NIGHT'), filler(5)]
    const record = run(nodes)
    expect(rules(record)).not.toContain('orphaned-heading')
    expect(record.scenes[0]?.startPage).toBe(1)
  })

  /**
   * The interaction the brief names. Two lines are free under the heading, so a
   * rule that counted lines would keep it - but the block under it is a speech,
   * and the only thing two lines could hold is a cue and one line of dialogue,
   * which the dialogue minimum forbids. The heading is an orphan.
   */
  it('asks whether the next block can legally start, not whether two lines fit', () => {
    resetIds()
    const nodes = [filler(LINES_PER_PAGE - 6), node('scene', 'INT. THE MILL - DAY'), ...speech(10)]
    const record = run(nodes)
    expect(rules(record)).toEqual(['orphaned-heading'])
    expect(linesOn(record, 1)).toBe(LINES_PER_PAGE - 6)
    expect(nodesOn(record, 2)).toEqual([nodes[1]?.id, nodes[2]?.id, nodes[3]?.id])
    expect(artefactsOf(record)).toEqual([])
  })

  it('does not break for an orphan when breaking would not help', () => {
    resetIds()
    // A parenthetical does not divide, and this one is taller than any page, so
    // it cannot legally start anywhere. A fresh page saves nothing and the
    // break would only waste paper.
    const nodes = [
      filler(LINES_PER_PAGE - 5),
      node('scene', 'INT. NOWHERE - DAY'),
      node('paren', linesOfText(200, 25)),
    ]
    const record = run(nodes)
    expect(rules(record)).not.toContain('orphaned-heading')
    expect(record.scenes[0]?.startPage).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

describe('comment nodes', () => {
  it('occupies zero page space wherever it is put', () => {
    resetIds()
    const nodes = [
      node('scene', 'INT. MEERAS FLAT - NIGHT'),
      filler(50),
      ...speech(6),
      filler(50),
    ]
    const clean = run(nodes)

    for (let at = 0; at <= nodes.length; at += 1) {
      const withComment = [
        ...nodes.slice(0, at),
        node('comment', 'is the rain too much'),
        ...nodes.slice(at),
      ]
      expect(run(withComment)).toEqual(clean)
    }
  })

  it('does not appear anywhere in the record', () => {
    resetIds()
    const comment = node('comment', 'check this against the bible')
    const record = run([filler(3), comment, filler(3)])
    expect(JSON.stringify(record)).not.toContain(String(comment.id))
    expect(record.nodes.map((entry) => entry.type)).toEqual(['action', 'action'])
  })

  it('cannot move a page count even at volume', () => {
    resetIds()
    const nodes = Array.from({ length: 60 }, () => filler(4))
    const clean = run(nodes)
    const noisy = nodes.flatMap((entry) => [node('comment', 'note'), entry])
    expect(run(noisy).totals).toEqual(clean.totals)
  })
})

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

describe('two modes and a cadence flag', () => {
  it('continuous puts the whole script on one page and breaks nothing', () => {
    resetIds()
    const nodes = [node('scene', 'INT. A ROOM - DAY'), filler(400), ...speech(10)]
    const continuous = run(nodes, { ...paged, pageMode: 'continuous' })
    expect(continuous.totals.pages).toBe(1)
    expect(continuous.breaks).toEqual([])
    expect(artefactsOf(continuous)).toEqual([])
  })

  it('continuous still measures: eighths do not depend on drawing the breaks', () => {
    resetIds()
    const nodes = [node('scene', 'INT. A ROOM - DAY'), filler(20)]
    const drawn = run(nodes)
    const flowed = run(nodes, { ...paged, pageMode: 'continuous' })
    expect(flowed.scenes[0]?.eighths).toBe(drawn.scenes[0]?.eighths)
  })

  it('liveRepaginate is a cadence flag: it changes nothing but its own field', () => {
    resetIds()
    const nodes = [node('scene', 'INT. A ROOM - DAY'), filler(300), ...speech(9)]
    const off = run(nodes, { ...paged, liveRepaginate: false })
    const on = run(nodes, { ...paged, liveRepaginate: true })
    expect({ ...on, liveRepaginate: false }).toEqual(off)
  })
})

// ---------------------------------------------------------------------------
// Locked pages
// ---------------------------------------------------------------------------

describe('locked pages', () => {
  /** Five action nodes one line short of a page: one page each, each opening a page. */
  const fivePages = (): readonly ScreenplayNode[] =>
    Array.from({ length: 5 }, () => filler(LINES_PER_PAGE - 1))

  const locksFor = (record: MeasurementRecord): readonly LockedPage[] =>
    record.pages.flatMap((page) =>
      page.firstNode === null
        ? []
        : [{ label: page.label, anchor: page.firstNode, revision: 'white' as const }],
    )

  it('numbers a fresh script one to five', () => {
    resetIds()
    const record = run(fivePages())
    expect(record.pages.map((page) => page.label)).toEqual(['1', '2', '3', '4', '5'])
    expect(record.pages.every((page) => page.locked)).toBe(false)
  })

  it('does not renumber a locked page when material is inserted above it', () => {
    resetIds()
    const original = fivePages()
    const locks = locksFor(run(original))

    const edited = [original[0], filler(LINES_PER_PAGE - 1), ...original.slice(1)].filter(
      (entry): entry is ScreenplayNode => entry !== undefined,
    )
    const record = run(edited, { ...paged, lockedPages: locks })

    expect(record.pages.map((page) => page.label)).toEqual(['1', '1A', '2', '3', '4', '5'])
    expect(record.pages.map((page) => page.locked)).toEqual([true, false, true, true, true, true])
    expect(record.lockIssues).toEqual([])
  })

  it('gives inserted pages A, B, C off the page above them', () => {
    resetIds()
    const original = fivePages()
    const locks = locksFor(run(original))
    const edited = [original[0], filler(LINES_PER_PAGE - 1), filler(LINES_PER_PAGE - 1), ...original.slice(1)].filter(
      (entry): entry is ScreenplayNode => entry !== undefined,
    )
    const record = run(edited, { ...paged, lockedPages: locks })
    expect(record.pages.map((page) => page.label)).toEqual([
      '1',
      '1A',
      '1B',
      '2',
      '3',
      '4',
      '5',
    ])
  })

  it('counts on past the last lock rather than lettering the end of the script', () => {
    resetIds()
    const original = fivePages()
    const locks = locksFor(run(original))
    const record = run([...original, filler(LINES_PER_PAGE - 1), filler(LINES_PER_PAGE - 1)], {
      ...paged,
      lockedPages: locks,
    })
    expect(record.pages.map((page) => page.label)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
  })

  it('carries the locked revision colour and gives the rest the current pass', () => {
    resetIds()
    const original = fivePages()
    const locks = locksFor(run(original)).map((lock) => ({ ...lock, revision: 'blue' as const }))
    const edited = [original[0], filler(LINES_PER_PAGE - 1), ...original.slice(1)].filter(
      (entry): entry is ScreenplayNode => entry !== undefined,
    )
    const record = run(edited, { ...paged, lockedPages: locks, revision: 'pink' })
    expect(record.pages.map((page) => page.revision)).toEqual([
      'blue',
      'pink',
      'blue',
      'blue',
      'blue',
      'blue',
    ])
  })

  it('reports a lock whose anchor has left the script rather than dropping it', () => {
    resetIds()
    const record = run(fivePages(), {
      ...paged,
      lockedPages: [{ label: '12', anchor: nodeId('gone'), revision: 'white' }],
    })
    expect(record.lockIssues).toEqual([
      { kind: 'anchor-missing', label: '12', anchor: nodeId('gone') },
    ])
  })

  it('reports two pages printing the same number instead of renumbering one', () => {
    resetIds()
    const nodes = [filler(LINES_PER_PAGE - 1), filler(LINES_PER_PAGE - 1)]
    // Page two is locked as "1". Page one is before the first lock, so it
    // numbers from one - and now two pages print "1". Resolving that would mean
    // renumbering a locked page, which is the one thing that must not happen.
    const record = run(nodes, {
      ...paged,
      lockedPages: [{ label: '1', anchor: nodes[1]?.id ?? nodeId('b'), revision: 'white' }],
    })
    expect(record.pages.map((page) => page.label)).toEqual(['1', '1'])
    expect(record.lockIssues).toEqual([
      { kind: 'label-collision', label: '1', ordinals: [1, 2] },
    ])
  })

  it('reports two locks landing on one page instead of choosing between them', () => {
    resetIds()
    const nodes = [filler(3), filler(3)]
    const record = run(nodes, {
      ...paged,
      lockedPages: [
        { label: '7', anchor: nodes[0]?.id ?? nodeId('a'), revision: 'white' },
        { label: '8', anchor: nodes[1]?.id ?? nodeId('b'), revision: 'white' },
      ],
    })
    expect(record.lockIssues).toEqual([
      { kind: 'locks-collide', ordinal: 1, kept: '7', dropped: '8' },
    ])
    expect(record.pages[0]?.label).toBe('7')
  })
})

describe('a lock whose label is not a plain number', () => {
  it('letters past it and says why, rather than inventing the next number', () => {
    resetIds()
    const nodes = [filler(LINES_PER_PAGE - 1), filler(LINES_PER_PAGE - 1)]
    const record = run(nodes, {
      ...paged,
      lockedPages: [{ label: '12A', anchor: nodes[0]?.id ?? nodeId('a'), revision: 'blue' }],
    })
    expect(record.pages.map((page) => page.label)).toEqual(['12A', '12AA'])
    expect(record.lockIssues.map((issue) => issue.kind)).toEqual(['label-not-numeric'])
  })
})

// ---------------------------------------------------------------------------
// Mentions have no stored label, so measuring one needs the caller
// ---------------------------------------------------------------------------

describe('measuring an @mention', () => {
  const mentioning = (): ScreenplayNode => ({
    type: 'action',
    id: nodeId('m1'),
    provenance: typed(),
    content: [text('aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii '), mention({ entity: 'character', id: characterId('c1') }), text(' jjjj')],
  })

  it('measures the record name the caller supplies', () => {
    const labelled = run([mentioning()], {
      ...paged,
      mentionLabels: [{ entity: 'character', id: characterId('c1'), label: 'INSPECTOR RAO' }],
    })
    expect(labelled.unresolvedMentions).toEqual([])
    expect(labelled.nodes[0]?.lines).toBe(2)
  })

  it('reports a mention it has no name for rather than measuring it as nothing', () => {
    const bare = run([mentioning()])
    expect(bare.unresolvedMentions).toEqual([{ entity: 'character', id: 'c1' }])
    // One character wide - the atom width `contentLength` gives it - so the
    // page count is short but the record says it is provisional.
    expect(bare.nodes[0]?.lines).toBe(1)
  })
})

describe('the revision colours', () => {
  it('is the industry sequence, in order, and lives in this package', () => {
    expect(REVISION_COLOURS).toEqual(['white', 'blue', 'pink', 'yellow', 'green'])
    expect(isRevisionColour('pink')).toBe(true)
    expect(isRevisionColour('goldenrod')).toBe(false)
  })

  it('advances through the sequence', () => {
    expect(nextRevisionColour('white')).toEqual({ ok: true, value: 'blue' })
    expect(nextRevisionColour('yellow')).toEqual({ ok: true, value: 'green' })
  })

  it('refuses to invent a sixth colour', () => {
    const next = nextRevisionColour('green')
    expect(next.ok).toBe(false)
    if (next.ok) return
    expect(next.error.kind).toBe('revision-sequence-exhausted')
    expect(next.error.after).toBe('green')
  })

  it('letters inserted pages A to Z and then AA', () => {
    expect(suffixLetters(1)).toBe('A')
    expect(suffixLetters(26)).toBe('Z')
    expect(suffixLetters(27)).toBe('AA')
  })
})

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('returns the same record for the same nodes and format, every time', () => {
    resetIds()
    const nodes = [node('scene', 'INT. A ROOM - DAY'), filler(300), ...speech(9), filler(40)]
    const first = run(nodes)
    for (let at = 0; at < 5; at += 1) expect(run(nodes)).toEqual(first)
  })

  it('does not depend on a clock or on entropy', () => {
    resetIds()
    const nodes = [filler(200), ...speech(12)]
    expect(JSON.stringify(run(nodes))).toBe(JSON.stringify(run(nodes)))
  })

  it('fills no page past the sheet', () => {
    resetIds()
    const nodes = [node('scene', 'INT. A ROOM - DAY'), filler(500), ...speech(30), filler(90)]
    const record = run(nodes)
    for (const page of record.pages) expect(page.linesUsed).toBeLessThanOrEqual(LINES_PER_PAGE)
  })
})

// ---------------------------------------------------------------------------
// Scenes and eighths
// ---------------------------------------------------------------------------

describe('scenes and eighths', () => {
  it('starts a scene only where derivation starts one', () => {
    resetIds()
    const nodes = [
      node('scene', 'INT. MEERAS FLAT - NIGHT'),
      filler(2),
      node('scene', 'INTERCUT - PHONE CALL'),
      filler(2),
      node('scene', 'EXT. THE CHAWL - DAY'),
      filler(2),
    ]
    const record = run(nodes)
    // The middle heading is laid out - the writer typed one - but it is not a
    // scene, exactly as `derive.ts` reads it.
    expect(record.scenes.map((scene) => scene.id)).toEqual([nodes[0]?.id, nodes[4]?.id])
    expect(record.nodes).toHaveLength(6)
  })

  it('measures a scene in lines actually occupied and rounds to eighths', () => {
    resetIds()
    const sheet = resolveSheet('hollywood')
    if (!sheet.ok) throw new Error('unreachable')
    const nodes = [node('scene', 'INT. A ROOM - DAY'), filler(26)]
    const record = run(nodes)
    // One heading line, one blank above the action, twenty-six lines of it.
    expect(record.scenes[0]?.lines).toBe(28)
    expect(record.scenes[0]?.eighths).toBe(4)
    expect(record.totals.eighths).toBe(4)
  })

  it('gives a scene that exists at least one eighth', () => {
    resetIds()
    const record = run([node('scene', 'INT. A ROOM - DAY')])
    expect(record.scenes[0]?.lines).toBe(1)
    expect(record.scenes[0]?.eighths).toBe(1)
  })

  it('records the pages a scene spans', () => {
    resetIds()
    const nodes = [node('scene', 'INT. A ROOM - DAY'), filler(LINES_PER_PAGE + 20)]
    const record = run(nodes)
    expect(record.scenes[0]?.startPage).toBe(1)
    expect(record.scenes[0]?.endPage).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// The tally the report quotes
// ---------------------------------------------------------------------------

describe('tallyBreaks', () => {
  it('counts every rule, including the ones that fired zero times', () => {
    resetIds()
    const record = run([filler(LINES_PER_PAGE - 3), ...speech(3)])
    expect(tallyBreaks(record)).toEqual({
      'page-full': 0,
      'dialogue-split': 0,
      'dialogue-minimum': 0,
      'stranded-dialogue': 1,
      'orphaned-heading': 0,
    })
  })
})
