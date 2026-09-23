import type { AgentEvent, AgentRunStatus, AgentStopReason, AskFocus, AssistantChatId, SceneRef } from '@folio/contracts'
import { AskInputSchema } from '@folio/contracts'
import {
  addAgentRunTokens,
  appendMessage,
  createAgentRun,
  finishAgentRun,
  listBoundCues,
  listBoundSluglines,
  listCharacterRecords,
  listEpisodes,
  listLocationRecords,
  listMessages,
  listSceneIndex,
  readChat,
  readDocumentByKind,
  readMentionLabels,
  readProjectScreenplayByEpisode,
  readScreenplayNodes,
  startAgentRun,
  tokensTodayFor,
  transactionDatabase,
} from '@folio/db'
import type { CharacterRecordRow, LocationRecordRow, ProjectScope, SceneIndexRow } from '@folio/db'
import { assistantEnv } from '@folio/db/env'
import type { RunId, ScreenplayNode } from '@folio/script'
import { establishingLines, formatStoryTime, quadrantOf } from '@folio/script'
import Anthropic from '@anthropic-ai/sdk'

import { formatSceneRef, sceneRefOf } from '../characters/figures'
import { dayNightShort, quadrantLabel } from '../locations/view'
import type { EpisodeGate } from '../script/gate'
import { DAILY_TOKENS_PER_USER } from '../agent/limits'
import { runAgentLoop } from '../agent/loop'
import type { ModelClient } from '../agent/loop'
import { checkRateLimit } from '../agent/rate-limit'
import { replayOf } from '../agent/replay'
import '../agent/tools'
import { ROLE } from '../auth/roles'
import { isRefusal, openEpisodeWith } from '../script/gate'
import { readContinuity } from '../timeline/server'
import { findingNote, findingsAbout, previousFrameScene, sceneRef } from '../timeline/view'
import type { FocusInput, LocationFocusInput, PlaceInput, SceneFocusInput, ScriptInput, StoryTimeInput } from './context'
import { buildContext } from './context'
import { ASSISTANT_MODEL, MAX_OUTPUT_TOKENS } from './model'

/**
 * Asking the assistant. Server only - this file holds the API key's reader.
 *
 * `assistantConnected()` is what the shell tells the panel: unset key, no
 * composer. `assistantClient()` is the one door to the SDK (the Characters
 * drawer's model actions were its second caller until the fourth pass,
 * 2026-09-20); the key itself never leaves here. `ask()` is the streaming path
 * `app/api/assistant/route.ts` exposes: gate, limits, read the script beside
 * the gate, then run the agent loop (`lib/agent/loop.ts`, roadmap task 2.3)
 * inside a newline-delimited JSON stream of `AgentEvent`s (ADR 0003 **D7**).
 *
 * ## The gate is the Script route's
 *
 * `openEpisodeWith` - identity, membership, scope, in one round trip, with
 * the reads a turn needs alongside. A chat that belongs to another episode
 * of the same project is refused as not found; a chat in another project is
 * unreachable by construction, the scope cannot see it.
 *
 * ## What the answer is made of
 *
 * The script and the cast, as `context.ts` renders them, in one cached
 * system block; the chat's earlier turns as messages; the new turn last.
 * `scope: 'project'` (the Characters route, ruled 2026-09-17) reads every
 * episode with `[E2 Sc 9]` headers; a `focus` adds the open record as a
 * second, uncached block so the cacheable prefix stays stable between
 * turns. A stale focus id is no block and no error. `places` (Locations)
 * and `timeline` (Timeline) add that route's records to the system block.
 *
 * ## Tools, and a run per turn
 *
 * Since roadmap task 2.3 a turn is a tool-use loop: the model may call the
 * core toolset and the route's (`lib/agent/registry.ts`), every one a read
 * until Phase 3 (AGENTS.md ruling **R8**). Each turn is an `agent_runs` row
 * (`0034`): its tokens are recorded there (D3), and every message of the
 * exchange - the model's tool calls, the results that answer them - is stored
 * with its content blocks, so the next turn replays it (`lib/agent/replay.ts`).
 * Two limits are checked before the stream opens, both as a `429`: the D14
 * hourly request limit and the D3 daily token cap.
 */

