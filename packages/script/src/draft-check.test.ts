import { describe, expect, it } from 'vitest'

import { canonicalScreenplay, checkDraft, unresolvedCues } from './draft-check'
import { characterId, nodeId, runId } from './ids'
import type { InlineContent } from './inline'
import { mention, text } from './inline'
import type { ScreenplayNode, ScreenplayNodeType } from './node'
import { makeScreenplayNode } from './node'
import { byAgent, typed } from './provenance'

/**
 * A drafted script held to the bound spellings (roadmap task 4.5): a cue or a
 * heading that keys to a bound spelling is rewritten to it, one that leads
 * into exactly one is repaired to it, anything else is rejected and reported;
 * a mention of a record that does not exist is dropped. And a node list's
 * canonical form is the one a stored copy reads back as, whatever order its
 * keys were built in.
 */

const MEERA = characterId('30000000-0000-4000-8000-000000000001')
const GHOST = characterId('30000000-0000-4000-8000-00000000dead')

let counter = 0
const node = (type: ScreenplayNodeType, content: string | InlineContent): ScreenplayNode => {
  counter += 1
  return makeScreenplayNode(type, {
    id: nodeId(`n${String(counter)}`),
    provenance: typed(),
    content: typeof content === 'string' ? [text(content)] : content,
    modifiers: [],
  })
}

const BOUND = {
  cues: ['MEERA', 'RAVI', 'DR RAO', 'DR SEN'],
  sets: ['HOSPITAL WARD', 'HARBOUR'],
  records: new Set([`character:${MEERA as string}`]),
}

const lineOf = (entry: ScreenplayNode): string => entry.content.map((run) => (run.kind === 'text' ? run.text : `@${run.target.id as string}`)).join('')

describe('checkDraft', () => {
  it('rewrites a cue written otherwise to its bound spelling, keeping the extension', () => {
    const checked = checkDraft([node('character', 'Meera (V.O.)'), node('character', 'MEERA  ')], BOUND)
    expect(checked.nodes.map(lineOf)).toEqual(['MEERA (V.O.)', 'MEERA  '])
    expect(checked.repaired.map((issue) => issue.repairedTo)).toEqual(['MEERA (V.O.)'])
    expect(checked.rejected).toEqual([])
  })

  it('repairs a cue that leads into exactly one bound spelling, and rejects one that leads into two or none', () => {
    const checked = checkDraft([node('character', 'MEERA K.'), node('character', 'DR'), node('character', 'NURSE')], BOUND)
    expect(checked.nodes.map(lineOf)).toEqual(['MEERA', 'DR', 'NURSE'])
    expect(checked.repaired).toEqual([expect.objectContaining({ kind: 'cue', found: 'MEERA K.', repairedTo: 'MEERA' })])
    expect(checked.rejected.map((issue) => issue.found)).toEqual(['DR', 'NURSE'])
  })

  it('holds a heading`s set to its bound spelling', () => {
    const checked = checkDraft(
      [node('scene', 'INT. hospital ward - NIGHT'), node('scene', 'EXT. HOSPITAL - DAY'), node('scene', 'EXT. LIGHTHOUSE - DAY'), node('scene', 'INTERCUT - PHONE CALL')],
      BOUND,
    )
    expect(checked.nodes.map(lineOf)).toEqual(['INT. HOSPITAL WARD - NIGHT', 'EXT. HOSPITAL WARD - DAY', 'EXT. LIGHTHOUSE - DAY', 'INTERCUT - PHONE CALL'])
    expect(checked.repaired.map((issue) => issue.kind)).toEqual(['heading', 'heading'])
    expect(checked.rejected.map((issue) => issue.found)).toEqual(['EXT. LIGHTHOUSE - DAY', 'INTERCUT - PHONE CALL'])
  })

  it('drops a mention of a record that does not exist, and keeps one that does', () => {
    const checked = checkDraft([node('action', [mention({ entity: 'character', id: MEERA }), text(' waits for '), mention({ entity: 'character', id: GHOST }), text('.')])], BOUND)
    expect(checked.nodes.map(lineOf)).toEqual([`@${MEERA as string} waits for .`])
    expect(checked.repaired).toEqual([expect.objectContaining({ kind: 'mention', found: `character:${GHOST as string}`, repairedTo: null })])
  })

  it('leaves every other line as it was', () => {
    const lines = [node('action', 'The ward hums.'), node('dialogue', 'Not yet.'), node('paren', '(quietly)'), node('transition', 'CUT TO:')]
    expect(checkDraft(lines, BOUND)).toEqual({ nodes: lines, repaired: [], rejected: [] })
  })
})

describe('unresolvedCues', () => {
  it('names the cues no bound spelling claims - none once a draft is repaired', () => {
    const drafted = [node('scene', 'INT. HARBOUR - DAY'), node('character', 'Meera'), node('dialogue', 'Go.'), node('character', 'NURSE'), node('dialogue', 'Stop.')]
    expect(unresolvedCues(drafted, BOUND.cues)).toEqual(['NURSE'])
    const repaired = checkDraft(drafted.slice(0, 3), BOUND).nodes
    expect(unresolvedCues(repaired, BOUND.cues)).toEqual([])
  })
})

describe('canonicalScreenplay', () => {
  it('gives the same list the same serialisation, however its keys were built', () => {
    const run = runId('3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a98')
    const built = makeScreenplayNode('action', { id: nodeId('n-a'), provenance: byAgent(run), content: [mention({ entity: 'character', id: MEERA }), text(' waits.')], modifiers: [] })
    // As jsonb hands it back: keys in another order, the mention's target reversed.
    const stored = JSON.parse(
      `{"content":[{"target":{"id":"${MEERA as string}","entity":"character"},"kind":"mention"},{"text":" waits.","kind":"text"}],"provenance":{"runId":"${run as string}","source":"agent"},"id":"n-a","type":"action"}`,
    ) as ScreenplayNode
    expect(JSON.stringify(stored)).not.toBe(JSON.stringify(built))
    expect(JSON.stringify(canonicalScreenplay([stored]))).toBe(JSON.stringify(canonicalScreenplay([built])))
  })
})
