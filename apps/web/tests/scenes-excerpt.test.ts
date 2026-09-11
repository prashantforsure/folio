// @vitest-environment node
import type { NodeId, ScreenplayNode } from '@folio/script'
import { NO_LABELS, labelBook, characterId, makeScreenplayNode, mention, text, typed } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { cutExcerpts, lineText } from '../lib/scenes/excerpt'

/**
 * `cutExcerpts` cuts the node list along the headings derivation accepted.
 * It decides nothing about what a scene is: the present ids are passed in.
 *
 * Node environment, not jsdom: nothing here renders, and the jsdom
 * environment does not load on the local Node (`apps/web/CLAUDE.md`, trap 1).
 */

let counter = 0
const id = (): NodeId => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` as NodeId

const node = (type: ScreenplayNode['type'], value: string, nodeId: NodeId = id()): ScreenplayNode =>
  makeScreenplayNode(type, {
    id: nodeId,
    provenance: typed(),
    content: [text(value)],
    modifiers: [],
  })

describe('cutExcerpts', () => {
  it('cuts one excerpt per accepted heading, heading first, comments skipped', () => {
    const a = id()
    const b = id()
    const nodes = [
      node('action', 'FADE IN:'),
      node('scene', 'INT. MEERAS FLAT - NIGHT', a),
      node('action', 'She does not look back.'),
      node('comment', 'check this against the bible'),
      node('character', 'MEERA'),
      node('dialogue', 'Sit down. Please.'),
      node('scene', 'EXT. THE CHAWL - DAY', b),
      node('action', 'Outside, a train.'),
    ]
    const { excerpts, unaccepted } = cutExcerpts(nodes, [a, b], NO_LABELS)
    expect(unaccepted).toEqual([])
    expect([...excerpts.keys()]).toEqual([a, b])
    expect(excerpts.get(a)?.lines.map((line) => [line.type, line.text])).toEqual([
      ['scene', 'INT. MEERAS FLAT - NIGHT'],
      ['action', 'She does not look back.'],
      ['character', 'MEERA'],
      ['dialogue', 'Sit down. Please.'],
    ])
    expect(excerpts.get(b)?.lines).toHaveLength(2)
  })

  it('a scene node derivation did not accept is reported as refused, not cut as a scene', () => {
    const a = id()
    const bad = id()
    const nodes = [
      node('scene', 'INT. MEERAS FLAT - NIGHT', a),
      node('action', 'The fan turns.'),
      node('scene', 'INTERCUT - PHONE CALL', bad),
      node('action', 'Nobody speaks.'),
    ]
    const { excerpts, unaccepted } = cutExcerpts(nodes, [a], NO_LABELS)
    expect([...excerpts.keys()]).toEqual([a])
    // The demoted heading stays inside the scene it was in, as the text typed.
    expect(excerpts.get(a)?.lines.map((line) => line.text)).toEqual([
      'INT. MEERAS FLAT - NIGHT',
      'The fan turns.',
      'INTERCUT - PHONE CALL',
      'Nobody speaks.',
    ])
    expect(unaccepted).toHaveLength(1)
    expect(unaccepted[0]?.nodeId).toBe(bad)
    expect(unaccepted[0]?.why).toEqual({
      kind: 'rejected',
      heading: 'INTERCUT - PHONE CALL',
      reason: { kind: 'prefix-not-a-word', looksLike: 'INT' },
    })
  })

  it('an accepted-looking heading with no derived row is "not-derived", never silently a scene', () => {
    const a = id()
    const late = id()
    const nodes = [node('scene', 'INT. A - DAY', a), node('scene', 'EXT. B - NIGHT', late)]
    const { excerpts, unaccepted } = cutExcerpts(nodes, [a], NO_LABELS)
    expect([...excerpts.keys()]).toEqual([a])
    expect(unaccepted).toEqual([
      { nodeId: late, text: 'EXT. B - NIGHT', why: { kind: 'not-derived' } },
    ])
  })
})

describe('lineText', () => {
  it('prints a mention as @Name from the label book, and @? without one', () => {
    const meera = characterId('11111111-1111-4111-8111-111111111111')
    const cue = makeScreenplayNode('action', {
      id: id(),
      provenance: typed(),
      content: [text('Enter '), mention({ entity: 'character', id: meera }), text('.')],
      modifiers: [],
    })
    if (cue.type === 'comment') throw new Error('unreachable')
    expect(lineText(cue, labelBook([{ entity: 'character', id: meera, label: 'Meera' }]))).toBe(
      'Enter @Meera.',
    )
    expect(lineText(cue, NO_LABELS)).toBe('Enter @?.')
  })
})
