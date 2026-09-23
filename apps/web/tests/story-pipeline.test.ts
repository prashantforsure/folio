// @vitest-environment node
import type { AgentProposalStatus, Episode, Project, StoryStageStatus } from '@folio/contracts'
import { assistantChatId, episodeId, episodeSlug, projectId, userId } from '@folio/contracts'
import type { JobOutcome, ProjectScope } from '@folio/db'
import type { OutlineNode, OutlineOp, ScreenplayNode, ScriptOp } from '@folio/script'
import { applyOutlineOps, applyScriptOps, byAgent, canonicalScreenplay, cueSpelling, readSlugline, runId, setSpelling, unresolvedCues } from '@folio/script'
import type Anthropic from '@anthropic-ai/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelClient, ModelMessage } from '../lib/agent/loop'

/**
 * The story-to-script pipeline end to end - roadmap task 4.5.
 *
 * The model is scripted by the tool each call is forced to; the project is in
 * memory, and "the writer" applies each proposal the way apply does: a script
 * batch only when its base digest is the stored script's, the result stored in
 * the form a stored copy reads back in. Six jobs carry one thin story from a
 * line to a draft - expanded, cast, outlined, listed, drafted in two chained
 * batches, placed in story time - stopping for the writer at every
 * checkpoint. What is held at the end: **zero unresolved cues** (the task's
 * own test), every heading on a bound set, every batch applied on the script
 * it was planned on, and the misspelt cue the model tried refused before it
 * reached a proposal.
 */

const RUN = runId('3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a98')
const PROJECT = projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10')
const EPISODE = { id: episodeId('1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a'), projectId: PROJECT, ordinal: 1, slug: episodeSlug('ep_001'), title: 'Pilot' } as Episode

type Proposal = { status: AgentProposalStatus; ops: { tool: string; args: unknown; idempotencyKey: string }[]; digest: string | null }

const world = vi.hoisted(() => ({
  characters: [] as { id: string; name: string; cue: string; bio?: string | null; notes?: Record<string, unknown> }[],
  locations: [] as { id: string; name: string; set: string }[],
  docs: new Map<string, { kind: 'screenplay' | 'outline'; nodes: unknown[] }>(),
  proposals: new Map<string, { status: string; ops: { tool: string; args: unknown; idempotencyKey: string }[]; digest: string | null }>(),
  stages: new Map<string, { stage: string; status: string; output: unknown }>(),
  messages: [] as { role: 'user' | 'assistant'; body: string }[],
  sceneIndex: [] as { sceneNodeId: string; number: number; episodeOrdinal: number; episode: string; heading: string }[],
  threads: [] as { id: string; name: string }[],
  applied: { storyTimes: [] as unknown[], synopses: [] as unknown[], sceneThreads: [] as unknown[] },
  runStatus: 'running',
  note: null as string | null,
  counter: 0,
}))

const uuid = (): string => {
  world.counter += 1
  return `00000000-0000-4000-8000-${world.counter.toString(16).padStart(12, '0')}`
}

