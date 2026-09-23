import type {
  AgentAutonomy,
  AgentProposalId,
  AgentProposalStatus,
  AssistantChatId,
  DraftBatch,
  DraftLine,
  Episode,
  StoryBible,
  StoryBrief,
  StoryOutline,
  StorySceneList,
  StoryStage,
  StoryToScriptInput,
} from '@folio/contracts'
import {
  CRITIC_THRESHOLD,
  CritiqueSchema,
  STORY_THREAD_COLOURS,
  StageOutputSchemas,
  StoryBibleSchema,
  StoryBriefSchema,
  StoryOutlineSchema,
  StoryTimeProposalSchema,
  draftSceneSchema,
  sceneListSchema,
} from '@folio/contracts'
import type { JobOutcome, ProjectScope } from '@folio/db'
import {
  addAgentRunTokens,
  createDocument,
  listBoundCues,
  listBoundSluglines,
  listCharacterRecords,
  listCharacterVoices,
  listEpisodes,
  listLocationRecords,
  listMessages,
  listSceneIndex,
  listStoryThreads,
  mintNodeIds,
  readAgentRun,
  readDocumentByKind,
  readMentionLabels,
  readProposal,
  readProposalOpByKey,
  readRunStages,
  saveRunStage,
  setRunStageStatus,
} from '@folio/db'
import type { BoundSpellings, DocumentId, NodeId, RunId, ScreenplayNode, ScriptOp } from '@folio/script'
import { boundSpellingFor, cueSpelling, setSpelling, unresolvedCues } from '@folio/script'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

import { formatSceneRef, sceneRefOf } from '../../characters/figures'
import type { EpisodeGate, GateRefusal } from '../../script/actor-gate'
import { isRefusal } from '../../script/actor-gate'
import { readPageCount } from '../../script/page-count'
import { rederiveProject, runDetached } from '../../script/server'
import { readContinuity } from '../../timeline/server'
import { rejectProposalWith } from '../apply'
import { readDocumentState } from '../documents'
import { describeEdit } from '../document-ops'
import type { ModelClient, ProposalSink } from '../loop'
import { proposalSink } from '../proposer'
import type { ProposedOp } from '../registry'
import { DEFAULT_REPLY } from '../runs'
import { PIPELINE_SYSTEM, biblePrompt, briefText, critiquePrompt, draftPrompt, expandPrompt, outlinePrompt, rewritePrompt, sceneListText, scenesPrompt, timePrompt } from './prompts'
import type { SceneBrief } from './prompts'
import type { Spend, Structured } from './structured'
import { structured } from './structured'
import { BATCH_SIZE, bibleOps, holdScene, nodesOf, outlineBlockCount, outlineOp, planBatch, projectBatch, sceneLines } from './script'

/**
 * The story-to-script pipeline - roadmap task 4.5, ADR 0003 D4/D5.
 *
 * `story_to_script` starts a background run whose input is the writer's story
 * (`StoryToScriptInput`); the worker calls this for each of its jobs. A job
 * reads the stages stored so far (`agent_run_stages`, `0038`), carries on from
 * the one it reached, and stops for the writer where the plan says to:
 *
 *   A  expand the story                        → checkpoint
 *   B  the characters and locations, one proposal
 *   C  the outline, one proposal                → checkpoint
 *   D  the scene list                           → checkpoint
 *   E  every scene drafted, critiqued, and proposed in chained batches of
 *      about five → waits until the writer has applied (or rejected) every
 *      batch (ruled 2026-09-23: F runs on the stored script)
 *   F  re-derived once, measured, checked; story days, synopses and threads
 *      proposed → once applied, the scenes put on their threads
 *
 * At a checkpoint the writer's reply decides: an empty one (`Carry on.`)
 * approves the stage; words send it back to the model with them, and it stops
 * there again. Every stage's output is parsed with its contract before it is
 * stored, so a stage resumes on its own: a crash, a shutdown or a pause picks
 * up at the stage it reached, and a batch already proposed is found by its
 * idempotency key rather than drafted twice.
 *
 * Every write is a proposal, through the same sink a turn uses - under `auto`
 * a records-only one (the bible) applies at once, a script or outline one never
 * does on the worker. Two writes are not: an episode with no script or no
 * outline gets an empty document to propose into, as the Script and Outline
 * routes' own first save makes one.
 */

