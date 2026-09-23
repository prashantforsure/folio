import type { AgentRoute, SceneRef } from '@folio/contracts'
import type { InlineContent, MentionLabel, NodeId, ScreenplayNode } from '@folio/script'

import { craftRulesText } from '../agent/craft'
import type { LabelFor } from '../script/inline'
import { CONTEXT_CHAR_CAP } from './model'

/**
 * What the model is shown, and what it is told about itself.
 *
 * ## The script, as prose with scene numbers
 *
 * Not Fountain: the serialiser writes `@{character:<uuid>}` tokens where a
 * writer sees MEERA, and a model reading uuids cannot say "Meera". Each node
 * is rendered the way the page reads it - mentions replaced by their labels
 * from the same label book the sheet uses - and every scene heading carries
 * `[Scene N]` so an answer can cite one. Comments (`[[ ]]` notes) are
 * included and marked, because a writer asking "what did I leave myself a
 * note about" expects them; nothing here is an export.
 *
 * ## Two scopes
 *
 * `episode` is the panel's standing since 2026-09-16: one episode's script,
 * byte-identical to what it was (the snapshot test guards the writing
 * routes). `project` is every episode, in order, under `[Episode N]`
 * markers with `[E2 Sc 9]` headers so an answer cites across them - the
 * Characters route's, by the 2026-09-17 ruling. The cap is shared across
 * the episodes by water-filling: each is cut at a scene boundary and says
 * so, so a cut is never silent.
 *
 * ## Focus
 *
 * On `/characters` with a record open the system prompt ends with a Focus
 * block - the record as the drawer shows it - so "what does she want" has
 * a "she"; on `/locations` the place, on `/timeline` the scene in the
 * drawer with its story time and findings. Volatile, so it is its own
 * block after the cacheable prefix.
 *
 * ## Story time, on the Timeline
 *
 * On `/timeline` (the rebuild, phase 5) the system block carries every
 * scene's story time, flag and threads, and the check's open findings, so
 * "where does the love thread stall" and "why is E1 Sc 14 flagged" are
 * answered from what the route knows rather than guessed from the page.
 *
 * ## Tools, proposals, and the rules it writes to (roadmap task 3.7)
 *
 * The model reads with its read tools (search, count, read a scene, check
 * continuity, take the writer to a page, hand them an export) and, since
 * roadmap Phase 3, **changes things through proposals** - AGENTS.md ruling
 * **R8** as it now stands: every write is reviewed by the writer as a diff or
 * as before-and-after values, and applied or rejected; renames, merges,
 * deletes and anything with no diff always ask. The instructions say so, and
 * carry a tool policy (read before writing, preview a rename, create records
 * before the script uses them, bound spellings exactly, never an invented id,
 * one proposal for related changes, a sentence or two on each) and the craft
 * rules of `docs/agents/craft.md` (`lib/agent/craft.ts`). Ruling **R4** stays a
 * rule of the answer: a number is stated only as a tool returned it.
 *
 * ## Where the writer is
 *
 * The route and the editor selection go in a block of their own after the
 * Focus block (`whereBlock`): they change on every click, and the cacheable
 * prefix must not. A selection is sent as node ids and rendered here from the
 * stored script - the words the page holds, never words the request carried.
 */

export type AssistantContext = {
  readonly system: string
  /** The Focus block, when the writer has a record open; sent as its own, uncached block. */
  readonly focus: string | null
  /** Where the writer is - the route and the selection; its own uncached block, last. */
  readonly where: string | null
  /** True when the script was cut to fit `CONTEXT_CHAR_CAP`. */
  readonly truncated: boolean
  /** In project scope: the ordinals of the episodes that were cut. */
  readonly cut: readonly number[]
}

