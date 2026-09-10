import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { nodeId } from './ids'
import { text } from './inline'
import type { CommentNode, ScreenplayNode } from './node'
import type { MeasurementRecord, PaginationOptions } from './paginate'
import { MIN_DIALOGUE_LINES_AFTER_BREAK, MIN_DIALOGUE_LINES_BEFORE_BREAK, paginate } from './paginate'
import { typed } from './provenance'
import type { LockedPage } from './revision'
import { commentNodeArb, screenplayNodesArb } from './testing/arbitraries'
import { buildScript, editSpecsArb, scriptSpecsArb } from './testing/pagination-arbitraries'

/**
 * The properties.
 *
 * Four of these are the ones AGENTS.md's rules turn into universal statements
 * rather than examples: a comment cannot move the map, a locked page cannot
 * renumber, the same input gives the same record, and the node list is never
 * touched. The rest are invariants that would be tedious to enumerate as cases
 * and are cheap to state as laws.
 */

const paged: PaginationOptions = {
  format: 'hollywood',
  pageMode: 'paged',
  liveRepaginate: false,
}

const measure = (
  nodes: readonly ScreenplayNode[],
  options: PaginationOptions = paged,
): MeasurementRecord => {
  const record = paginate(nodes, options)
  if (!record.ok) throw new Error(`pagination refused: ${JSON.stringify(record.error)}`)
  return record.value
}

const insert = <T>(list: readonly T[], at: number, entry: T): readonly T[] => [
  ...list.slice(0, at),
  entry,
  ...list.slice(at),
]

// ---------------------------------------------------------------------------
// A comment cannot move the page map
// ---------------------------------------------------------------------------

describe('a comment occupies zero page space', () => {
  it('leaves the page map completely unchanged, wherever it is inserted', () => {
    fc.assert(
      fc.property(
        scriptSpecsArb,
        commentNodeArb,
        fc.nat(),
        (specs, comment, position) => {
          const nodes = buildScript(specs, 'a')
          const at = position % (nodes.length + 1)
          const before = measure(nodes)
          const after = measure(insert(nodes, at, comment))
          expect(after).toEqual(before)
        },
      ),
      { numRuns: 60 },
    )
  })

  it('holds for any number of comments in any arrangement', () => {
    fc.assert(
      fc.property(
        scriptSpecsArb,
        fc.array(fc.nat(), { minLength: 1, maxLength: 8 }),
        (specs, positions) => {
          const nodes = buildScript(specs, 'a')
          const before = measure(nodes)
          let noisy: readonly ScreenplayNode[] = nodes
          positions.forEach((position, index) => {
            const comment: CommentNode = {
              type: 'comment',
              id: nodeId(`c${index}`),
              provenance: typed(),
              content: [text('a note')],
            }
            noisy = insert(noisy, position % (noisy.length + 1), comment)
          })
          expect(measure(noisy)).toEqual(before)
        },
      ),
      { numRuns: 40 },
    )
  })
})

// ---------------------------------------------------------------------------
// Locked pages must not renumber
// ---------------------------------------------------------------------------