export type StoryJob = {
  readonly scope: ProjectScope
  readonly runId: RunId
  readonly chatId: AssistantChatId
  readonly episode: Episode
  /** The run's gate re-opened as its starter (ADR 0003 D4) - before every stage and every scene. */
  readonly open: () => Promise<EpisodeGate | GateRefusal>
  readonly client: ModelClient
  readonly signal: AbortSignal
  readonly autonomy: AgentAutonomy
  /** Tokens left of today's allowance when the job began. */
  readonly tokenBudget: number
  /** Post a message to the run's chat, as the assistant. */
  readonly say: (body: string) => Promise<void>
  readonly settle: (status: 'succeeded' | 'failed' | 'waiting_for_user' | 'cancelled', message: string | null) => Promise<JobOutcome>
}

/** What the run card says while the run waits on the writer at each stop. */
export const STORY_WAITING: Readonly<Record<'expand' | 'outline' | 'scenes' | 'bible' | 'draft' | 'finish', string>> = {
  expand: 'Waiting for you to read the story as I expanded it.',
  outline: 'Waiting for you to review the characters, locations and outline.',
  scenes: 'Waiting for you to review the scene list.',
  bible: 'Waiting for you to apply the characters and locations - the draft binds to them.',
  draft: 'Waiting for you to apply the scene batches.',
  finish: 'Waiting for you to apply the story days, synopses and threads.',
}

/** A stop the pipeline cannot go past: failed, cancelled, out of tokens - already settled. */
class Halt extends Error {
  constructor(readonly outcome: JobOutcome) {
    super('halt')
  }
}

/** The writer's words in a reply, the code-written note before them taken off; null for a plain "carry on". */
export const notesOf = (body: string): string | null => {
  const words = body.replace(/^\[Folio:[^\]]*\]\s*/u, '').trim()
  return words.length === 0 || words === DEFAULT_REPLY ? null : words
}

const settled = (status: AgentProposalStatus): boolean => status !== 'pending'

const landed = (status: AgentProposalStatus): boolean => status === 'applied' || status === 'partially_applied'

