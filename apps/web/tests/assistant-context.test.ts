import type { SceneRef } from '@folio/contracts'
import type { MentionLabel, NodeId, ScreenplayNode } from '@folio/script'
import { makeScreenplayNode, nodeId, text, typed } from '@folio/script'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CRAFT_RULES } from '../lib/agent/craft'
import { SELECTION_LINES, buildContext, focusBlock, renderProject, renderScript, scriptSelection, sliceScenes, whereBlock } from '../lib/assistant/context'

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
    // Since roadmap task 3.7 the Focus block points at the write tool instead of saying it cannot write.
    expect(block).toContain('propose them with update_character; the writer applies it.')
    expect(block).not.toContain('You cannot write')
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

describe('the instructions (roadmap task 2.6, and prompt v3 - task 3.7)', () => {
  const system = buildContext({ projectTitle: 'Buckets', script: { kind: 'episode', episodeTitle: 'Buckets', nodes: episodeOne }, labels, cast: [] }).system

  it('say what the tools do: read, search, navigate and export', () => {
    expect(system).toContain('with your tools, read, search and count across the whole project')
    expect(system).toContain('take the writer to a page or a scene')
    expect(system).toContain('hand them an export')
  })

  it('say it acts through proposals the writer reviews and applies, and never to claim a change is made (R8, D1)', () => {
    expect(system).toContain('Every change is a proposal: nothing changes until the writer reviews it')
    expect(system).toContain('Never say a change is made: say it is proposed')
    expect(system).toContain('A rename, a merge, a delete, a format change and undoing a run always ask the writer to confirm.')
    expect(system).not.toContain('What you cannot do: change anything')
  })

  it('carry the tool policy', () => {
    for (const rule of [
      'Read before you write.',
      'Never invent an id.',
      'Preview a rename before proposing it',
      'Create characters and locations before the script uses them',
      'Use the bound spellings exactly',
      'Group related changes into one proposal',
      'Explain each proposal in a sentence or two',
    ]) {
      expect(system, rule).toContain(rule)
    }
  })

  it('carry every craft rule of docs/agents/craft.md, word for word and in order', () => {
    const craft = readFileSync(join(import.meta.dirname, '../../../docs/agents/craft.md'), 'utf8')
    // The numbered list: a rule starts "N. " and may wrap onto indented lines.
    const rules: string[] = []
    for (const line of craft.split(/\r?\n/u)) {
      const start = /^(\d+)\. (.*)$/u.exec(line)
      if (start !== null) rules.push(start[2] ?? '')
      else if (rules.length > 0 && /^ {3,}\S/u.test(line)) rules[rules.length - 1] = `${rules.at(-1) ?? ''} ${line.trim()}`
      else if (rules.length > 0 && line.trim().length === 0 && rules.length >= 14) break
    }
    expect(rules).toEqual([...CRAFT_RULES])
    for (const [index, rule] of CRAFT_RULES.entries()) expect(system).toContain(`${String(index + 1)}. ${rule}`)
  })

  it('keep citing scenes as they did, and put every number on a tool (ruling R4)', () => {
    expect(system).toContain('Cite scenes by their number as "Scene 3"')
    expect(system).toContain('State a number only as a tool returned it.')
    expect(system).toContain('never estimate a page count')
  })
})

describe('where the writer is', () => {
  it('quotes a Script selection from the stored script, each run under its scene', () => {
    const selection = scriptSelection(episodeOne, [node(4), node(7), node(8)], labels)
    expect(selection).toEqual({
      kind: 'script',
      lines: ['(in Scene 1)', 'Two buckets.', '(in Scene 2)', 'KADAM', 'The paper is the paper.'],
      more: 0,
    })
  })

  it('ignores an id the stored script does not hold, and a selection of only those is no selection', () => {
    expect(scriptSelection(episodeOne, [node(99)], labels)).toBeNull()
  })

  it('cuts a long selection and says how many more', () => {
    const long = Array.from({ length: SELECTION_LINES + 5 }, (_, at) => line(100 + at, 'action', `Line ${String(at)}`))
    const selection = scriptSelection([line(99, 'scene', 'INT. HALL - DAY'), ...long], long.map((entry) => entry.id), labels)
    expect(selection?.kind === 'script' ? selection.more : -1).toBe(5)
  })

  it('names the page, and counts an Outline selection without reading the outline', () => {
    expect(whereBlock({ route: 'outline', selection: { kind: 'outline', blocks: 3 } })).toBe(
      ['Where the writer is:', 'The writer is on the Outline page.', '', "They have 3 outline blocks selected. The outline's text is not in what you can read; ask them to paste it if the question needs it."].join('\n'),
    )
    expect(whereBlock({ route: null, selection: null })).toBeNull()
  })

  it('is its own block, so the cached system prefix does not move with the route or the selection', () => {
    const base = { projectTitle: 'Buckets', script: { kind: 'episode' as const, episodeTitle: 'Buckets', nodes: episodeOne }, labels, cast: [] }
    const onScript = buildContext({ ...base, where: { route: 'script', selection: scriptSelection(episodeOne, [node(4)], labels) } })
    const onOutline = buildContext({ ...base, where: { route: 'outline', selection: null } })
    expect(onScript.system).toBe(onOutline.system)
    expect(onScript.where).toContain('Two buckets.')
    expect(onOutline.where).toBe('Where the writer is:\nThe writer is on the Outline page.')
  })
})