export const assistantConnected = (): boolean => assistantEnv !== null

export type AskOutcome =
  | { readonly status: 'streaming'; readonly stream: ReadableStream<Uint8Array> }
  | { readonly status: 'refused'; readonly message: string; readonly code: 401 | 404 }
  | { readonly status: 'error'; readonly message: string; readonly code: 400 | 503 }
  /**
   * 60 requests an hour per user per project (ADR 0003 **D14**). A real `429`
   * with a real `Retry-After`, because that is what the status code is for and
   * the route handler has one to send.
   */
  | { readonly status: 'rate-limited'; readonly message: string; readonly code: 429; readonly retryAfterSeconds: number }

let client: Anthropic | null = null

/** The SDK client, or null with no key. The only reader of `ANTHROPIC_API_KEY` after `env.ts`. */
export const assistantClient = (): Anthropic | null => {
  const env = assistantEnv
  if (env === null) return null
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  return client
}

/** The open record as the Focus block reads it. Null when the id names no live record. */
const focusOf = async (
  scope: ProjectScope,
  records: readonly CharacterRecordRow[],
  focus: AskFocus,
  episodeOrdinalOf: ReadonlyMap<string, number>,
): Promise<FocusInput | null> => {
  const record = records.find((entry) => entry.id === focus.id)
  if (record === undefined) return null
  const bound = await listBoundCues(scope)
  const perEpisode = new Map<number, number>()
  for (const scene of record.derived?.scenes ?? []) {
    const ordinal = episodeOrdinalOf.get(scene)
    if (ordinal !== undefined) perEpisode.set(ordinal, (perEpisode.get(ordinal) ?? 0) + 1)
  }
  return {
    name: record.name,
    cues: bound.filter((entry) => entry.characterId === record.id).map((entry) => entry.cue),
    status: record.status,
    role: record.role,
    bio: record.bio,
    wants: record.wants,
    needs: record.needs,
    scenes: record.derived?.appearances ?? 0,
    perEpisode: [...perEpisode.entries()].sort(([a], [b]) => a - b).map(([ordinal, scenes]) => ({ ordinal, scenes })),
    lines: record.derived?.lines ?? 0,
  }
}

/**
 * The location records as the Locations route's system block lists them,
 * and the open one as its Focus block (the Locations rebuild, 2026-09-18).
 * Read only when the turn asks for them (`places: true` - the Locations
 * route), so the Characters turn's prefix is unchanged. The establishing
 * line is `@folio/script`'s `establishingLines` over the project's nodes,
 * the same reading the route's drawer quotes.
 */
const placesOf = async (
  scope: ProjectScope,
  nodes: readonly ScreenplayNode[],
  index: readonly SceneIndexRow[],
  labelFor: (target: { readonly entity: string; readonly id: string }) => string | undefined,
  focusId: string | null,
): Promise<{ readonly places: readonly PlaceInput[]; readonly focus: LocationFocusInput | null }> => {
  const [records, bound] = await Promise.all([listLocationRecords(scope), listBoundSluglines(scope)])
  const nameOf = new Map(records.map((record) => [record.id as string, record.name]))
  const rowByScene = new Map(index.map((row) => [row.sceneNodeId as string, row]))
  const intros = establishingLines(nodes, (sceneNodeId) => rowByScene.get(sceneNodeId as string)?.locationId ?? null, labelFor)
  const sluglinesOf = (record: LocationRecordRow): readonly string[] => bound.filter((entry) => entry.locationId === record.id).map((entry) => entry.slugline)
  const scenesOf = (record: LocationRecordRow): readonly SceneIndexRow[] =>
    (record.derived?.scenes ?? []).flatMap((id) => {
      const row = rowByScene.get(id as string)
      return row === undefined ? [] : [row]
    })
  const places: PlaceInput[] = records
    .filter((record) => record.derived === null || record.derived.presence === 'present' || record.parentId !== null)
    .map((record) => {
      const quadrant = quadrantOf(scenesOf(record))
      const dayNight = dayNightShort(quadrant)
      return {
        name: record.name,
        sluglines: sluglinesOf(record),
        parent: record.parentId === null ? null : (nameOf.get(record.parentId as string) ?? null),
        scenes: record.derived?.rollup.scenes ?? 0,
        dayNight: dayNight === '—' ? null : dayNight,
        status: record.status,
        line: record.description ?? intros.get(record.id)?.text ?? null,
      }
    })
  const open = focusId === null ? undefined : records.find((record) => (record.id as string) === focusId)
  if (open === undefined) return { places, focus: null }
  const scenes = scenesOf(open)
  const perEpisode = new Map<number, number>()
  for (const row of scenes) perEpisode.set(row.episodeOrdinal, (perEpisode.get(row.episodeOrdinal) ?? 0) + 1)
  const first = scenes[0]
  const last = scenes.at(-1)
  return {
    places,
    focus: {
      kind: 'location',
      name: open.name,
      sluglines: sluglinesOf(open),
      parent: open.parentId === null ? null : (nameOf.get(open.parentId as string) ?? null),
      subSets: records.filter((record) => record.parentId === open.id).map((record) => record.name),
      scenes: open.derived?.rollup.scenes ?? 0,
      perEpisode: [...perEpisode.entries()].sort(([a], [b]) => a - b).map(([ordinal, count]) => ({ ordinal, scenes: count })),
      quadrant: quadrantLabel(quadrantOf(scenes)),
      first: first === undefined ? null : formatSceneRef(sceneRefOf(first)),
      last: last === undefined ? null : formatSceneRef(sceneRefOf(last)),
      intro: intros.get(open.id)?.text ?? null,
      status: open.status,
      address: open.address,
      description: open.description,
      shootingDays: open.derived?.rollup.shootingDays ?? open.scheduledDays,
    },
  }
}