vi.mock('@folio/db', async (actual) => {
  const real = await actual<Record<string, unknown>>()
  return {
    ...real,
    addAgentRunTokens: () => Promise.resolve(),
    readRunStages: () => Promise.resolve(new Map([...world.stages.entries()].map(([key, row]) => [key, { ...row }]))),
    saveRunStage: (_scope: unknown, _run: unknown, stage: string, status: string, output: unknown) => {
      world.stages.set(stage, { stage, status, output: JSON.parse(JSON.stringify(output)) as unknown })
      return Promise.resolve()
    },
    setRunStageStatus: (_scope: unknown, _run: unknown, stage: string, status: string) => {
      const row = world.stages.get(stage)
      if (row !== undefined) row.status = status
      return Promise.resolve()
    },
    listMessages: () =>
      Promise.resolve(world.messages.map((message, index) => ({ id: `m${String(index)}`, projectId: PROJECT, chatId: 'c', role: message.role, body: message.body, content: null, runId: RUN, createdAt: '' }))),
    readAgentRun: () => Promise.resolve({ id: RUN, status: world.runStatus }),
    listCharacterRecords: () => Promise.resolve(world.characters.map((record) => ({ id: record.id, name: record.name }))),
    listCharacterVoices: () => Promise.resolve(world.characters.map((record) => ({ id: record.id, name: record.name, voice: typeof record.notes?.['voice'] === 'string' ? record.notes['voice'] : null }))),
    listLocationRecords: () => Promise.resolve(world.locations.map((record) => ({ id: record.id, name: record.name }))),
    listBoundCues: () => Promise.resolve(world.characters.map((record) => ({ characterId: record.id, cue: record.cue }))),
    listBoundSluglines: () => Promise.resolve(world.locations.map((record) => ({ locationId: record.id, slugline: record.set }))),
    readMentionLabels: () =>
      Promise.resolve([
        ...world.characters.map((record) => ({ entity: 'character', id: record.id, label: record.name })),
        ...world.locations.map((record) => ({ entity: 'location', id: record.id, label: record.name })),
      ]),
    mintNodeIds: (_scope: unknown, count: number) => Promise.resolve(Array.from({ length: count }, uuid)),
    readDocumentByKind: (_scope: unknown, _episode: unknown, kind: string) => {
      const found = [...world.docs.entries()].find(([, doc]) => doc.kind === kind)
      return Promise.resolve(found === undefined ? null : { id: found[0], kind, episodeId: EPISODE.id })
    },
    createDocument: (_scope: unknown, _episode: unknown, kind: 'screenplay' | 'outline') => {
      const id = uuid()
      world.docs.set(id, { kind, nodes: [] })
      return Promise.resolve({ id, kind, episodeId: EPISODE.id })
    },
    readProposal: (_scope: unknown, id: string) => {
      const proposal = world.proposals.get(id)
      return Promise.resolve(
        proposal === undefined
          ? null
          : { proposal: { id, status: proposal.status, needsConfirmation: false, summary: 'A proposal' }, ops: proposal.ops.map((op) => ({ ...op, id: uuid(), status: 'pending', mode: 'propose' })) },
      )
    },
    readProposalOpByKey: (_scope: unknown, key: string) => {
      for (const [proposalId, proposal] of world.proposals) {
        const op = proposal.ops.find((entry) => entry.idempotencyKey === key)
        if (op !== undefined) return Promise.resolve({ ...op, proposalId, status: 'pending' })
      }
      return Promise.resolve(null)
    },
    listSceneIndex: () => Promise.resolve(world.sceneIndex),
    listEpisodes: () => Promise.resolve([EPISODE]),
    listStoryThreads: () => Promise.resolve(world.threads),
  }
})