describe('a locked page keeps its number', () => {
  it('survives arbitrary upstream edits', () => {
    fc.assert(
      fc.property(
        scriptSpecsArb,
        editSpecsArb,
        fc.nat(),
        (specs, editSpecs, position) => {
          const nodes = buildScript(specs, 'a')
          const original = measure(nodes)
          const locks: readonly LockedPage[] = original.pages.flatMap((page) =>
            page.firstNode === null
              ? []
              : [{ label: page.label, anchor: page.firstNode, revision: 'white' as const }],
          )
          if (locks.length === 0) return

          const edit = buildScript(editSpecs, 'u')
          const at = position % (nodes.length + 1)
          const edited = [...nodes.slice(0, at), ...edit, ...nodes.slice(at)]
          const record = measure(edited, { ...paged, lockedPages: locks })

          // Anything the rule as written does not cover is *reported*. A lock
          // that was reported is not silently expected to have held.
          const troubled = new Set(
            record.lockIssues.flatMap((issue) => {
              if (issue.kind === 'anchor-missing') return [issue.label]
              if (issue.kind === 'locks-collide') return [issue.dropped]
              return []
            }),
          )

          for (const lock of locks) {
            if (troubled.has(lock.label)) continue
            const placed = record.nodes.find((entry) => entry.id === lock.anchor)
            const ordinal = placed?.runs[0]?.page
            expect(ordinal).toBeDefined()
            const page = record.pages[(ordinal ?? 1) - 1]
            expect(page?.label).toBe(lock.label)
            expect(page?.locked).toBe(true)
          }
        },
      ),
      { numRuns: 60 },
    )
  })

  it('gives every page a number, and never quietly drops a lock', () => {
    fc.assert(
      fc.property(scriptSpecsArb, editSpecsArb, (specs, editSpecs) => {
        const nodes = buildScript(specs, 'a')
        const original = measure(nodes)
        const locks: readonly LockedPage[] = original.pages.flatMap((page) =>
          page.firstNode === null
            ? []
            : [{ label: page.label, anchor: page.firstNode, revision: 'white' as const }],
        )
        const record = measure([...buildScript(editSpecs, 'u'), ...nodes], {
          ...paged,
          lockedPages: locks,
        })
        expect(record.pages.every((page) => page.label.length > 0)).toBe(true)
        const placed = record.pages.filter((page) => page.locked).length
        const missing = record.lockIssues.filter(
          (issue) => issue.kind === 'anchor-missing' || issue.kind === 'locks-collide',
        ).length
        expect(placed + missing).toBe(locks.length)
      }),
      { numRuns: 40 },
    )
  })
})

// ---------------------------------------------------------------------------
// Determinism, and the node list
// ---------------------------------------------------------------------------

describe('pagination is deterministic', () => {
  it('gives the same measurement record for the same nodes and format', () => {
    fc.assert(
      fc.property(scriptSpecsArb, (specs) => {
        const nodes = buildScript(specs, 'a')
        expect(measure(nodes)).toEqual(measure(nodes))
      }),
      { numRuns: 60 },
    )
  })

  it('is deterministic over arbitrary node lists, not only well-formed ones', () => {
    fc.assert(
      fc.property(screenplayNodesArb, (nodes) => {
        expect(measure(nodes)).toEqual(measure(nodes))
      }),
      { numRuns: 60 },
    )
  })
})

describe('the engine never mutates the node list', () => {
  it('leaves every node exactly as it was given', () => {
    fc.assert(
      fc.property(scriptSpecsArb, (specs) => {
        const nodes = buildScript(specs, 'a')
        const before = JSON.stringify(nodes)
        measure(nodes)
        measure(nodes, { ...paged, pageMode: 'continuous' })
        expect(JSON.stringify(nodes)).toBe(before)
      }),
      { numRuns: 60 },
    )
  })

  it('holds for arbitrary node lists too', () => {
    fc.assert(
      fc.property(screenplayNodesArb, (nodes) => {
        const before = JSON.stringify(nodes)
        measure(nodes)
        expect(JSON.stringify(nodes)).toBe(before)
      }),
      { numRuns: 60 },
    )
  })
})

// ---------------------------------------------------------------------------
// Invariants of the layout itself
// ---------------------------------------------------------------------------