/**
 * The Timeline route's turn (the rebuild, phase 5): every scene's story
 * time, flag and threads, the check's open findings, and the drawer's
 * scene as the Focus block - `readContinuity` (`lib/timeline/server.ts`),
 * the same load and the same pure check the route draws from, promoted there
 * from this file by roadmap task 2.4. Read only when the turn asks for it
 * (`timeline: true`), so the other routes' prefixes are unchanged.
 */
const timelineOf = async (
  gate: Pick<EpisodeGate, 'scope' | 'project'>,
  focusId: string | null,
): Promise<{ readonly scenes: readonly StoryTimeInput[]; readonly findings: readonly string[]; readonly focus: SceneFocusInput | null }> => {
  const load = await readContinuity({ scope: gate.scope, project: gate.project, episodes: await listEpisodes(gate.scope) })
  const threadName = new Map(load.threads.map((thread) => [thread.id as string, thread.name]))
  const byId = new Map(load.scenes.map((scene) => [scene.sceneNodeId as string, scene]))
  const { book, buckets } = load.continuity
  const line = (finding: (typeof buckets.open)[number]): string => {
    const scene = byId.get(finding.sceneId as string)
    return `${scene === undefined ? finding.sceneId : sceneRef(scene)}: ${findingNote(finding, book)}`
  }
  const scenes: StoryTimeInput[] = load.scenes.map((scene) => ({
    ref: sceneRef(scene),
    heading: scene.heading,
    storyTime: scene.storyTime === null ? null : formatStoryTime(scene.storyTime),
    flashback: scene.flashback,
    threads: scene.threads.flatMap((id) => threadName.get(id as string) ?? []),
  }))
  const open = focusId === null ? undefined : byId.get(focusId)
  if (open === undefined) return { scenes, findings: buckets.open.map(line), focus: null }
  const previous = previousFrameScene(load.scenes, open.sceneNodeId)
  return {
    scenes,
    findings: buckets.open.map(line),
    focus: {
      kind: 'scene',
      ref: sceneRef(open),
      heading: open.heading,
      synopsis: open.synopsis,
      storyTime: open.storyTime === null ? 'not placed' : formatStoryTime(open.storyTime),
      flashback: open.flashback,
      threads: open.threads.flatMap((id) => threadName.get(id as string) ?? []),
      previous: previous === null || previous.storyTime === null ? null : `${sceneRef(previous)} · ${formatStoryTime(previous.storyTime)}`,
      cues: [
        ...(open.cues?.timeOfDay === null || open.cues === null ? [] : [`heading: ${open.cues.timeOfDay}`]),
        ...(open.cues?.action === null || open.cues === null ? [] : [`line: "${open.cues.action.quote}"`]),
      ],
      findings: findingsAbout(buckets, open.sceneNodeId).map((finding) => findingNote(finding, book)),
    },
  }
}