vi.mock('../lib/agent/proposer', () => ({
  proposalSink: () => ({
    create: (groups: readonly { readonly ops: readonly { readonly key: string; readonly op: { readonly tool: string; readonly args: unknown; readonly base?: { readonly digest: string } } }[] }[]) =>
      Promise.resolve(
        groups.map((group) => {
          const first = group.ops[0]
          const replayed = [...world.proposals.entries()].find(([, proposal]) => proposal.ops.some((op) => op.idempotencyKey === first?.key))
          const id = replayed?.[0] ?? uuid()
          if (replayed === undefined) {
            world.proposals.set(id, { status: 'pending', ops: group.ops.map((entry) => ({ tool: entry.op.tool, args: entry.op.args, idempotencyKey: entry.key })), digest: group.ops.find((entry) => entry.op.base !== undefined)?.op.base?.digest ?? null })
          }
          return { proposalId: id, runId: RUN, summary: 'A proposal', needsConfirmation: false, auto: false }
        }),
      ),
    applyNow: () => Promise.resolve({ ok: false, message: 'no' }),
  }),
}))
vi.mock('../lib/agent/documents', async () => {
  const { nodeDigest } = await import('../lib/script/server')
  return {
    readDocumentState: (_scope: unknown, id: string) => {
      const doc = world.docs.get(id)
      return Promise.resolve(doc === undefined ? null : { kind: doc.kind, documentId: id, episodeId: EPISODE.id, updatedAt: '', nodes: doc.nodes, digest: nodeDigest(doc.nodes) })
    },
  }
})
vi.mock('../lib/agent/apply', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  rejectProposalWith: (_gate: unknown, id: string) => {
    const proposal = world.proposals.get(id)
    if (proposal !== undefined) proposal.status = 'rejected'
    return Promise.resolve({ status: 'rejected' })
  },
}))
vi.mock('../lib/script/server', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  rederiveProject: () => {
    const script = [...world.docs.values()].find((doc) => doc.kind === 'screenplay')
    const headings = ((script?.nodes ?? []) as ScreenplayNode[]).filter((node) => node.type === 'scene')
    world.sceneIndex = headings.map((node, index) => ({ sceneNodeId: node.id, number: index + 1, episodeOrdinal: 1, episode: 'ep_001', heading: node.content.map((run) => (run.kind === 'text' ? run.text : '')).join('') }))
    return Promise.resolve({ ok: true, derivation: null })
  },
}))
vi.mock('../lib/script/page-count', () => ({ readPageCount: () => Promise.resolve({ status: 'ok', count: { pages: 6 } }) }))
vi.mock('../lib/timeline/server', () => ({ readContinuity: () => Promise.resolve({ continuity: { buckets: { open: [] } } }) }))

const { runStoryJob, notesOf, STORY_WAITING } = await import('../lib/agent/story/pipeline')
const { nodeDigest } = await import('../lib/script/server')

// ---------------------------------------------------------------------------
// The model, scripted by the tool each call is forced to
// ---------------------------------------------------------------------------

const BRIEF = {
  logline: 'A night nurse has one shift to find the patient who is not on her ward.',
  genre: 'Thriller',
  tone: 'Quiet, tense, dry',
  format: 'short film',
  targetPages: 6,
  protagonist: { name: 'MEERA', want: 'to finish the shift clean', need: 'to trust someone' },
  stakes: 'A patient dies unseen.',
  setting: 'A coastal hospital, now',
  assumptions: ['It is set over one night.', 'The ward is understaffed.'],
}
const BIBLE = {
  characters: [
    { name: 'MEERA', role: 'Night nurse', voice: 'Short, exact, never says please.', description: 'Thirties; keeps a pencil behind one ear.' },
    { name: 'RAVI', role: 'Porter', voice: 'Talks around things; jokes when scared.', description: 'Fifties; knows every corridor.' },
  ],
  locations: [
    { name: 'HOSPITAL WARD', description: 'Six beds, one flickering light.' },
    { name: 'HARBOUR WALL', description: 'Behind the hospital, over the water.' },
  ],
}
const OUTLINE = { acts: [{ title: 'The missing bed', beats: [{ title: 'The count', summary: 'Meera counts seven where there should be six.' }, { title: 'The wall', summary: 'Ravi shows her where the seventh went.' }] }] }
const SCENES = {
  scenes: Array.from({ length: 7 }, (_, index) => ({
    beat: index < 4 ? 'The count' : 'The wall',
    place: index % 3 === 2 ? 'EXT' : 'INT',
    location: index % 3 === 2 ? 'HARBOUR WALL' : 'HOSPITAL WARD',
    time: 'night',
    synopsis: `Scene ${String(index + 1)}: Meera closes in on the seventh bed.`,
    characters: ['MEERA', 'RAVI'],
  })),
}
const lines = (n: number, cue = 'MEERA') => ({
  lines: [
    { type: 'action', text: `The ward at ${String(n)} a.m. One light ticks.` },
    { type: 'dialogue', character: cue, parenthetical: n % 2 === 0 ? 'low' : null, text: 'Seven.' },
    { type: 'dialogue', character: 'RAVI', parenthetical: null, text: 'Six. Always six.' },
  ],
})
const TIME = { days: Array.from({ length: 7 }, (_, index) => ({ scene: index + 1, day: 1, flashback: false })), threads: [{ name: 'The seventh bed', scenes: [1, 3, 7] }] }