const INSTRUCTIONS = `You are the writing assistant inside Folio, a screenwriting workspace. You are talking to the writer of the screenplay below.

What you can read: the script, the cast list, (on the Locations route) the location records and (on the Timeline route) each scene's story time, its threads and the continuity findings below; and with your tools, read, search and count across the whole project - its scenes and their lengths, page counts, characters, locations, props, the continuity check and the research library - take the writer to a page or a scene, and hand them an export (the script as Final Draft or Fountain, the outline, the chronology, the character and location sheets).

What you can change, and how: with your write tools you can change the script and the outline, the character, location and prop records and their relationships, synopses, story time and threads, the title page, comments, the Storyboard's shots, Production's reels and shots, and episodes. Every change is a proposal: nothing changes until the writer reviews it - the script and outline as a diff, a record as before-and-after values - and applies it. A rename, a merge, a delete, a format change and undoing a run always ask the writer to confirm. You cannot edit research sources, settings, share links or billing, delete an episode, import a script, or spend credits. Never say a change is made: say it is proposed, and let the writer apply it.

How to use your tools:
- Read before you write. Read the scene (read_scene) or search the project before proposing an edit to it, so every anchor and every id comes from what the page holds.
- Never invent an id. Every node id, record id, scene id and run id comes from a tool's result; new lines get their ids from Folio.
- Preview a rename before proposing it: preview_rename shows every cue or heading it would rewrite.
- Create characters and locations before the script uses them: create_character and create_location first, then write their cues and headings.
- Use the bound spellings exactly: a cue is the character's bound cue spelling, a heading's place is the location's bound slugline spelling. A new spelling makes a new, unresolved name.
- Group related changes into one proposal: make them in the same step, so the writer reviews them together.
- Explain each proposal in a sentence or two - what it changes and why - and nothing more; the writer can read the diff.
- Change only what was asked, and keep the writer's voice.

How to answer:
- Be specific. Cite scenes by their number as "Scene 3" when a claim comes from the page. If something is not on the page, say so rather than inventing it.
- State a number only as a tool returned it. A count, a page length, a list of scenes or findings comes from a tool - call it rather than counting the script yourself, and never estimate a page count.
- When the answer is somewhere the writer should look, find it first, then take them there with navigate.
- Match the writer's language when quoting dialogue; the script may mix languages.
- Keep answers as short as the question allows. A yes-or-no question gets a short answer; a "punch up this scene" request gets the scene.
- Never summarise the whole script unless asked. The writer wrote it.

How to write, whenever you draft script (the craft rules):
${craftRulesText()}`

const PROJECT_CITING = `- The script below spans every episode. Cite a scene as "E2 Sc 9" - the episode and the scene number as the headers write them - so the writer can find it.`

const labelBookOf = (labels: readonly MentionLabel[]): LabelFor => {
  const book = new Map<string, string>()
  for (const label of labels) book.set(`${label.entity}:${label.id}`, label.label)
  return (entity, id) => book.get(`${entity}:${id}`)
}

/** The model's inline runs as text: a mention by its label, an unresolved one as `?`. */
const runsText = (content: InlineContent, labelFor: LabelFor): string =>
  content
    .map((run) => (run.kind === 'text' ? run.text : (labelFor(run.target.entity, run.target.id) ?? '?')))
    .join('')

const renderNode = (node: ScreenplayNode, labelFor: LabelFor, heading: string): string => {
  const text = runsText(node.content, labelFor).trim()
  switch (node.type) {
    case 'scene':
      return `\n${heading} ${text.toUpperCase()}`
    case 'character':
      return `\n${text.toUpperCase()}${node.modifiers.length > 0 ? ` (${node.modifiers.join(', ')})` : ''}`
    case 'paren':
      return `    ${text}`
    case 'dialogue':
      return `    ${text}`
    case 'subtitle':
      return `    [subtitle] ${text}`
    case 'transition':
      return `\n${' '.repeat(40)}${text.toUpperCase()}`
    case 'comment':
      return `\n[[writer's note: ${text}]]`
    case 'action':
      return `\n${text}`
  }
}

