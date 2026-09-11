import { describe, expect, it } from 'vitest'

import type { ScreenplayDiff } from './diff'
import { DIFF_KINDS, diffScreenplays } from './diff'
import { characterId, nodeId } from './ids'
import { mention, text } from './inline'
import type { ScreenplayNode } from './node'
import { typed } from './provenance'
import { node, resetIds, words } from './testing/pagination-corpus'

/**
 * The diff.
 *
 * Every assertion is about what a reader would mark on paper: which lines
 * are struck, which are tinted, which carry a note, and where the asterisks
 * go. The join key is the node id (ADR 0001), so the tests build both drafts
 * from one list and edit it, rather than building two lists that happen to
 * read alike.
 */

const HOLLYWOOD = { format: 'hollywood' } as const

const diff = (base: readonly ScreenplayNode[], head: readonly ScreenplayNode[]): ScreenplayDiff => {
  const result = diffScreenplays(base, head, HOLLYWOOD)
  if (!result.ok) throw new Error(`diff refused: ${result.error.kind}`)
  return result.value
}

const retext = (target: ScreenplayNode, value: string): ScreenplayNode => ({
  ...target,
  content: [text(value)],
})

const scene = (): readonly ScreenplayNode[] => {
  resetIds()
  return [
    node('scene', 'EXT. COMMUNITY PITCH - MOMENTS LATER'),
    node('action', 'Ade turns. An OLD MAN sits on the bench at the touchline, a flat ball at his feet.'),
    node('character', 'ADE'),
    node('dialogue', "I said I'm done."),
    node('character', 'OLD MAN'),
    node('dialogue', "I knew a man. Shorter than you. Slower. Couldn't kick straight for love or money."),
    node('character', 'ADE'),
    node('paren', '(bitter)'),
    node('dialogue', "Then he had talent. I've got nothing."),
    node('transition', 'CUT TO:'),
  ]
}

const kinds = (result: ScreenplayDiff): readonly string[] => result.entries.map((entry) => entry.kind)

const lineKinds = (result: ScreenplayDiff, id: string): readonly string[] =>
  result.entries
    .filter((entry) => String(entry.id) === id)
    .flatMap((entry) => entry.lines.map((line) => line.kind))

describe('the kinds', () => {
  it('are four, and the view draws exactly these', () => {
    expect(DIFF_KINDS).toEqual(['same', 'added', 'deleted', 'changed'])
  })
})

describe('an unchanged draft', () => {
  it('is every node same, no lines counted, no scene touched', () => {
    const base = scene()
    const result = diff(base, base)
    expect(kinds(result)).toEqual(Array.from({ length: base.length }, () => 'same'))
    expect(result.totals.added + result.totals.deleted + result.totals.changed).toBe(0)
    expect(result.linesAdded).toBe(0)
    expect(result.linesDeleted).toBe(0)
    expect(result.scenesTouched).toBe(0)
    expect(result.nodes.same).toBe(base.length)
  })

  it('does not count a change that puts no different line on the paper', () => {
    const base = scene()
    const head = base.map((entry, index) =>
      index === 1 ? retext(entry, 'Ade turns.  An OLD MAN sits on the bench at the touchline, a flat ball at his feet.') : entry,
    )
    expect(kinds(diff(base, head))).toEqual(kinds(diff(base, base)))
  })
})

describe('added and deleted nodes', () => {
  it('reports a new node as added, every line tinted, in its head position', () => {
    const base = scene()
    const added = node('action', 'The old man rolls the ball back.')
    const head = [...base.slice(0, 9), added, ...base.slice(9)]
    const result = diff(base, head)
    expect(kinds(result)[9]).toBe('added')
    expect(lineKinds(result, String(added.id))).toEqual(['added'])
    expect(result.totals.added).toBe(1)
    expect(result.linesAdded).toBe(1)
    expect(result.linesDeleted).toBe(0)
  })

  it('places a deleted node after the nearest surviving node before it', () => {
    const base = scene()
    const paren = base[7]
    if (paren === undefined) throw new Error('fixture')
    const head = base.filter((entry) => entry.id !== paren.id)
    const result = diff(base, head)
    // ADE cue (index 6 in head) is followed by the struck parenthetical, then the speech.
    expect(result.entries.map((entry) => [String(entry.id), entry.kind]).slice(6, 9)).toEqual([
      ['n6', 'same'],
      ['n7', 'deleted'],
      ['n8', 'same'],
    ])
    expect(lineKinds(result, 'n7')).toEqual(['deleted'])
    expect(result.linesDeleted).toBe(1)
  })

  it('places a node deleted from the very top before the first head node', () => {
    const base = scene()
    const head = base.slice(1)
    const result = diff(base, head)
    expect(kinds(result)[0]).toBe('deleted')
    expect(String(result.entries[0]?.id)).toBe('n0')
  })
})