describe('the layout invariants', () => {
  it('never overfills a sheet', () => {
    fc.assert(
      fc.property(scriptSpecsArb, (specs) => {
        const record = measure(buildScript(specs, 'a'))
        for (const page of record.pages) {
          expect(page.linesUsed).toBeLessThanOrEqual(record.sheet.linesPerPage)
        }
      }),
      { numRuns: 60 },
    )
  })

  it('places every renderable node exactly once and no comment at all', () => {
    fc.assert(
      fc.property(scriptSpecsArb, commentNodeArb, (specs, comment) => {
        const nodes = insert(buildScript(specs, 'a'), 0, comment)
        const record = measure(nodes)
        const expected = nodes.filter((entry) => entry.type !== 'comment').map((entry) => entry.id)
        expect(record.nodes.map((entry) => entry.id)).toEqual(expected)
        for (const entry of record.nodes) expect(entry.runs.length).toBeGreaterThan(0)
      }),
      { numRuns: 60 },
    )
  })

  /**
   * The two dialogue rules are about a **speech**, not about one dialogue node.
   * Two consecutive dialogue paragraphs under one cue read as one continuous
   * speech - no blank line between them - so a break that leaves one line of
   * the second paragraph under three lines of the first has stranded nothing.
   * What the rule forbids is a *page* carrying fewer than two lines of the
   * speech.
   *
   * The exception is a speech taller than the sheet, where the page, not the
   * rule, decides where it ends. Those are excluded, and the engine reports the
   * cut as `page-full` rather than as a legal split.
   */
  it('never leaves fewer than two lines of a speech on either side of a break', () => {
    fc.assert(
      fc.property(scriptSpecsArb, (specs) => {
        const nodes = buildScript(specs, 'a')
        const record = measure(nodes)
        const linesOf = new Map(record.nodes.map((entry) => [String(entry.id), entry]))

        for (let at = 0; at < nodes.length; at += 1) {
          if (nodes[at]?.type !== 'character') continue
          const speech: string[] = []
          let height = 1
          for (let part = at + 1; part < nodes.length; part += 1) {
            const type = nodes[part]?.type
            if (type !== 'paren' && type !== 'dialogue' && type !== 'subtitle') break
            const id = String(nodes[part]?.id)
            height += linesOf.get(id)?.lines ?? 0
            if (type === 'dialogue') speech.push(id)
          }
          if (speech.length === 0) continue
          // A speech taller than a page is cut by the sheet, not by the rule.
          if (height + 2 > record.sheet.linesPerPage) continue

          const perPage = new Map<number, number>()
          for (const id of speech) {
            for (const placed of linesOf.get(id)?.runs ?? []) {
              perPage.set(placed.page, (perPage.get(placed.page) ?? 0) + placed.lines)
            }
          }
          if (perPage.size < 2) continue
          for (const lines of perPage.values()) {
            expect(lines).toBeGreaterThanOrEqual(
              Math.min(MIN_DIALOGUE_LINES_BEFORE_BREAK, MIN_DIALOGUE_LINES_AFTER_BREAK),
            )
          }
        }
      }),
      { numRuns: 60 },
    )
  })

  it('draws a (CONT’D) on exactly the pages a speech continues onto', () => {
    fc.assert(
      fc.property(scriptSpecsArb, (specs) => {
        const record = measure(buildScript(specs, 'a'))
        const more = record.pages.flatMap((page) =>
          page.artefacts.filter((entry) => entry.kind === 'more'),
        ).length
        const contd = record.pages.flatMap((page) =>
          page.artefacts.filter((entry) => entry.kind === 'cont-d'),
        ).length
        expect(contd).toBe(more)
        expect(more).toBe(record.breaks.filter((entry) => entry.rule === 'dialogue-split').length)
      }),
      { numRuns: 60 },
    )
  })

  it('adds up: the totals are the pages and the scenes', () => {
    fc.assert(
      fc.property(scriptSpecsArb, (specs) => {
        const record = measure(buildScript(specs, 'a'))
        expect(record.totals.pages).toBe(record.pages.length)
        expect(record.totals.lines).toBe(
          record.pages.reduce((total, page) => total + page.linesUsed, 0),
        )
        expect(record.totals.scenes).toBe(record.scenes.length)
        expect(record.totals.eighths).toBe(
          record.scenes.reduce((total, scene) => total + scene.eighths, 0),
        )
        record.scenes.forEach((scene, index) => {
          expect(scene.number).toBe(index + 1)
          expect(scene.eighths).toBeGreaterThanOrEqual(1)
        })
      }),
      { numRuns: 60 },
    )
  })

  it('refuses format: asian for every input there is', () => {
    fc.assert(
      fc.property(screenplayNodesArb, (nodes) => {
        expect(paginate(nodes, { ...paged, format: 'asian' }).ok).toBe(false)
      }),
      { numRuns: 40 },
    )
  })
})