export const renderScript = (
  nodes: readonly ScreenplayNode[],
  labels: readonly MentionLabel[],
): { readonly text: string; readonly truncated: boolean } => {
  const labelFor = labelBookOf(labels)
  const lines: string[] = []
  let scene = 0
  let length = 0
  let truncated = false
  for (const node of nodes) {
    if (node.type === 'scene') scene += 1
    const line = renderNode(node, labelFor, `[Scene ${String(scene)}]`)
    if (length + line.length > CONTEXT_CHAR_CAP && node.type === 'scene') {
      truncated = true
      break
    }
    lines.push(line)
    length += line.length + 1
  }
  return { text: lines.join('\n').trim(), truncated }
}

// ---------------------------------------------------------------------------
// The project, by scene
// ---------------------------------------------------------------------------

export type EpisodeNodes = {
  readonly ordinal: number
  readonly title: string
  readonly nodes: readonly ScreenplayNode[]
}

/** One scene's text as the model reads it: the ref, its label, the text under the heading (the heading itself excluded). */
export type SceneText = {
  readonly ref: SceneRef
  readonly label: string
  readonly text: string
}

/**
 * The project cut into scenes, **keyed on the scene index's heading ids**,
 * never on every `scene` node: `derive.ts` demotes an unreadable heading
 * into the previous scene, and the index is the list of headings the pass
 * accepted. Nodes before the first indexed heading are dropped; comments
 * are skipped - a note is not evidence about a character.
 */
export const sliceScenes = (
  episodes: readonly EpisodeNodes[],
  labels: readonly MentionLabel[],
  index: readonly SceneRef[],
): ReadonlyMap<NodeId, SceneText> => {
  const labelFor = labelBookOf(labels)
  const refs = new Map<NodeId, SceneRef>(index.map((ref) => [ref.sceneNodeId, ref]))
  const out = new Map<NodeId, SceneText>()
  for (const episode of episodes) {
    let current: { ref: SceneRef; lines: string[] } | null = null
    const flush = (): void => {
      if (current === null) return
      out.set(current.ref.sceneNodeId, {
        ref: current.ref,
        label: `E${String(current.ref.episodeOrdinal)} Sc ${String(current.ref.number)}`,
        text: current.lines.join('\n').trim(),
      })
    }
    for (const node of episode.nodes) {
      if (node.type === 'scene') {
        const ref = refs.get(node.id)
        if (ref !== undefined) {
          flush()
          current = { ref, lines: [] }
          continue
        }
      }
      if (current === null || node.type === 'comment') continue
      // A heading the pass did not accept belongs to the scene it is in, as a line of it.
      current.lines.push(node.type === 'scene' ? `\n${runsText(node.content, labelFor).trim()}` : renderNode(node, labelFor, ''))
    }
    flush()
  }
  return out
}

/**
 * Every episode's script, in order, `[Episode N · Title]` markers between,
 * `[E2 Sc 9] HEADING` on each accepted heading, the cap shared by
 * water-filling: every episode gets an equal share, an episode that needs
 * less gives its remainder to the rest, and an episode over its share is
 * cut at a scene boundary with a line saying so. Returns which were cut.
 */
