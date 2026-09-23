import type { AgentRoute, AskFocus, AskScope, AskSelection, SceneRef } from '@folio/contracts'
import {
  listBoundCues,
  listBoundSluglines,
  listEpisodes,
  listLocationRecords,
  listSceneIndex,
  readDocumentByKind,
  readProjectScreenplayByEpisode,
  readScreenplayNodes,
} from '@folio/db'
import type { CharacterRecordRow, LocationRecordRow, ProjectScope, SceneIndexRow } from '@folio/db'
import type { MentionLabel, ScreenplayNode } from '@folio/script'
import { establishingLines, formatStoryTime, quadrantOf } from '@folio/script'
import type Anthropic from '@anthropic-ai/sdk'

import { formatSceneRef, sceneRefOf } from '../characters/figures'
import { dayNightShort, quadrantLabel } from '../locations/view'
import type { EpisodeGate } from '../script/actor-gate'
import { readContinuity } from '../timeline/server'
import { findingNote, findingsAbout, previousFrameScene, sceneRef } from '../timeline/view'
import type { FocusInput, LocationFocusInput, PlaceInput, SceneFocusInput, ScriptInput, StoryTimeInput } from './context'
import { buildContext, scriptSelection } from './context'

/**
 * What a turn is told - the system blocks, read and rendered. Out of
 * `server.ts` since roadmap task 4.4, because a background run's turns are
 * built on the worker from the same reads, and the worker must not import
 * `next/server`. `ask()` calls it with the request's fields; a background
 * run with the fields its `agent_runs.input` stored.
 *
 * ## What the answer is made of
 *
 * The script and the cast, as `context.ts` renders them, in one cached
 * system block. `scope: 'project'` (the Characters route, ruled 2026-09-17)
 * reads every episode with `[E2 Sc 9]` headers; a `focus` adds the open
 * record as a second, uncached block so the cacheable prefix stays stable
 * between turns. A stale focus id is no block and no error. `places`
 * (Locations) and `timeline` (Timeline) add that route's records to the
 * system block. The route and the editor selection are a last, uncached block.
 */

export type TurnInput = {
  readonly scope: AskScope
  readonly route: AgentRoute | null
  readonly focus?: AskFocus
  readonly places?: boolean
  readonly timeline?: boolean
  readonly selection?: AskSelection
}

/** What the gate read beside itself for `ask()`, in its one round trip; a background run reads them itself. */
export type TurnReads = { readonly labels: readonly MentionLabel[]; readonly records: readonly CharacterRecordRow[] }

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

export const turnSystem = async (gate: EpisodeGate, reads: TurnReads, input: TurnInput): Promise<Anthropic.TextBlockParam[]> => {
  const { scope, project, episode } = gate
  // The script, read after the gate rather than beside it: it needs the
  // document id, which is itself a read. Two round trips for the context of a
  // question that then takes seconds to answer is not the cost that matters.
  let script: ScriptInput
  let index: readonly SceneRef[] = []
  let sceneRows: readonly SceneIndexRow[] = []
  let projectNodes: readonly ScreenplayNode[] = []
  /** The episode's own nodes, in episode scope - what a Script selection is read from. */
  let episodeNodes: readonly ScreenplayNode[] = []
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
    episodeNodes = nodes
    script = { kind: 'episode', episodeTitle: episode.title, nodes }
  }
  const focus =
    input.focus === undefined || input.focus.kind !== 'character'
      ? null
      : await focusOf(
          scope,
          reads.records,
          input.focus,
          new Map(index.map((ref) => [ref.sceneNodeId as string, ref.episodeOrdinal])),
        )
  // The Locations route's turn (ruled 2026-09-18): the location records
  // beside the cast, and the open place as the Focus block.
  const labelBook = new Map(reads.labels.map((label) => [`${label.entity}:${label.id}`, label.label]))
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

  const focused = placeRead?.focus ?? timelineRead?.focus ?? focus
  const context = buildContext({
    projectTitle: project.title,
    script,
    labels: reads.labels,
    cast: reads.records
      .filter((record) => record.derived === null || record.derived.presence === 'present')
      .map((record) => ({ name: record.name, line: record.role ?? record.bio })),
    ...(placeRead === null ? {} : { places: placeRead.places }),
    ...(timelineRead === null ? {} : { timeline: { scenes: timelineRead.scenes, findings: timelineRead.findings } }),
    ...(focused === null ? {} : { focus: focused }),
    // Where the writer is (roadmap task 2.6): the route, and the editor
    // selection read from the stored script by its ids - never the request's words.
    where: {
      route: input.route,
      selection:
        input.selection === undefined
          ? null
          : input.selection.kind === 'script'
            ? scriptSelection(episodeNodes, input.selection.nodeIds, reads.labels)
            : input.selection.nodeIds.length === 0
              ? null
              : { kind: 'outline', blocks: input.selection.nodeIds.length },
    },
  })
  const system: Anthropic.TextBlockParam[] = [{ type: 'text', text: context.system, cache_control: { type: 'ephemeral' } }]
  if (context.focus !== null) system.push({ type: 'text', text: context.focus })
  if (context.where !== null) system.push({ type: 'text', text: context.where })
  return system
}