/** Seconds until the next UTC midnight, when the daily token cap turns over. */
export const secondsToMidnightUtc = (now: Date): number => {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000))
}

export const ask = async (raw: unknown, signal: AbortSignal): Promise<AskOutcome> => {
  const anthropic = assistantClient()
  if (anthropic === null) {
    return { status: 'error', code: 503, message: 'The assistant is not connected. Set ANTHROPIC_API_KEY on the server.' }
  }
  const parsed = AskInputSchema.safeParse(raw)
  if (!parsed.success) return { status: 'error', code: 400, message: 'Write a question first.' }
  const input = parsed.data

  const gate = await openEpisodeWith(input.projectId, input.episode, async (scope) => {
    const [chat, labels, records] = await Promise.all([
      readChat(scope, input.chatId as AssistantChatId),
      readMentionLabels(scope),
      listCharacterRecords(scope),
    ])
    return { chat, labels, records }
  }, ROLE.assistant)
  if (isRefusal(gate)) return { status: 'refused', code: gate.message.startsWith('Sign in') ? 401 : 404, message: gate.message }
  const { scope, project, episode, extra } = gate

  // After the gate, because the counter is per user per project and neither is
  // known before it; before the model call, because a limit that counts what
  // already happened is a report.
  const limited = await checkRateLimit(scope, gate.actor, 'assistant')
  if (limited !== null) return { ...limited, code: 429 }
  // D3: the per-user daily token cap, summed across every project the writer
  // works in. Refused before a token is spent; a turn that crosses it midway
  // is stopped by the loop.
  const tokenBudget = DAILY_TOKENS_PER_USER - (await tokensTodayFor(await transactionDatabase(), gate.actor))
  if (tokenBudget <= 0) {
    return {
      status: 'rate-limited',
      code: 429,
      message: "You have used today's assistant allowance. It resets at midnight UTC.",
      retryAfterSeconds: secondsToMidnightUtc(new Date()),
    }
  }
  if (extra.chat === null || extra.chat.episodeId !== episode.id) {
    return { status: 'refused', code: 404, message: 'That chat could not be found.' }
  }
  const chatId = extra.chat.id

  // The script, read after the gate rather than beside it: it needs the
  // document id, which is itself a read. Two round trips for the context of a
  // question that then takes seconds to answer is not the cost that matters.
  let script: ScriptInput
  let index: readonly SceneRef[] = []
  let sceneRows: readonly SceneIndexRow[] = []
  let projectNodes: readonly ScreenplayNode[] = []
  if (input.scope === 'project') {
    const [runs, rows] = await Promise.all([readProjectScreenplayByEpisode(scope), listSceneIndex(scope)])
    sceneRows = rows
    index = rows.map(sceneRefOf)
    projectNodes = runs.ok ? runs.value.flatMap((run) => run.nodes) : []
    script = {
      kind: 'project',
      episodes: runs.ok ? runs.value.map((run) => ({ ordinal: run.ordinal, title: run.title, nodes: run.nodes })) : [],
      index,
    }
  } else {
    const document = await readDocumentByKind(scope, episode.id, 'screenplay')
    let nodes: readonly ScreenplayNode[] = []
    if (document !== null) {
      const read = await readScreenplayNodes(scope, document.id)
      if (read.ok) nodes = read.value.map((entry) => entry.node)
    }
    script = { kind: 'episode', episodeTitle: episode.title, nodes }
  }
  const focus =
    input.focus === undefined || input.focus.kind !== 'character'
      ? null
      : await focusOf(
          scope,
          extra.records,
          input.focus,
          new Map(index.map((ref) => [ref.sceneNodeId as string, ref.episodeOrdinal])),
        )
  // The Locations route's turn (ruled 2026-09-18): the location records
  // beside the cast, and the open place as the Focus block.
  const labelBook = new Map(extra.labels.map((label) => [`${label.entity}:${label.id}`, label.label]))
  const placeRead =
    input.places === true && input.scope === 'project'
      ? await placesOf(
          scope,
          projectNodes,
          sceneRows,
          (target) => labelBook.get(`${target.entity}:${target.id}`),
          input.focus?.kind === 'location' ? input.focus.id : null,
        )
      : null

  // The Timeline route's turn (the rebuild, phase 5): story time and the
  // findings beside the script, and the drawer's scene as the Focus block.
  const timelineRead = input.timeline === true && input.scope === 'project' ? await timelineOf(gate, input.focus?.kind === 'scene' ? input.focus.id : null) : null

  const history = await listMessages(scope, chatId)

  const focused = placeRead?.focus ?? timelineRead?.focus ?? focus
  const context = buildContext({
    projectTitle: project.title,
    script,
    labels: extra.labels,
    cast: extra.records
      .filter((record) => record.derived === null || record.derived.presence === 'present')
      .map((record) => ({ name: record.name, line: record.role ?? record.bio })),
    ...(placeRead === null ? {} : { places: placeRead.places }),
    ...(timelineRead === null ? {} : { timeline: { scenes: timelineRead.scenes, findings: timelineRead.findings } }),
    ...(focused === null ? {} : { focus: focused }),
  })

  const messages: Anthropic.MessageParam[] = [...replayOf(history), { role: 'user', content: input.message }]
  const system: Anthropic.TextBlockParam[] = [{ type: 'text', text: context.system, cache_control: { type: 'ephemeral' } }]
  if (context.focus !== null) system.push({ type: 'text', text: context.focus })

  const encoder = new TextEncoder()
  const client: ModelClient = { stream: (params, options) => anthropic.messages.stream(params, options) }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AgentEvent): void => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          // The client has gone; the run still finishes and is still recorded.
        }
      }
      let runId: RunId | null = null
      let status: FinishedStatus = 'failed'
      let stopReason: AgentStopReason = 'error'
      try {
        // The run first, so the writer's question can carry its id (`0034`).
        const run = await createAgentRun(scope, { episodeId: episode.id, chatId, mode: 'interactive' })
        runId = run.id
        const question = await appendMessage(scope, chatId, 'user', input.message, { runId: run.id })
        await startAgentRun(scope, run.id, question.id)

        const outcome = await runAgentLoop({
          client,
          model: ASSISTANT_MODEL,
          maxTokens: MAX_OUTPUT_TOKENS,
          system,
          messages,
          route: input.route ?? null,
          context: { gate: { actor: gate.actor, scope, project, episode, role: gate.role }, runId: run.id, emit },
          emit,
          signal,
          tokenBudget,
          recordTokens: (used, produced) => addAgentRunTokens(scope, run.id, used, produced),
          recordMessage: async (role, body, content) => {
            await appendMessage(scope, chatId, role, body, { content, runId: run.id })
          },
        })
        stopReason = outcome.stopReason
        status = RUN_STATUS[outcome.stopReason]
        // Whatever the writer saw that no stored message holds - a step cut
        // off by an abort, an error's note - is still worth keeping: a half
        // answer is better than a question with no answer in the log.
        if (outcome.unsaved.trim().length > 0) {
          await appendMessage(scope, chatId, 'assistant', outcome.unsaved, { runId: run.id }).catch(() => undefined)
        }
      } catch (cause) {
        console.error({ event: 'folio.agent.turn_failed', message: cause instanceof Error ? cause.message : String(cause) })
        emit({ type: 'error', message: 'The assistant could not answer.' })
      } finally {
        if (runId !== null) {
          await finishAgentRun(scope, runId, status, status === 'failed' ? 'The assistant could not answer.' : null).catch(() => undefined)
        }
        emit({ type: 'done', runId, status, stopReason })
        try {
          controller.close()
        } catch {
          // Already closed by the cancel path.
        }
      }
    },
  })

  return { status: 'streaming', stream }
}

/** How a turn's end is recorded on its run. A limit reached is still a turn that answered. */
type FinishedStatus = Exclude<AgentRunStatus, 'queued' | 'running'>

const RUN_STATUS: Readonly<Record<AgentStopReason, FinishedStatus>> = {
  end_turn: 'succeeded',
  step_cap: 'succeeded',
  time_cap: 'succeeded',
  token_cap: 'succeeded',
  refusal: 'succeeded',
  aborted: 'cancelled',
  error: 'failed',
}