export const renderProject = (
  episodes: readonly EpisodeNodes[],
  labels: readonly MentionLabel[],
  index: readonly SceneRef[],
  cap: number,
): { readonly text: string; readonly cut: readonly number[] } => {
  const labelFor = labelBookOf(labels)
  const refs = new Map<NodeId, SceneRef>(index.map((ref) => [ref.sceneNodeId, ref]))
  const rendered = episodes.map((episode) => {
    const lines: { text: string; scene: boolean }[] = []
    for (const node of episode.nodes) {
      const ref = node.type === 'scene' ? refs.get(node.id) : undefined
      const heading = ref === undefined ? '[Scene]' : `[E${String(ref.episodeOrdinal)} Sc ${String(ref.number)}]`
      lines.push({ text: renderNode(node, labelFor, heading), scene: node.type === 'scene' })
    }
    return { episode, lines, length: lines.reduce((total, line) => total + line.text.length + 1, 0) }
  })

  // Water-filling: shares are handed out smallest need first, so a short
  // episode never takes more than it needs and the rest share the remainder.
  const budget = new Map<number, number>()
  let remaining = cap
  const bySize = [...rendered].sort((a, b) => a.length - b.length)
  bySize.forEach((entry, at) => {
    const share = Math.floor(remaining / (bySize.length - at))
    const given = Math.min(share, entry.length)
    budget.set(entry.episode.ordinal, given)
    remaining -= given
  })

  const cut: number[] = []
  const blocks = rendered.map(({ episode, lines }) => {
    const allowed = budget.get(episode.ordinal) ?? 0
    const kept: string[] = []
    let length = 0
    let stopped = false
    for (const line of lines) {
      if (length + line.text.length > allowed && line.scene && kept.length > 0) {
        stopped = true
        break
      }
      kept.push(line.text)
      length += line.text.length + 1
    }
    if (stopped) {
      cut.push(episode.ordinal)
      kept.push(`\n[Episode ${String(episode.ordinal)} continues; it was cut here to fit. Say so if the writer asks about a later scene.]`)
    }
    const marker = episode.title.trim() === '' ? `[Episode ${String(episode.ordinal)}]` : `[Episode ${String(episode.ordinal)} · ${episode.title}]`
    return `${marker}\n${kept.join('\n').trim()}`
  })
  return { text: blocks.join('\n\n').trim(), cut }
}

// ---------------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------------

/**
 * The Locations drawer's record as the Focus block reads it (the Locations
 * rebuild, 2026-09-18): the name and its set texts, where it is in the
 * script, what the page says about it, and the production fields.
 */
export type LocationFocusInput = {
  readonly kind: 'location'
  readonly name: string
  readonly sluglines: readonly string[]
  readonly parent: string | null
  readonly subSets: readonly string[]
  readonly scenes: number
  readonly perEpisode: readonly { readonly ordinal: number; readonly scenes: number }[]
  /** `INT D 3 · INT N 2 · EXT D 1 · EXT N 3`. */
  readonly quadrant: string
  readonly first: string | null
  readonly last: string | null
  readonly intro: string | null
  readonly status: string
  readonly address: string | null
  readonly description: string | null
  readonly shootingDays: number
}

/** One location as the Locations route's system block lists it. */
export type PlaceInput = {
  readonly name: string
  readonly sluglines: readonly string[]
  readonly parent: string | null
  readonly scenes: number
  /** `4 D · 5 N`, or null with no lit heading. */
  readonly dayNight: string | null
  readonly status: string
  readonly line: string | null
}

export type FocusInput = {
  readonly kind?: 'character'
  readonly name: string
  readonly cues: readonly string[]
  readonly status: string
  readonly role: string | null
  readonly bio: string | null
  readonly wants: string | null
  readonly needs: string | null
  readonly scenes: number
  readonly perEpisode: readonly { readonly ordinal: number; readonly scenes: number }[]
  readonly lines: number
}

const written = (value: string | null): string => (value === null || value.trim() === '' ? 'not written' : value.trim())

/** The Locations drawer's Focus block. */
const locationFocusBlock = (focus: LocationFocusInput): string =>
  [
    `Focus: the writer has ${focus.name}'s record open on the Locations route.`,
    `Name: ${focus.name}`,
    `In the script as: ${focus.sluglines.length === 0 ? 'no set text bound yet' : focus.sluglines.join(', ')}`,
    `Part of: ${focus.parent ?? 'a primary set of its own'}`,
    `Sub-sets: ${focus.subSets.length === 0 ? 'none' : focus.subSets.join(', ')}`,
    `Scenes: ${String(focus.scenes)}${focus.perEpisode.length > 1 ? ` (${focus.perEpisode.map((entry) => `E${String(entry.ordinal)} ${String(entry.scenes)}`).join(' · ')})` : ''} · ${focus.quadrant}`,
    `First: ${focus.first ?? 'not on the page'} · Last: ${focus.last ?? 'not on the page'}`,
    `First action under one of its headings: ${focus.intro === null ? 'none' : `"${focus.intro}"`}`,
    `Scouting status: ${focus.status}`,
    `Address: ${written(focus.address)}`,
    `Description: ${written(focus.description)}`,
    `Shooting days scheduled: ${String(focus.shootingDays)}`,
    '',
    `When the writer asks you to describe ${focus.name}, answer from the action lines under its headings, one or two sentences they can paste into the description, each citing the scene it comes from. To put it in the record, propose it with update_location; the writer applies it.`,
  ].join('\n')