const calls: { name: string; prompt: string }[] = []

const model = (): ModelClient => ({
  stream: (params: Anthropic.MessageStreamParams) => {
    const choice = params.tool_choice
    const name = choice?.type === 'tool' ? choice.name : ''
    const prompt = JSON.stringify(params.messages.at(-1)?.content ?? '')
    calls.push({ name, prompt })
    const drafts = calls.filter((call) => call.name === 'submit_scene').length
    const critiques = calls.filter((call) => call.name === 'submit_critique').length
    const input: unknown =
      name === 'submit_story'
        ? BRIEF
        : name === 'submit_bible'
          ? BIBLE
          : name === 'submit_outline'
            ? OUTLINE
            : name === 'submit_scenes'
              ? SCENES
              : name === 'submit_scene'
                ? // The first try cues a spelling the project does not hold; the schema refuses it and the model is asked again.
                  lines(drafts, drafts === 1 ? 'MEERA K.' : 'MEERA')
                : name === 'submit_critique'
                  ? { scores: [{ rule: 7, score: critiques === 2 ? 2 : 4, note: critiques === 2 ? 'She says what she feels.' : 'Fine.' }] }
                  : name === 'submit_story_time'
                    ? TIME
                    : {}
    const message: ModelMessage = {
      content: [{ type: 'tool_use', id: `toolu_${String(calls.length)}`, name, input, caller: { type: 'direct' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }
    return {
      [Symbol.asyncIterator]: async function* () {
        yield* []
      },
      finalMessage: () => Promise.resolve(message),
    }
  },
})

// ---------------------------------------------------------------------------
// The writer, and a job
// ---------------------------------------------------------------------------

const GATE = { actor: userId('7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b'), scope: { projectId: PROJECT } as ProjectScope, project: { id: PROJECT, title: 'Night Ward', projectType: 'film' } as Project, episode: EPISODE, role: 'writer' as const }

const job = (): Promise<JobOutcome> => {
  world.runStatus = 'running'
  return runStoryJob(
    {
      scope: GATE.scope,
      runId: RUN,
      chatId: assistantChatId('0b8e2d4c-1a3f-4e5d-8c7b-9a6f5e4d3c21'),
      episode: EPISODE,
      open: () => Promise.resolve(GATE),
      client: model(),
      signal: new AbortController().signal,
      autonomy: 'review',
      tokenBudget: 1_000_000,
      say: (body) => {
        world.messages.push({ role: 'assistant', body })
        return Promise.resolve()
      },
      settle: (status, message) => {
        world.runStatus = status
        world.note = message
        return Promise.resolve(status === 'failed' ? { status: 'failed', error: message ?? '' } : status === 'cancelled' ? { status: 'cancelled' } : { status: 'finished' })
      },
    },
    { kind: 'story_to_script', title: 'Night Ward', story: 'A nurse counts seven beds on a ward of six.' },
  )
}

const reply = (words = '[Folio: since the run paused, nothing was asked.]\n\nCarry on.'): void => {
  world.messages.push({ role: 'user', body: words })
}

const staleOrApplied = { stale: 0 }

/** The writer applies a proposal, the way apply does: a document edit only on the script it was planned on. */
const apply = (id: string): void => {
  const proposal = world.proposals.get(id) as Proposal | undefined
  if (proposal === undefined) throw new Error(`no proposal ${id}`)
  for (const op of proposal.ops) {
    const args = op.args as Record<string, unknown>
    switch (op.tool) {
      case 'create_character':
        // As `createCharacterIn` stores it: the voice note in `notes.voice`, the bio as given.
        world.characters.push({
          id: uuid(),
          name: String(args['name']),
          cue: cueSpelling(String(args['name'])),
          bio: typeof args['bio'] === 'string' ? args['bio'] : null,
          notes: typeof args['voice'] === 'string' ? { voice: args['voice'] } : {},
        })
        break
      case 'create_location':
        world.locations.push({ id: uuid(), name: String(args['name']), set: setSpelling(String(args['name'])) })
        break
      case 'propose_outline_edit': {
        const doc = world.docs.get(String(args['documentId']))
        const next = applyOutlineOps((doc?.nodes ?? []) as OutlineNode[], args['ops'] as OutlineOp[], byAgent(RUN))
        if (doc === undefined || !next.ok) throw new Error('outline would not apply')
        doc.nodes = [...next.value]
        break
      }
      case 'propose_script_edit': {
        const doc = world.docs.get(String(args['documentId']))
        if (doc === undefined) throw new Error('no script')
        // D10: the stored script's digest must be the one the batch was planned on.
        if (proposal.digest !== nodeDigest(doc.nodes)) {
          proposal.status = 'stale'
          staleOrApplied.stale += 1
          return
        }
        const next = applyScriptOps(doc.nodes as ScreenplayNode[], args['ops'] as ScriptOp[], byAgent(RUN))
        if (!next.ok) throw new Error('script would not apply')
        // Stored and read back: jsonb's key order, the reader's shape.
        doc.nodes = [...canonicalScreenplay(JSON.parse(JSON.stringify(next.value)) as ScreenplayNode[])]
        break
      }
      case 'set_story_time':
        world.applied.storyTimes.push(args)
        break
      case 'set_synopsis':
        world.applied.synopses.push(args)
        break
      case 'manage_threads':
        if (args['action'] === 'create') world.threads.push({ id: uuid(), name: String(args['name']) })
        else world.applied.sceneThreads.push(args)
        break
      default:
        throw new Error(`unexpected ${op.tool}`)
    }
  }
  proposal.status = 'applied'
}

const pendingOf = (tool: string): readonly string[] => [...world.proposals.entries()].filter(([, proposal]) => proposal.status === 'pending' && proposal.ops.some((op) => op.tool === tool)).map(([id]) => id)

const stageStatus = (stage: string): StoryStageStatus | undefined => world.stages.get(stage)?.status as StoryStageStatus | undefined

beforeEach(() => {
  world.characters = []
  world.locations = []
  world.docs = new Map()
  world.proposals = new Map()
  world.stages = new Map()
  world.messages = [{ role: 'user', body: 'Draft a script from this story:\n\nA nurse counts seven beds on a ward of six.' }]
  world.sceneIndex = []
  world.threads = []
  world.applied = { storyTimes: [], synopses: [], sceneThreads: [] }
  world.runStatus = 'running'
  world.note = null
  calls.length = 0
  staleOrApplied.stale = 0
})

describe('story_to_script, a line to a draft', () => {
  it('stops at every checkpoint, and leaves a draft whose every cue resolves after stage F', async () => {
    // A: expanded, then stopped for the writer.
    expect(await job()).toEqual({ status: 'finished' })
    expect(world.runStatus).toBe('waiting_for_user')
    expect(world.note).toBe(STORY_WAITING.expand)
    expect(stageStatus('expand')).toBe('waiting')
    expect(world.messages.at(-1)?.body).toContain('A night nurse has one shift')

    // B and C: one proposal of records, one of the outline; stopped again.
    reply()
    await job()
    expect(stageStatus('expand')).toBe('approved')
    expect(world.note).toBe(STORY_WAITING.outline)
    const [bible] = pendingOf('create_character')
    const [outline] = pendingOf('propose_outline_edit')
    expect(bible).toBeDefined()
    expect(outline).toBeDefined()
    apply(bible ?? '')
    apply(outline ?? '')
    const outlineDoc = [...world.docs.values()].find((doc) => doc.kind === 'outline')
    expect((outlineDoc?.nodes as OutlineNode[]).map((node) => node.type)).toEqual(['h1', 'beat', 'beat'])

    // D: the scene list, stopped again.
    reply()
    await job()
    expect(world.note).toBe(STORY_WAITING.scenes)

    // E: seven scenes, drafted, critiqued, in two chained batches - all proposed before the writer applies one.
    reply()
    await job()
    expect(world.note).toBe(STORY_WAITING.draft)
    const batches = pendingOf('propose_script_edit')
    expect(batches).toHaveLength(2)
    // The misspelt cue never reached a proposal: the schema refused it, the model was asked again.
    expect(calls.filter((call) => call.name === 'submit_scene')).toHaveLength(7 + 1 + 1)
    expect(calls.find((call) => call.name === 'submit_scene' && call.prompt.includes('She says what she feels.'))).toBeDefined()
    // Each draft call gets the bound slugline, the beat as outlined, the cues with their voices, and the scene before's end.
    const drafts = calls.filter((call) => call.name === 'submit_scene')
    expect(drafts[0]?.prompt).toContain('Heading: INT. HOSPITAL WARD - NIGHT')
    expect(drafts[0]?.prompt).toContain('The count: Meera counts seven where there should be six.')
    expect(drafts[0]?.prompt).toContain('MEERA - Short, exact, never says please.')
    expect(drafts[0]?.prompt).toContain('It is the first scene.')
    expect(drafts.at(-1)?.prompt).toContain('The end of the scene before:')

    // The writer applies them in order; each finds the script it was planned on.
    for (const id of batches) apply(id)
    expect(staleOrApplied.stale).toBe(0)

    // F: re-derived, measured, checked; story days, synopses and a thread proposed.
    reply()
    await job()
    expect(world.note).toBe(STORY_WAITING.finish)
    expect(world.messages.at(-1)?.body).toContain('Every cue resolves to a character.')
    const [finish] = pendingOf('set_synopsis')
    apply(finish ?? '')
    expect(world.applied.storyTimes).toHaveLength(7)
    expect(world.applied.synopses).toHaveLength(7)
    expect(world.threads.map((thread) => thread.name)).toEqual(['The seventh bed'])

    // And the scenes put on their thread - then done.
    reply()
    await job()
    expect(world.runStatus).toBe('succeeded')
    const [onThreads] = pendingOf('manage_threads')
    apply(onThreads ?? '')
    expect(world.applied.sceneThreads).toHaveLength(3)

    // The task's test: after F, no cue in the draft is unresolved.
    const script = [...world.docs.values()].find((doc) => doc.kind === 'screenplay')?.nodes as ScreenplayNode[]
    expect(script.filter((node) => node.type === 'scene')).toHaveLength(7)
    expect(unresolvedCues(script, world.characters.map((record) => record.cue))).toEqual([])
    // Every heading's set is a bound spelling.
    const sets = new Set(world.locations.map((record) => record.set))
    for (const heading of script.filter((node) => node.type === 'scene')) {
      const reading = readSlugline(heading.content.map((run) => (run.kind === 'text' ? run.text : '')).join(''))
      expect(reading.ok && sets.has(reading.value.set)).toBe(true)
    }
    // Every line the pipeline wrote carries the run (D11).
    expect(script.every((node) => node.provenance.source === 'agent' && node.provenance.runId === RUN)).toBe(true)
  })

  it('asks a stage again with the writer`s words when the reply is more than "carry on"', async () => {
    await job()
    reply('Make it a comedy.')
    await job()
    expect(world.note).toBe(STORY_WAITING.expand)
    const again = calls.filter((call) => call.name === 'submit_story')
    expect(again).toHaveLength(2)
    expect(again[1]?.prompt).toContain('Make it a comedy.')
    expect(stageStatus('bible')).toBeUndefined()
  })

  it('proposes each character with their voice note apart from the bio, and drafts from the note the record holds', async () => {
    await job()
    reply()
    await job()
    const [bible] = pendingOf('create_character')
    const meera = world.proposals.get(bible ?? '')?.ops.find((op) => op.tool === 'create_character' && (op.args as Record<string, unknown>)['name'] === 'MEERA')
    // Stage B: the voice is its own argument - `notes.voice` once applied - and the bio is the description alone.
    expect(meera?.args).toMatchObject({ name: 'MEERA', bio: 'Thirties; keeps a pencil behind one ear.', voice: 'Short, exact, never says please.' })
    expect(String((meera?.args as Record<string, unknown>)['bio'])).not.toContain('Voice')
    apply(bible ?? '')
    apply(pendingOf('propose_outline_edit')[0] ?? '')
    expect(world.characters.find((record) => record.name === 'MEERA')?.notes).toEqual({ voice: 'Short, exact, never says please.' })

    // The writer rewrites Meera's voice note and clears Ravi's before the draft.
    const record = world.characters.find((entry) => entry.name === 'MEERA')
    if (record !== undefined) record.notes = { voice: 'Clipped; counts under her breath.' }
    const ravi = world.characters.find((entry) => entry.name === 'RAVI')
    if (ravi !== undefined) ravi.notes = {}
    reply()
    await job()
    reply()
    await job()

    // Stage E: the note as the record holds it, not as stage B wrote it.
    const [first] = calls.filter((call) => call.name === 'submit_scene')
    expect(first?.prompt).toContain('MEERA - Clipped; counts under her breath.')
    expect(first?.prompt).not.toContain('Short, exact, never says please.')
    expect(first?.prompt).not.toContain('Talks around things')
  })

  it('waits for the characters and locations before drafting a word', async () => {
    await job()
    reply()
    await job()
    // The outline is applied, the bible left waiting.
    apply(pendingOf('propose_outline_edit')[0] ?? '')
    reply()
    await job()
    reply()
    await job()
    expect(world.note).toBe(STORY_WAITING.bible)
    expect(calls.filter((call) => call.name === 'submit_scene')).toHaveLength(0)
  })

  it('plans a batch again when the writer applies them out of order', async () => {
    for (let at = 0; at < 3; at += 1) {
      await job()
      if (at === 1) {
        apply(pendingOf('create_character')[0] ?? '')
        apply(pendingOf('propose_outline_edit')[0] ?? '')
      }
      reply()
    }
    await job()
    const [first, second] = pendingOf('propose_script_edit')
    // The second first: it was planned on the first, so it is stale.
    apply(second ?? '')
    expect(staleOrApplied.stale).toBe(1)
    apply(first ?? '')
    reply()
    await job()
    // Planned again on the script as it is, and waiting.
    const [replanned] = pendingOf('propose_script_edit')
    expect(replanned).toBeDefined()
    expect(replanned).not.toBe(second)
    apply(replanned ?? '')
    expect(staleOrApplied.stale).toBe(1)
    reply()
    await job()
    expect(world.note).toBe(STORY_WAITING.finish)
  })
})

describe('notesOf', () => {
  it('reads an empty reply or "Carry on." as approval, and anything else as the writer`s notes, without the code-written note', () => {
    expect(notesOf('Carry on.')).toBeNull()
    expect(notesOf('[Folio: since the run paused, "Rename ARJUN" was applied.]\n\nCarry on.')).toBeNull()
    expect(notesOf('[Folio: since the run paused, x.]\n\nMake Ravi older.')).toBe('Make Ravi older.')
  })
})