describe('a changed node, line by line', () => {
  it('reads a one-for-one replacement as one changed line', () => {
    const base = scene()
    const head = base.map((entry, index) =>
      index === 8 ? retext(entry, "Then he had talent. I've got nothing at all.") : entry,
    )
    const result = diff(base, head)
    expect(result.entries[8]?.kind).toBe('changed')
    // 35 characters to a dialogue line: both versions are two lines; the
    // first line is common, the second replaced.
    expect(lineKinds(result, 'n8')).toEqual(['same', 'changed'])
    expect(result.totals.changed).toBe(1)
    expect(result.linesAdded).toBe(1)
    expect(result.linesDeleted).toBe(1)
  })

  it('reads a speech cut from three lines to one as struck lines and a new one', () => {
    const base = scene()
    const head = base.map((entry, index) =>
      index === 5 ? retext(entry, 'I knew a man. Shorter than me.') : entry,
    )
    const result = diff(base, head)
    expect(result.entries[5]?.kind).toBe('changed')
    expect(lineKinds(result, 'n5')).toEqual(['deleted', 'deleted', 'deleted', 'added'])
    expect(result.totals).toEqual({ added: 1, deleted: 3, changed: 0, same: 11 })
  })

  it('keeps a line that wrapped identically, even inside a cut speech', () => {
    const base = scene()
    // The first of the three lines - "I knew a man. Shorter than you." - is
    // the whole of the new speech, so it is the same line and stays.
    const head = base.map((entry, index) =>
      index === 5 ? retext(entry, 'I knew a man. Shorter than you.') : entry,
    )
    expect(lineKinds(diff(base, head), 'n5')).toEqual(['same', 'deleted', 'deleted'])
  })

  it('keeps the head text on a changed line and the base text on a struck one', () => {
    const base = scene()
    const head = base.map((entry, index) => (index === 3 ? retext(entry, 'I said no.') : entry))
    const result = diff(base, head)
    const lines = result.entries[3]?.lines ?? []
    expect(lines).toEqual([{ kind: 'changed', text: 'I said no.' }])
    const struck = diff(base, base.filter((_, index) => index !== 3))
    expect(struck.entries[3]?.lines).toEqual([{ kind: 'deleted', text: "I said I'm done." }])
  })

  it('treats a type change with the text intact as every line changed, and says what it was', () => {
    const base = scene()
    const head = base.map((entry, index) =>
      index === 1 ? { ...entry, type: 'dialogue' as const } : entry,
    )
    const result = diff(base, head)
    const entry = result.entries[1]
    expect(entry?.kind).toBe('changed')
    expect(entry?.type).toBe('dialogue')
    expect(entry?.typeBefore).toBe('action')
    expect(entry?.lines.every((line) => line.kind === 'changed')).toBe(true)
  })

  it('treats a delivery modifier as part of the cue', () => {
    const base = scene()
    const head = base.map((entry, index) =>
      index === 4 && entry.type === 'character' ? { ...entry, modifiers: ['V.O.' as const] } : entry,
    )
    const result = diff(base, head)
    expect(result.entries[4]?.kind).toBe('changed')
    expect(result.entries[4]?.typeBefore).toBeNull()
  })
})