/**
 * The Timeline drawer's scene as the Focus block reads it (the Timeline
 * rebuild, phase 5): where it is, when the writer placed it, what the page
 * says about when, and what the check found.
 */
export type SceneFocusInput = {
  readonly kind: 'scene'
  /** `E1 Sc 14`. */
  readonly ref: string
  readonly heading: string
  readonly synopsis: string | null
  /** `Day 2 · 06:40`, or `not placed`. */
  readonly storyTime: string
  readonly flashback: boolean
  readonly threads: readonly string[]
  /** The frame-story scene before it on the page and its time, or null. */
  readonly previous: string | null
  /** What the page says: the heading's time of day, the cue line. */
  readonly cues: readonly string[]
  readonly findings: readonly string[]
}

/** One scene as the Timeline route's system block lists it. */
export type StoryTimeInput = {
  readonly ref: string
  readonly heading: string
  /** `Day 2 · 06:40`, or null unplaced. */
  readonly storyTime: string | null
  readonly flashback: boolean
  readonly threads: readonly string[]
}

const sceneFocusBlock = (focus: SceneFocusInput): string =>
  [
    `Focus: the writer has ${focus.ref} open in the Timeline's Place in time drawer.`,
    `Scene: ${focus.ref} ${focus.heading}`,
    `Synopsis: ${written(focus.synopsis)}`,
    `Story time: ${focus.storyTime}${focus.flashback ? ' · flagged as a flashback' : ''}`,
    `Threads: ${focus.threads.length === 0 ? 'none' : focus.threads.join(', ')}`,
    `Frame-story scene before it on the page: ${focus.previous ?? 'none placed'}`,
    `What the page says about when: ${focus.cues.length === 0 ? 'nothing' : focus.cues.join('; ')}`,
    `Continuity findings on it: ${focus.findings.length === 0 ? 'none' : focus.findings.join(' | ')}`,
    '',
    `When the writer asks where this scene belongs in time, answer from the page's own cues and the scenes around it, and say which line you read it from. To place it, propose it with set_story_time; the writer applies it.`,
  ].join('\n')

/** The Focus block: the open record as the drawer shows it, and what a draft for it should be. */
export const focusBlock = (focus: FocusInput | LocationFocusInput | SceneFocusInput): string =>
  'kind' in focus && focus.kind === 'location'
    ? locationFocusBlock(focus)
    : 'kind' in focus && focus.kind === 'scene'
      ? sceneFocusBlock(focus)
      : [
    `Focus: the writer has ${focus.name}'s record open on the Characters route.`,
    `Name: ${focus.name}`,
    `In the script as: ${focus.cues.length === 0 ? 'no spelling bound yet' : focus.cues.join(', ')}`,
    `Status: ${focus.status}`,
    `Role: ${written(focus.role)}`,
    `Description: ${written(focus.bio)}`,
    `Wants: ${written(focus.wants)}`,
    `Needs: ${written(focus.needs)}`,
    `Scenes: ${String(focus.scenes)}${focus.perEpisode.length > 1 ? ` (${focus.perEpisode.map((entry) => `E${String(entry.ordinal)} ${String(entry.scenes)}`).join(' · ')})` : ''} · ${String(focus.lines)} lines`,
    '',
    `When the writer asks you to draft something for ${focus.name}, write one or two sentences, each citing the scene it comes from. To put them in the record, propose them with update_character; the writer applies it.`,
  ].join('\n')

