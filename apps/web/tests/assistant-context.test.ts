import type { SceneRef } from '@folio/contracts'
import type { MentionLabel, NodeId, ScreenplayNode } from '@folio/script'
import { makeScreenplayNode, nodeId, text, typed } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { buildContext, focusBlock, renderProject, renderScript, sliceScenes } from '../lib/assistant/context'

/**
 * What the assistant is shown - `lib/assistant/context.ts`. The episode
 * scope is the panel's standing since 2026-09-16; the project scope and
 * the Focus block are the Characters rebuild's (phase 4). Every test here
 * is about the text the model reads, never about a call.
 */

const node = (n: number): NodeId => nodeId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

const line = (n: number, type: ScreenplayNode['type'], body: string): ScreenplayNode =>
  makeScreenplayNode(type, { id: node(n), provenance: typed(), content: [text(body)], modifiers: [] })

const ref = (n: number, episodeOrdinal: number, number: number, heading: string): SceneRef => ({
  sceneNodeId: node(n),
  episode: `ep_${String(episodeOrdinal).padStart(3, '0')}` as SceneRef['episode'],
  episodeOrdinal,
  number,
  heading,
})

const labels: readonly MentionLabel[] = []

const episodeOne = [
  line(1, 'scene', 'INT. CHAWL - NIGHT'),
  line(2, 'action', 'Rain.'),
  line(3, 'character', 'MEERA'),
  line(4, 'dialogue', 'Two buckets.'),
  line(5, 'comment', 'angrier here'),
  line(6, 'scene', 'INT. OFFICE - DAY'),
  line(7, 'character', 'KADAM'),
  line(8, 'dialogue', 'The paper is the paper.'),
]
const episodeTwo = [line(9, 'scene', 'EXT. STANDPIPE - DAY'), line(10, 'character', 'ANIL'), line(11, 'dialogue', 'Fifteenth.')]
const index = [ref(1, 1, 1, 'INT. CHAWL - NIGHT'), ref(6, 1, 2, 'INT. OFFICE - DAY'), ref(9, 2, 1, 'EXT. STANDPIPE - DAY')]
const episodes = [
  { ordinal: 1, title: 'Buckets', nodes: episodeOne },
  { ordinal: 2, title: '', nodes: episodeTwo },
]

describe('the episode scope', () => {
  it('numbers scenes and keeps the shape it always had', () => {
    const rendered = renderScript(episodeOne, labels)
    expect(rendered.truncated).toBe(false)
    expect(rendered.text).toContain('[Scene 1] INT. CHAWL - NIGHT')
    expect(rendered.text).toContain('[Scene 2] INT. OFFICE - DAY')
    expect(rendered.text).toContain("[[writer's note: angrier here]]")
    const context = buildContext({ projectTitle: 'Harbour', script: { kind: 'episode', episodeTitle: 'Buckets', nodes: episodeOne }, labels, cast: [] })
    expect(context.system).toContain('Project: Harbour\nEpisode: Buckets')
    expect(context.system).toContain('No character records yet')
    expect(context.focus).toBeNull()
    expect(context.cut).toEqual([])
  })
})

describe('the project scope', () => {
  it('marks every episode and cites scenes by episode and number', () => {
    const rendered = renderProject(episodes, labels, index, 100_000)
    expect(rendered.cut).toEqual([])
    expect(rendered.text).toContain('[Episode 1 · Buckets]')
    expect(rendered.text).toContain('[Episode 2]')
    expect(rendered.text).toContain('[E1 Sc 2] INT. OFFICE - DAY')
    expect(rendered.text).toContain('[E2 Sc 1] EXT. STANDPIPE - DAY')
    expect(rendered.text.indexOf('[Episode 1')).toBeLessThan(rendered.text.indexOf('[Episode 2]'))
  })

  it('shares the cap across episodes and says which it cut, never silently', () => {
    const rendered = renderProject(episodes, labels, index, 90)
    expect(rendered.cut).toEqual([1])
    expect(rendered.text).toContain('[Episode 1 continues; it was cut here to fit. Say so if the writer asks about a later scene.]')
    expect(rendered.text).toContain('[E2 Sc 1]')
  })

  it('tells the model to cite across episodes and reports the cut', () => {
    const context = buildContext({
      projectTitle: 'Harbour',
      script: { kind: 'project', episodes, index },
      labels,
      cast: [{ name: 'Meera', line: 'the lead' }],
    })
    expect(context.system).toContain('Cite a scene as "E2 Sc 9"')
    expect(context.system).toContain('Episodes: 2')
    expect(context.system).toContain('- Meera: the lead')
    expect(context.truncated).toBe(false)
  })
})

describe('sliceScenes', () => {
  it('cuts the project into the indexed scenes, comments out, nodes before the first heading dropped', () => {
    const scenes = sliceScenes([{ ordinal: 1, title: 'Buckets', nodes: [line(0, 'action', 'Before any heading.'), ...episodeOne] }, episodes[1] as (typeof episodes)[number]], labels, index)
    expect([...scenes.keys()]).toEqual([node(1), node(6), node(9)])
    const first = scenes.get(node(1))
    expect(first?.label).toBe('E1 Sc 1')
    expect(first?.text).toContain('Rain.')
    expect(first?.text).toContain('MEERA')
    expect(first?.text).not.toContain('angrier')
    expect(first?.text).not.toContain('Before any heading')
    expect(scenes.get(node(9))?.text).toContain('Fifteenth.')
  })

  it('keeps a heading the index did not accept inside the scene it is in', () => {
    const nodes = [line(1, 'scene', 'INT. CHAWL - NIGHT'), line(2, 'scene', 'INTERCUT - PHONE'), line(3, 'action', 'She dials.')]
    const scenes = sliceScenes([{ ordinal: 1, title: '', nodes }], labels, [index[0] as SceneRef])
    expect([...scenes.keys()]).toEqual([node(1)])
    expect(scenes.get(node(1))?.text).toContain('INTERCUT - PHONE')
  })
})

describe('focusBlock', () => {
  it('names the open record, its spellings, the profile as written, and the counts', () => {
    const block = focusBlock({
      name: 'Meera Pawar',
      cues: ['MEERA', 'MEERA PAWAR'],
      status: 'draft',
      role: 'the lead',
      bio: null,
      wants: '  ',
      needs: 'to be believed',
      scenes: 79,
      perEpisode: [
        { ordinal: 1, scenes: 28 },
        { ordinal: 2, scenes: 51 },
      ],
      lines: 412,
    })
    expect(block).toContain("Focus: the writer has Meera Pawar's record open on the Characters route.")
    expect(block).toContain('In the script as: MEERA, MEERA PAWAR')
    expect(block).toContain('Description: not written')
    expect(block).toContain('Wants: not written')
    expect(block).toContain('Needs: to be believed')
    expect(block).toContain('Scenes: 79 (E1 28 · E2 51) · 412 lines')
    expect(block).toContain('You cannot write into the record yourself.')
    const context = buildContext({
      projectTitle: 'Harbour',
      script: { kind: 'project', episodes, index },
      labels,
      cast: [],
      focus: { name: 'Meera', cues: [], status: 'draft', role: null, bio: null, wants: null, needs: null, scenes: 0, perEpisode: [], lines: 0 },
    })
    expect(context.focus).toContain('In the script as: no spelling bound yet')
    expect(context.system).not.toContain('Focus:')
  })
})