describe('moved nodes', () => {
  it('reports a node that moved as deleted where it was and added where it is', () => {
    const base = scene()
    const cut = base[9]
    const first = base[0]
    if (cut === undefined || first === undefined) throw new Error('fixture')
    // The transition moves to the top.
    const head = [first, cut, ...base.slice(1, 9)]
    const result = diff(base, head)
    const entries = result.entries.filter((entry) => entry.id === cut.id)
    expect(entries.map((entry) => entry.kind)).toEqual(['added', 'deleted'])
    expect(entries.every((entry) => entry.moved)).toBe(true)
    expect(result.entries.filter((entry) => entry.id !== cut.id).every((entry) => !entry.moved)).toBe(
      true,
    )
  })

  it('reads a swap of two neighbours as one move, not two', () => {
    const base = scene()
    const [a, b] = [base[2], base[3]]
    if (a === undefined || b === undefined) throw new Error('fixture')
    const head = [...base.slice(0, 2), b, a, ...base.slice(4)]
    const result = diff(base, head)
    const movedIds = new Set(result.entries.filter((entry) => entry.moved).map((entry) => String(entry.id)))
    expect(movedIds.size).toBe(1)
  })
})

describe('what is not on the paper', () => {
  it('ignores comment nodes entirely', () => {
    const base = scene()
    const note = node('comment', 'tighten this')
    const head = [...base.slice(0, 2), note, ...base.slice(2)]
    const result = diff(base, head)
    expect(result.entries.some((entry) => entry.id === note.id)).toBe(false)
    expect(kinds(result)).toEqual(kinds(diff(base, base)))
  })

  it('refuses the unruled A4 sheet with the engine own evidence', () => {
    const base = scene()
    const result = diffScreenplays(base, base, { format: 'asian' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('sheet-width-unresolved')
  })
})

describe('scenes touched', () => {
  const twoScenes = (): readonly ScreenplayNode[] => {
    resetIds()
    return [
      node('scene', 'INT. FLAT - NIGHT'),
      node('action', 'A kettle.'),
      node('scene', 'EXT. STREET - DAY'),
      node('action', 'Rain.'),
      node('scene', 'INTERCUT - PHONE CALL'),
      node('action', 'Both talk.'),
    ]
  }

  it('counts the scenes that contain a change, by the same heading rule as pagination', () => {
    const base = twoScenes()
    const head = base.map((entry, index) => (index === 3 ? retext(entry, 'Heavy rain.') : entry))
    expect(diff(base, head).scenesTouched).toBe(1)
    // The INTERCUT heading is not a scene: a change under it belongs to the street.
    const head2 = base.map((entry, index) => (index === 5 ? retext(entry, 'Both shout.') : entry))
    const result = diff(base, head2)
    expect(result.scenesTouched).toBe(1)
    expect(result.entries[5]?.scene).toBe(2)
  })

  it('gives a deletion the scene of the surviving node before it', () => {
    const base = twoScenes()
    const head = base.filter((_, index) => index !== 3)
    const result = diff(base, head)
    const gone = result.entries.find((entry) => entry.kind === 'deleted')
    expect(gone?.scene).toBe(2)
    expect(result.scenesTouched).toBe(1)
  })
})

describe('mentions', () => {
  it('measures a mention at its record name, and reports one it cannot name', () => {
    resetIds()
    const id = characterId('c1')
    const cue: ScreenplayNode = {
      type: 'character',
      id: nodeId('m0'),
      provenance: typed(),
      content: [mention({ entity: 'character', id })],
      modifiers: [],
    }
    const named = diffScreenplays([cue], [cue], {
      format: 'hollywood',
      mentionLabels: [{ entity: 'character', id, label: 'MEERA' }],
    })
    if (!named.ok) throw new Error('refused')
    expect(named.value.entries[0]?.lines).toEqual([{ kind: 'same', text: 'MEERA' }])
    expect(named.value.unresolvedMentions).toEqual([])

    const unnamed = diff([cue], [cue])
    expect(unnamed.unresolvedMentions.length).toBeGreaterThan(0)
  })
})

describe('the totals', () => {
  it('count lines at the sheet measure, so a long action paragraph is many lines', () => {
    resetIds()
    const long = node('action', words(36)) // 36 five-character words: three 60-character lines
    const result = diff([], [long])
    expect(result.totals.added).toBe(3)
    expect(result.nodes.added).toBe(1)
  })
})