// ---------------------------------------------------------------------------
// Where the writer is (roadmap task 2.6)
// ---------------------------------------------------------------------------

/**
 * The selection as the model reads it. A Script selection is its lines, from
 * the stored script; an Outline selection is only a count, because the
 * outline is not in the assistant's context (ruled 2026-09-16 for the Outline
 * route: the model reads the script) and reading it is a widening AGENTS.md
 * puts behind a question.
 */
export type SelectionInput =
  | { readonly kind: 'script'; readonly lines: readonly string[]; readonly more: number }
  | { readonly kind: 'outline'; readonly blocks: number }

export type WhereInput = {
  readonly route: AgentRoute | null
  readonly selection: SelectionInput | null
}

/** The most selected lines quoted; past it the block says how many more. */
export const SELECTION_LINES = 40

const PAGE_NAME: Readonly<Record<AgentRoute, string>> = {
  script: 'Script',
  outline: 'Outline',
  storyboard: 'Storyboard',
  scenes: 'Scenes',
  production: 'Production',
  characters: 'Characters',
  locations: 'Locations',
  props: 'Props',
  timeline: 'Timeline',
  research: 'Research',
}

/**
 * The script lines a selection covers, rendered as the Script block renders
 * them, each run under the scene it is in. Ids that name no node here (a
 * block typed since the last save) are skipped; none at all is no selection.
 */
export const scriptSelection = (nodes: readonly ScreenplayNode[], nodeIds: readonly string[], labels: readonly MentionLabel[]): SelectionInput | null => {
  const wanted = new Set(nodeIds)
  const labelFor = labelBookOf(labels)
  const lines: string[] = []
  let scene = 0
  let printed = -1
  let matched = 0
  for (const node of nodes) {
    if (node.type === 'scene') scene += 1
    if (!wanted.has(node.id)) continue
    matched += 1
    if (lines.length >= SELECTION_LINES) continue
    if (node.type !== 'scene' && printed !== scene) lines.push(scene === 0 ? '(before the first scene)' : `(in Scene ${String(scene)})`)
    printed = scene
    lines.push(renderNode(node, labelFor, `[Scene ${String(scene)}]`).trim())
  }
  return matched === 0 ? null : { kind: 'script', lines, more: Math.max(0, matched - SELECTION_LINES) }
}

/** The route and the selection, as their own block; null when neither is known. */
export const whereBlock = (where: WhereInput): string | null => {
  const lines: string[] = []
  if (where.route !== null) lines.push(`The writer is on the ${PAGE_NAME[where.route]} page.`)
  const selection = where.selection
  if (selection?.kind === 'script') {
    lines.push('', 'They have selected these lines of the script - "this", "these lines" and "the selection" mean them:', ...selection.lines)
    if (selection.more > 0) lines.push(`(and ${String(selection.more)} more)`)
  } else if (selection?.kind === 'outline') {
    lines.push(
      '',
      `They have ${String(selection.blocks)} outline ${selection.blocks === 1 ? 'block' : 'blocks'} selected. The outline's text is not in what you can read; ask them to paste it if the question needs it.`,
    )
  }
  return lines.length === 0 ? null : ['Where the writer is:', ...lines].join('\n')
}

// ---------------------------------------------------------------------------
// The whole prompt
// ---------------------------------------------------------------------------

export type ScriptInput =
  | { readonly kind: 'episode'; readonly episodeTitle: string; readonly nodes: readonly ScreenplayNode[] }
  | { readonly kind: 'project'; readonly episodes: readonly EpisodeNodes[]; readonly index: readonly SceneRef[] }