export const runStoryJob = async (job: StoryJob, input: StoryToScriptInput): Promise<JobOutcome> => {
  const { scope, runId, client, signal } = job
  let used = 0
  const spend: Spend = {
    record: async (tokensIn, tokensOut) => {
      used += tokensIn + tokensOut
      await addAgentRunTokens(scope, runId, tokensIn, tokensOut)
    },
    left: () => job.tokenBudget - used,
  }

  /** Before a stage or a scene: still running, and still the starter's to run (D4). */
  const step = async (): Promise<EpisodeGate> => {
    const now = await readAgentRun(scope, runId)
    if (now === null || now.status !== 'running') throw new Halt({ status: 'cancelled' })
    const gate = await job.open()
    if (isRefusal(gate)) throw new Halt(await job.settle('failed', gate.message))
    return gate
  }

  const answer = async <T>(result: Structured<T>): Promise<T> => {
    if (result.ok) return result.value
    if (result.reason === 'token_cap') throw new Halt(await job.settle('waiting_for_user', result.message))
    throw new Halt(await job.settle('failed', result.message))
  }

  const ask = async <T>(name: string, description: string, schema: z.ZodType<T>, prompt: string): Promise<T> =>
    answer(await structured(client, signal, spend, { name, description, schema, system: PIPELINE_SYSTEM, prompt }))

  const sink = (gate: EpisodeGate): ProposalSink => proposalSink(gate, runId, job.autonomy, runDetached)

  /** One proposal from these operations, keyed so a replayed job finds it again. */
  const propose = async (gate: EpisodeGate, key: string, ops: readonly ProposedOp[]): Promise<AgentProposalId> => {
    const [made] = await sink(gate).create([{ ops: ops.map((op, index) => ({ key: `${key}:${String(index)}`, op })) }])
    if (made === undefined) throw new Error('Folio: the proposal was not written.')
    return made.proposalId as AgentProposalId
  }

  const pause = async (stage: StoryStage, output: unknown, message: string, waiting: string): Promise<JobOutcome> => {
    await saveRunStage(scope, runId, stage, 'waiting', output)
    await job.say(message)
    return job.settle('waiting_for_user', waiting)
  }

  const stages = await readRunStages(scope, runId)
  const stored = <S extends StoryStage>(stage: S): { readonly status: string; readonly output: z.infer<(typeof StageOutputSchemas)[S]> } | null => {
    const row = stages.get(stage)
    if (row === undefined) return null
    const parsed = StageOutputSchemas[stage].safeParse(row.output)
    return parsed.success ? { status: row.status, output: parsed.data as z.infer<(typeof StageOutputSchemas)[S]> } : null
  }
  // The writer's reply, when this job continues from a checkpoint: the chat's last user message.
  const reply = async (): Promise<string | null> => {
    const messages = await listMessages(scope, job.chatId)
    const last = [...messages].reverse().find((message) => message.role === 'user' && message.body.trim().length > 0)
    return last === undefined ? null : notesOf(last.body)
  }

  try {
    // ------------------------------------------------------------------ A
    let gate = await step()
    let brief: StoryBrief
    const a = stored('expand')
    if (a === null || a.status === 'waiting') {
      const notes = a === null ? null : await reply()
      if (a !== null && notes === null) {
        await setRunStageStatus(scope, runId, 'expand', 'approved')
        brief = a.output.brief
      } else {
        brief = await ask('submit_story', 'The story, expanded.', StoryBriefSchema, expandPrompt(input.story, gate.project, notes, a === null ? null : briefText(a.output.brief)))
        return await pause('expand', { brief }, `Here is the story as I read it.\n\n${briefText(brief)}\n\nReply with anything to change, or leave it empty to carry on to the characters and the outline.`, STORY_WAITING.expand)
      }
    } else brief = a.output.brief

    // ------------------------------------------------------------------ B
    let bible: StoryBible
    let bibleProposal: AgentProposalId | null
    const b = stored('bible')
    if (b === null) {
      gate = await step()
      bible = await ask('submit_bible', 'The characters and locations.', StoryBibleSchema, biblePrompt(brief, null, null))
      bibleProposal = await proposeBible(gate, bible, `story:${runId}:bible`)
      await saveRunStage(scope, runId, 'bible', 'ready', { bible, proposalId: bibleProposal })
    } else {
      bible = b.output.bible
      bibleProposal = b.output.proposalId as AgentProposalId | null
    }

    // ------------------------------------------------------------------ C
    let outline: StoryOutline
    const c = stored('outline')
    if (c === null || c.status === 'waiting') {
      const notes = c === null ? null : await reply()
      if (c !== null && notes === null) {
        await setRunStageStatus(scope, runId, 'outline', 'approved')
        outline = c.output.outline
      } else {
        gate = await step()
        outline = await ask('submit_outline', 'The outline: acts and their beats.', StoryOutlineSchema, outlinePrompt(brief, bible, notes, c === null ? null : JSON.stringify(c.output.outline)))
        // A revised outline replaces the one still waiting for review.
        if (c?.output.proposalId != null) await withdraw(gate, c.output.proposalId as AgentProposalId)
        const proposalId = await proposeOutline(gate, outline, `story:${runId}:outline:after:${c?.output.proposalId ?? 'none'}`)
        const beats = outline.acts.reduce((total, act) => total + act.beats.length, 0)
        return await pause(
          'outline',
          { outline, proposalId },
          `I proposed ${String(bible.characters.length)} characters and ${String(bible.locations.length)} locations, and an outline of ${String(outline.acts.length)} ${outline.acts.length === 1 ? 'act' : 'acts'} and ${String(beats)} beats. Apply the characters and locations before the draft - its cues and headings bind to them. Reply with changes to the outline, or leave it empty to carry on to the scene list.`,
          STORY_WAITING.outline,
        )
      }
    } else outline = c.output.outline

    // ------------------------------------------------------------------ D
    let list: StorySceneList
    const d = stored('scenes')
    if (d === null || d.status === 'waiting') {
      const notes = d === null ? null : await reply()
      if (d !== null && notes === null) {
        await setRunStageStatus(scope, runId, 'scenes', 'approved')
        list = d.output.list
      } else {
        gate = await step()
        const places = nonEmpty(bible.locations.map((place) => place.name))
        const people = nonEmpty(bible.characters.map((person) => person.name))
        list = await ask(
          'submit_scenes',
          'The scene list.',
          sceneListSchema(places, people),
          scenesPrompt(brief, bible, outline, notes, d === null ? null : sceneListText(d.output.list)),
        )
        return await pause('scenes', { list }, `The scene list, ${String(list.scenes.length)} scenes:\n\n${sceneListText(list)}\n\nReply with changes, or leave it empty and I'll draft them.`, STORY_WAITING.scenes)
      }
    } else list = d.output.list

    // ------------------------------------------------------------------ E
    const e = stored('draft')
    if (e?.status !== 'approved') {
      const drafted = await draftStage(gate, brief, bible, outline, list, bibleProposal, e?.output ?? null)
      if (drafted !== null) return drafted
    }

    // ------------------------------------------------------------------ F
    return await finishStage(list)
  } catch (cause) {
    if (cause instanceof Halt) return cause.outcome
    if (cause instanceof Anthropic.APIUserAbortError || signal.aborted) {
      // A shutdown or a lost lease writes nothing; the next claim resumes at the stage reached.
      if (signal.reason !== 'cancel') return { status: 'failed', error: 'Stopped by the worker.' }
      return job.settle('cancelled', null)
    }
    if (cause instanceof Anthropic.APIError && !(cause instanceof Anthropic.APIConnectionError) && cause.status !== 429 && (cause.status ?? 0) < 500) {
      return job.settle('failed', `The model could not answer (${String(cause.status)}).`)
    }
    // A transient error, or the database's: thrown, so the runtime retries the job.
    throw cause
  }

  // ==================================================================== B, C

  /** The bible's records as one proposal. `key` is deterministic, so a replayed job finds the one it made. */
  async function proposeBible(gate: EpisodeGate, bible: StoryBible, key: string): Promise<AgentProposalId | null> {
    const [characters, locations] = await Promise.all([listCharacterRecords(scope), listLocationRecords(scope)])
    const ops = bibleOps(bible, { characters: characters.map((record) => record.name), locations: locations.map((record) => record.name) })
    const proposed: ProposedOp[] = [
      ...ops.characters.map((args) => ({ tool: 'create_character', args, mode: 'propose' as const, description: `Create the character ${args.name}` })),
      ...ops.locations.map((args) => ({ tool: 'create_location', args, mode: 'propose' as const, description: `Create the location ${args.name}` })),
    ]
    // Everyone already exists: nothing to propose.
    if (proposed.length === 0) return null
    return propose(gate, key, proposed)
  }

  async function withdraw(gate: EpisodeGate, proposalId: AgentProposalId): Promise<void> {
    const read = await readProposal(scope, proposalId)
    if (read !== null && read.proposal.status === 'pending') await rejectProposalWith(gate, proposalId)
  }

  async function documentOf(kind: 'screenplay' | 'outline'): Promise<DocumentId> {
    const existing = await readDocumentByKind(scope, job.episode.id, kind)
    if (existing !== null) return existing.id
    return (await createDocument(scope, job.episode.id, kind, job.episode.title)).id
  }

  async function proposeOutline(gate: EpisodeGate, outline: StoryOutline, key: string): Promise<AgentProposalId> {
    const documentId = await documentOf('outline')
    const state = await readDocumentState(scope, documentId)
    if (state === null || state.kind !== 'outline') throw new Halt(await job.settle('failed', 'The outline would not read.'))
    const ids = (await mintNodeIds(scope, outlineBlockCount(outline))) as readonly NodeId[]
    const last = state.nodes.at(-1)
    const op = outlineOp(outline, last === undefined ? 'start' : last.id, ids)
    return propose(gate, key, [
      {
        tool: 'propose_outline_edit',
        args: { documentId, episodeId: job.episode.id, ops: [op] },
        mode: 'propose',
        description: describeEdit('Outline', [op], 'block'),
        base: { documentId, kind: 'outline', episodeId: job.episode.id, digest: state.digest },
      },
    ])
  }

  // ==================================================================== E

  /** Draft and propose every scene not yet proposed; null once every batch is applied or rejected. */
  async function draftStage(
    start: EpisodeGate,
    brief: StoryBrief,
    bible: StoryBible,
    outline: StoryOutline,
    list: StorySceneList,
    bibleProposal: AgentProposalId | null,
    previous: { readonly batches: readonly DraftBatch[]; readonly tail: readonly DraftLine[] } | null,
  ): Promise<JobOutcome | null> {
    let gate = start
    const batches: DraftBatch[] = [...(previous?.batches ?? [])]
    let tail: readonly DraftLine[] = previous?.tail ?? []

    // The draft binds to the bible's records: they must exist first.
    if (bibleProposal !== null) {
      const read = await readProposal(scope, bibleProposal)
      const status = read?.proposal.status ?? 'failed'
      if (status === 'pending') return pause('draft', { batches, tail }, 'The characters and locations are still waiting for you. Apply them, then carry on - the draft binds its cues and headings to them.', STORY_WAITING.bible)
      if (!landed(status)) {
        // Rejected or failed: offered once more, as what is still missing.
        const again = await proposeBible(gate, bible, `story:${runId}:bible:after:${bibleProposal}`)
        await saveRunStage(scope, runId, 'bible', 'ready', { bible, proposalId: again })
        if (again !== null) return pause('draft', { batches, tail }, 'The characters and locations were not applied, and the draft needs them. They are proposed again: apply them, then carry on.', STORY_WAITING.bible)
      }
    }

    const spellings = await readSpellings()
    const documentId = await documentOf('screenplay')
    const document = { documentId, episodeId: job.episode.id }
    const state = await readDocumentState(scope, documentId)
    if (state === null || state.kind !== 'screenplay') throw new Halt(await job.settle('failed', 'The script would not read.'))

    // The script as the batches still waiting will leave it.
    let projected: readonly ScreenplayNode[] = state.nodes
    for (const batch of batches) {
      const read = await readProposal(scope, batch.proposalId as AgentProposalId)
      if (read === null || read.proposal.status !== 'pending') continue
      const ops = read.ops.flatMap((op) => (op.tool === 'propose_script_edit' ? (z.object({ ops: z.array(z.unknown()) }).safeParse(op.args).data?.ops ?? []) : [])) as readonly ScriptOp[]
      projected = projectBatch(projected, ops, runId) ?? projected
    }

    let next = batches.length === 0 ? 0 : (batches.at(-1)?.to ?? -1) + 1
    while (next < list.scenes.length) {
      const index = batches.length
      const from = next
      const to = Math.min(list.scenes.length, from + BATCH_SIZE) - 1
      const key = `story:${runId}:batch:${String(index)}`
      // Proposed by a job that died before it was recorded: found, not drafted again.
      const found = await readProposalOpByKey(scope, `${key}:0`)
      if (found !== null) {
        const nodes = z.object({ ops: z.array(z.object({ nodes: z.array(z.object({ id: z.string(), type: z.string() })).optional() })) }).safeParse(found.args).data?.ops[0]?.nodes ?? []
        const last = nodes.at(-1)
        if (last === undefined) throw new Halt(await job.settle('failed', 'A proposed batch would not read.'))
        batches.push({ from, to, proposalId: found.proposalId, lastNodeId: last.id, headings: nodes.filter((node) => node.type === 'scene').map((node) => node.id) })
        await saveRunStage(scope, runId, 'draft', 'ready', { batches, tail })
        next = to + 1
        continue
      }

      const nodes: ScreenplayNode[] = []
      for (let at = from; at <= to; at += 1) {
        gate = await step()
        const scene = list.scenes[at]
        if (scene === undefined) break
        const set = spellings.setOf(scene.location)
        const lines = await draftScene(brief, bible, outline, list, at, set, spellings, tail)
        const drafted = sceneLines(scene, set, lines)
        const ids = (await mintNodeIds(scope, drafted.length)) as readonly NodeId[]
        const held = holdScene(nodesOf(drafted, ids, runId), spellings.bound)
        if (!held.ok) {
          const what = held.rejected.map((issue) => issue.found).join(', ')
          throw new Halt(await job.settle('failed', `Scene ${String(at + 1)} names what the project has no record of (${what}). Apply the characters and locations, or add them, and try again.`))
        }
        nodes.push(...held.nodes)
        tail = lines.slice(-6)
      }
      const planned = planBatch(document, projected, nodes, runId)
      if (!planned.ok) throw new Halt(await job.settle('failed', planned.message))
      const label = from === to ? `Scene ${String(from + 1)}` : `Scenes ${String(from + 1)}-${String(to + 1)}`
      const proposalId = await propose(gate, key, [
        {
          tool: 'propose_script_edit',
          args: { documentId, episodeId: job.episode.id, ops: [planned.op] },
          mode: 'propose',
          description: `${label}: ${describeEdit('Script', [planned.op], 'line')}`,
          base: planned.base,
        },
      ])
      const lastNode = nodes.at(-1)
      if (lastNode === undefined) throw new Halt(await job.settle('failed', 'A batch drafted no lines.'))
      batches.push({ from, to, proposalId, lastNodeId: lastNode.id, headings: nodes.filter((node) => node.type === 'scene').map((node) => node.id) })
      await saveRunStage(scope, runId, 'draft', 'ready', { batches, tail })
      await job.say(`${label} ${from === to ? 'is' : 'are'} drafted and proposed.`)
      projected = planned.projected
      next = to + 1
    }

    // Every scene is proposed. Wait until each batch is applied or rejected; plan again any gone stale.
    const pending: number[] = []
    for (const [index, batch] of batches.entries()) {
      const read = await readProposal(scope, batch.proposalId as AgentProposalId)
      const status = read?.proposal.status ?? 'failed'
      if (status === 'pending') {
        pending.push(index)
        continue
      }
      if (status !== 'stale' && status !== 'failed') continue
      // Planned on a script that has moved: once the batches before it are settled, planned again on the script as it is.
      const earlier = await Promise.all(batches.slice(0, index).map(async (entry) => (await readProposal(scope, entry.proposalId as AgentProposalId))?.proposal.status ?? 'failed'))
      if (!earlier.every(settled) || read === null) {
        pending.push(index)
        continue
      }
      const now = await readDocumentState(scope, documentId)
      if (now === null || now.kind !== 'screenplay') throw new Halt(await job.settle('failed', 'The script would not read.'))
      const ops = read.ops.flatMap((op) => (op.tool === 'propose_script_edit' ? (z.object({ ops: z.array(z.unknown()) }).safeParse(op.args).data?.ops ?? []) : [])) as readonly ScriptOp[]
      const insert = ops.find((op) => op.op === 'insert_after')
      if (insert?.op !== 'insert_after') continue
      const again = planBatch(document, now.nodes, insert.nodes.map((node) => ({ ...node, provenance: { source: 'agent' as const, runId } }) as ScreenplayNode), runId)
      if (!again.ok) continue
      gate = await step()
      const proposalId = await propose(gate, `story:${runId}:batch:${String(index)}:after:${batch.proposalId}`, [
        { tool: 'propose_script_edit', args: { documentId, episodeId: job.episode.id, ops: [again.op] }, mode: 'propose', description: `Scenes ${String(batch.from + 1)}-${String(batch.to + 1)}, planned again: ${describeEdit('Script', [again.op], 'line')}`, base: again.base },
      ])
      batches[index] = { ...batch, proposalId }
      pending.push(index)
    }
    await saveRunStage(scope, runId, 'draft', pending.length === 0 ? 'approved' : 'waiting', { batches, tail })
    if (pending.length === 0) return null
    return pause(
      'draft',
      { batches, tail },
      `All ${String(list.scenes.length)} scenes are proposed, in ${String(batches.length)} ${batches.length === 1 ? 'batch' : 'batches'}. ${String(pending.length)} still ${pending.length === 1 ? 'waits' : 'wait'} for you: apply them in order - each is planned on the one before - then carry on for the story days and threads.`,
      STORY_WAITING.draft,
    )
  }

  /** One scene: drafted, critiqued against the craft rules, rewritten once if any score is low. */
  async function draftScene(
    brief: StoryBrief,
    bible: StoryBible,
    outline: StoryOutline,
    list: StorySceneList,
    at: number,
    set: string,
    spellings: Spellings,
    previous: readonly DraftLine[],
  ): Promise<readonly DraftLine[]> {
    const scene = list.scenes[at]
    if (scene === undefined) return []
    // The voice note as the record holds it (`characters.notes.voice`), not as stage B wrote it: the writer may have edited it since.
    const voices = bible.characters.flatMap((person) => {
      const cue = spellings.cueOf(person.name)
      return cue === null ? [] : [{ cue, voice: spellings.voiceOf(person.name) }]
    })
    const cues = nonEmpty(voices.length === 0 ? spellings.bound.cues : voices.map((voice) => voice.cue))
    // The beat as the outline wrote it - its title and what happens in it.
    const beats = outline.acts.flatMap((act) => act.beats)
    const played = beats.find((entry) => entry.title.trim().toUpperCase() === scene.beat.trim().toUpperCase())
    const beat = played === undefined ? scene.beat : `${played.title}: ${played.summary}`
    const sceneBrief: SceneBrief = { number: at + 1, total: list.scenes.length, scene, set, beat, voices, previous, brief }
    const schema = draftSceneSchema(cues)
    const first = await ask('submit_scene', 'One scene, as lines.', schema, draftPrompt(sceneBrief))
    const critique = await ask('submit_critique', 'Scores against the craft rules.', CritiqueSchema, critiquePrompt(sceneBrief, first.lines))
    const low = critique.scores.filter((score) => score.score < CRITIC_THRESHOLD)
    if (low.length === 0) return first.lines
    const rewritten = await ask('submit_scene', 'One scene, as lines.', schema, rewritePrompt(sceneBrief, first.lines, low.map((score) => `Rule ${String(score.rule)}: ${score.note}`)))
    return rewritten.lines
  }

  // ==================================================================== F

  async function finishStage(list: StorySceneList): Promise<JobOutcome> {
    const fresh = await readRunStages(scope, runId)
    const draft = StageOutputSchemas.draft.safeParse(fresh.get('draft')?.output).data ?? null
    const finishRow = fresh.get('finish')
    const finishParsed = StageOutputSchemas.finish.safeParse(finishRow?.output)
    const f = finishRow === undefined || !finishParsed.success ? null : { status: finishRow.status, output: finishParsed.data }
    const gate = await step()

    if (f === null) {
      // Re-derived once, so the scene index knows the drafted headings.
      await rederiveProject(scope)
      const rows = (await listSceneIndex(scope)).filter((row) => row.episode === job.episode.slug)
      const byId = new Map(rows.map((row) => [row.sceneNodeId as string, row]))
      const landedScenes: { readonly number: number; readonly sceneId: string; readonly ref: string }[] = []
      for (const batch of draft?.batches ?? []) {
        for (const [offset, heading] of batch.headings.entries()) {
          const row = byId.get(heading)
          if (row !== undefined) landedScenes.push({ number: batch.from + offset + 1, sceneId: heading, ref: formatSceneRef(sceneRefOf(row)) })
        }
      }
      if (landedScenes.length === 0) {
        await job.say('None of the drafted scenes were applied, so there is nothing to place in story time. The run is done.')
        return job.settle('succeeded', null)
      }
      const [pages, continuity, bound, nodes] = await Promise.all([
        readPageCount(scope, gate.project, job.episode),
        readContinuity({ scope, project: gate.project, episodes: await listEpisodes(scope) }),
        listBoundCues(scope),
        scriptNodes(),
      ])
      const unresolved = unresolvedCues(nodes, bound.map((entry) => entry.cue))
      const time = await ask('submit_story_time', 'Story days and threads.', StoryTimeProposalSchema, timePrompt({ scenes: landedScenes.map((entry) => list.scenes[entry.number - 1]).filter((scene) => scene !== undefined) }))
      const sceneOf = new Map(landedScenes.map((entry, index) => [index + 1, entry]))
      const ops: ProposedOp[] = [
        ...time.days.flatMap((day): ProposedOp[] => {
          const scene = sceneOf.get(day.scene)
          return scene === undefined ? [] : [{ tool: 'set_story_time', args: { sceneId: scene.sceneId, ref: scene.ref, day: day.day, clock: null, flashback: day.flashback }, mode: 'propose', description: `Place ${scene.ref} on day ${String(day.day)}` }]
        }),
        ...landedScenes.flatMap((scene): ProposedOp[] => {
          const synopsis = list.scenes[scene.number - 1]?.synopsis
          return synopsis === undefined ? [] : [{ tool: 'set_synopsis', args: { sceneId: scene.sceneId, synopsis, ref: scene.ref, episode: job.episode.ordinal }, mode: 'propose', description: `Set the synopsis of ${scene.ref}` }]
        }),
        ...time.threads.map((thread, index): ProposedOp => ({
          tool: 'manage_threads',
          args: { action: 'create', name: thread.name, colour: STORY_THREAD_COLOURS[index % STORY_THREAD_COLOURS.length], label: thread.name },
          mode: 'propose',
          description: `Create the thread ${thread.name}`,
        })),
      ]
      const threads = time.threads.map((thread) => ({ name: thread.name, scenes: thread.scenes.flatMap((number) => sceneOf.get(number)?.sceneId ?? []) }))
      const proposalId = ops.length === 0 ? null : await propose(gate, `story:${runId}:finish`, ops)
      const open = continuity.continuity.buckets.open.length
      const pageLine = pages.status === 'ok' ? `The draft is ${String(pages.count.pages)} ${pages.count.pages === 1 ? 'page' : 'pages'}.` : pages.message
      const cueLine = unresolved.length === 0 ? 'Every cue resolves to a character.' : `${String(unresolved.length)} ${unresolved.length === 1 ? 'cue does' : 'cues do'} not resolve: ${unresolved.join(', ')}.`
      const findingLine = `The continuity check has ${String(open)} open ${open === 1 ? 'finding' : 'findings'}.`
      await saveRunStage(scope, runId, 'finish', 'waiting', { proposalId, threads, threadsProposalId: null })
      await job.say(
        `${pageLine} ${cueLine} ${findingLine}\n\nI proposed story days for ${String(time.days.length)} ${time.days.length === 1 ? 'scene' : 'scenes'}, synopses for ${String(landedScenes.length)}, and ${String(time.threads.length)} ${time.threads.length === 1 ? 'thread' : 'threads'}. Apply them and carry on, and I will put the scenes on their threads.`,
      )
      return job.settle('waiting_for_user', STORY_WAITING.finish)
    }

    if (f.status === 'approved') return job.settle('succeeded', null)
    const read = f.output.proposalId === null ? null : await readProposal(scope, f.output.proposalId as AgentProposalId)
    if (read !== null && read.proposal.status === 'pending') {
      await job.say('The story days, synopses and threads are still waiting for you. Apply them, then carry on.')
      return job.settle('waiting_for_user', STORY_WAITING.finish)
    }
    // The threads exist now if their creation was applied: put the scenes on them.
    const made = new Map((await listStoryThreads(scope)).map((thread) => [thread.name.trim().toUpperCase(), thread.id as string]))
    const rows = (await listSceneIndex(scope)).filter((row) => row.episode === job.episode.slug)
    const refOf = new Map(rows.map((row) => [row.sceneNodeId as string, formatSceneRef(sceneRefOf(row))]))
    const onScene = new Map<string, string[]>()
    for (const thread of f.output.threads) {
      const id = made.get(thread.name.trim().toUpperCase())
      if (id === undefined) continue
      for (const scene of thread.scenes) onScene.set(scene, [...(onScene.get(scene) ?? []), id])
    }
    const ops: ProposedOp[] = [...onScene.entries()].flatMap(([sceneId, threadIds]): ProposedOp[] => {
      const ref = refOf.get(sceneId)
      return ref === undefined ? [] : [{ tool: 'manage_threads', args: { action: 'set_scene', sceneId, threadIds, label: ref }, mode: 'propose', description: `Put ${ref} on ${String(threadIds.length)} ${threadIds.length === 1 ? 'thread' : 'threads'}` }]
    })
    const threadsProposalId = ops.length === 0 ? null : await propose(gate, `story:${runId}:threads`, ops)
    await saveRunStage(scope, runId, 'finish', 'approved', { ...f.output, threadsProposalId })
    await job.say(ops.length === 0 ? 'The draft is done.' : `I proposed putting ${String(ops.length)} ${ops.length === 1 ? 'scene' : 'scenes'} on their threads. The draft is done.`)
    return job.settle('succeeded', null)
  }

  async function scriptNodes(): Promise<readonly ScreenplayNode[]> {
    const document = await readDocumentByKind(scope, job.episode.id, 'screenplay')
    if (document === null) return []
    const state = await readDocumentState(scope, document.id)
    return state !== null && state.kind === 'screenplay' ? state.nodes : []
  }

  // ==================================================================== spellings

  /** The bound spellings the draft is held to, and the cue or set a bible name is written as. */
  async function readSpellings(): Promise<Spellings> {
    const [cues, sluglines, labels, records, voices] = await Promise.all([
      listBoundCues(scope),
      listBoundSluglines(scope),
      readMentionLabels(scope),
      listLocationRecords(scope),
      listCharacterVoices(scope),
    ])
    const bound: BoundSpellings = {
      cues: cues.map((entry) => entry.cue),
      sets: sluglines.map((entry) => entry.slugline),
      records: new Set(labels.map((label) => `${label.entity}:${label.id as string}`)),
    }
    return {
      bound,
      cueOf: (name) => boundSpellingFor(cueSpelling(name), bound.cues),
      voiceOf: (name) => voices.find((entry) => entry.name.trim().toUpperCase() === name.trim().toUpperCase())?.voice ?? null,
      setOf: (name) => {
        // The location's own bound set, else the nearest bound spelling, else its name as a heading spells it.
        const record = records.find((entry) => entry.name.trim().toUpperCase() === name.trim().toUpperCase())
        const own = record === undefined ? undefined : sluglines.find((entry) => entry.locationId === record.id)?.slugline
        return own ?? boundSpellingFor(setSpelling(name), bound.sets) ?? setSpelling(name)
      },
    }
  }

}

type Spellings = {
  readonly bound: BoundSpellings
  /** The bound cue a bible name is written as, or null when it has none. */
  readonly cueOf: (name: string) => string | null
  /** A bible character's voice note, read from their record's `notes.voice`; null when the record has none. */
  readonly voiceOf: (name: string) => string | null
  /** The set a bible location is written as in a heading. */
  readonly setOf: (name: string) => string
}

/** A list the schema builders take - never empty; a stand-in when it would be. */
const nonEmpty = (names: readonly string[]): readonly [string, ...string[]] => {
  const unique = [...new Set(names)]
  const first = unique[0]
  return first === undefined ? ['NARRATOR'] : [first, ...unique.slice(1)]
}