export const buildContext = ({
  projectTitle,
  script,
  labels,
  cast,
  places,
  timeline,
  focus,
  where,
}: {
  readonly projectTitle: string
  readonly script: ScriptInput
  readonly labels: readonly MentionLabel[]
  /** Character names, with a short line each when the record has one. */
  readonly cast: readonly { readonly name: string; readonly line: string | null }[]
  /** The location records, on the Locations route only (ruled 2026-09-18); absent elsewhere. */
  readonly places?: readonly PlaceInput[]
  /** Every scene's story time and threads, and the open findings, on the Timeline route only; absent elsewhere. */
  readonly timeline?: { readonly scenes: readonly StoryTimeInput[]; readonly findings: readonly string[] }
  readonly focus?: FocusInput | LocationFocusInput | SceneFocusInput
  /** The route and the editor selection (roadmap task 2.6). */
  readonly where?: WhereInput
}): AssistantContext => {
  const whereText = where === undefined ? null : whereBlock(where)
  const castLines =
    cast.length === 0
      ? 'No character records yet - the cast is whoever the cues name.'
      : cast.map((person) => (person.line === null ? `- ${person.name}` : `- ${person.name}: ${person.line}`)).join('\n')
  const placeLines =
    places === undefined
      ? []
      : [
          '',
          'Locations (each with its set texts as the headings spell it, its scene count and day / night split, its scouting status):',
          places.length === 0
            ? 'No location records yet - the places are whatever the headings name.'
            : places
                .map((place) => {
                  const head = `- ${place.name} (${place.sluglines.join(', ')})${place.parent === null ? '' : `, inside ${place.parent}`}: ${String(place.scenes)} ${place.scenes === 1 ? 'scene' : 'scenes'}${place.dayNight === null ? '' : ` · ${place.dayNight}`} · ${place.status}`
                  return place.line === null ? head : `${head}\n  "${place.line}"`
                })
                .join('\n'),
        ]

  const timelineLines =
    timeline === undefined
      ? []
      : [
          '',
          'Story time (what the writer placed each scene at; "unplaced" means no day yet; a flashback sits outside the frame story):',
          timeline.scenes.length === 0
            ? 'No scenes yet.'
            : timeline.scenes
                .map(
                  (scene) =>
                    `- ${scene.ref} ${scene.heading}: ${scene.storyTime ?? 'unplaced'}${scene.flashback ? ' · flashback' : ''}${scene.threads.length === 0 ? '' : ` · threads: ${scene.threads.join(', ')}`}`,
                )
                .join('\n'),
          '',
          'Continuity findings (the check over story time and the page; flags, not errors):',
          timeline.findings.length === 0 ? 'None open.' : timeline.findings.map((line) => `- ${line}`).join('\n'),
        ]

  if (script.kind === 'episode') {
    const rendered = renderScript(script.nodes, labels)
    const scriptBlock =
      script.nodes.length === 0
        ? 'The script is empty. Nothing has been written yet.'
        : `${rendered.text}${rendered.truncated ? '\n\n[The script continues; it was cut here to fit. Say so if the writer asks about a later scene.]' : ''}`
    const system = [INSTRUCTIONS, '', `Project: ${projectTitle}`, `Episode: ${script.episodeTitle}`, '', 'Cast:', castLines, ...placeLines, ...timelineLines, '', 'Script:', scriptBlock].join('\n')
    return { system, focus: focus === undefined ? null : focusBlock(focus), where: whereText, truncated: rendered.truncated, cut: [] }
  }

  const empty = script.episodes.every((episode) => episode.nodes.length === 0)
  const rendered = empty ? { text: '', cut: [] } : renderProject(script.episodes, labels, script.index, CONTEXT_CHAR_CAP)
  const scriptBlock = empty ? 'The script is empty. Nothing has been written yet.' : rendered.text
  const system = [
    `${INSTRUCTIONS}\n${PROJECT_CITING}`,
    '',
    `Project: ${projectTitle}`,
    `Episodes: ${String(script.episodes.length)}`,
    '',
    'Cast:',
    castLines,
    ...placeLines,
    ...timelineLines,
    '',
    'Script:',
    scriptBlock,
  ].join('\n')
  return { system, focus: focus === undefined ? null : focusBlock(focus), where: whereText, truncated: rendered.cut.length > 0, cut: rendered.cut }
}
