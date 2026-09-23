'use client'

import type { AskRequest, EpisodeSlug, ProjectId } from '@folio/contracts'
import { Icon } from '@folio/ui'
import { useCallback, useEffect, useRef, useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

import { continueBackgroundRunAction } from '../../../../lib/agent/actions'
import type { RunView } from '../../../../lib/agent/runs'
import { listAssistantChats, openAssistantChat, startAssistantChat } from '../../../../lib/assistant/actions'
import type { ChatRow, MessageRow, RunStarted } from '../../../../lib/assistant/result'
import type { CharacterFacts } from '../../../../lib/characters/facts'
import { useCharacterFacts } from '../../../../lib/characters/facts-cell'
import { citeOf } from '../../../../lib/characters/figures'
import type { LocationFacts } from '../../../../lib/locations/facts'
import { useLocationFacts } from '../../../../lib/locations/facts-cell'
import type { PropFacts } from '../../../../lib/props/facts'
import { usePropFacts } from '../../../../lib/props/facts-cell'
import { hrefOfTarget } from '../../../../lib/agent/navigate'
import { readAgentStream } from '../../../../lib/agent/stream'
import { asRoute } from '../../../../lib/routes'
import { useEphemeral } from '../../../../lib/state/ephemeral'
import { assistantChatKey, useSession } from '../../../../lib/state/session'
import type { TimelineFacts } from '../../../../lib/timeline/facts'
import { useTimelineFacts } from '../../../../lib/timeline/facts-cell'
import { characterHref } from '../../../../lib/workspace/hrefs'
import { saveBase64File } from '../../../../lib/workspace/save-file'
import type { RailSection, WorkspaceRoute } from '../../../../lib/workspace/routes'
import type { CitationChip } from '../../app/project/[projectId]/_chrome/citation-chips'
import { CitationChips } from '../../app/project/[projectId]/_chrome/citation-chips'
import { Orb } from '../../app/project/[projectId]/_chrome/orb'
import { ProposalCard } from './proposal-card'
import { RunCard, isLiveRun } from './run-card'
import { RunHistory } from './run-history'
import { useLivePoll } from './use-live-poll'

/**
 * The assistant panel. 400px, `--sunk`, one left hairline - `docs/ui
 * design/README.md`, "Assistant": "`New chat` dropdown and a close ✕; a
 * 124px orb with a slow drift animation; 'How can I help?' and a
 * route-specific subhead; three suggestion chips, each with a small semantic
 * square; then the composer - 'Ask, or @ to add context…', an attach `+`,
 * dictate, and a solid send button."
 *
 * ## What is real and what is drawn
 *
 * Chats are rows (`assistant_chats`), the answer streams from
 * `POST /api/assistant`, and every turn is kept. The `+` attach and dictate
 * buttons are drawn as the mockup draws them but do nothing yet - no
 * attachment model and no speech path exist - so each is disabled with its
 * title saying so rather than omitted; the composer's `@` mention is a
 * hint the mockup writes and this pass does not parse. All three flagged.
 *
 * ## Mounted once, hidden when closed
 *
 * Since roadmap task 2.2 the panel is mounted by `app/(app)/_shell/assistant-host.tsx`,
 * above both shells, and closing it hides it rather than unmounting it: a
 * conversation survives the close, every route change and a move to another
 * project and back. What must also survive a reload - the open chat per
 * project and episode, and the unsent draft - is in the session store
 * (`lib/state/session.ts`); the chat itself is re-read from the server, which
 * re-checks it, whenever the episode the panel reads changes.
 *
 * ## Not connected
 *
 * With no `ANTHROPIC_API_KEY` the composer is disabled and the panel says
 * why, in the writer's terms. The chips still prefill so the shape can be
 * seen; sending is what is off.
 *
 * ## In flow or over
 *
 * Above 1200px the panel is a flex sibling and the layout shrinks; below it
 * is absolutely positioned over the content with the README's shadow. The
 * shell decides which and forces the sidebar closed in the second case.
 *
 * ## Two kinds of chip
 *
 * An `ask` chip prefills the composer - a question typed for the writer.
 * A `report` chip is answered by the route itself: AGENTS.md, The AI agent -
 * "A report never calls a model. Reports are arithmetic over the node list
 * and derived entities." The Characters route publishes what its chips
 * count (`lib/characters/facts.ts`), and the panel prints the sentence with
 * a mono `report · no model` chip and the citations - it works with the
 * assistant disconnected. The labels stay verbatim; the first chip names the
 * open record when the drawer has one.
 *
 * ## What the model read
 *
 * On Locations the panel still reads one episode - the shell's fallback -
 * while the route is project-wide, so the subhead says which (`Reading
 * Episode 2.`). On Characters (ruled 2026-09-17, the rebuild's phase 4)
 * it reads the whole project - `scope: 'project'`, every episode under
 * `[E2 Sc 9]` headers - and, with the drawer open, sends the record as
 * `focus` so the model knows who "she" is; the subhead says `Reading all
 * 3 episodes.` and `data-assistant-focus` names the record. A `Scene N`
 * or `E2 Sc 9` in an answer becomes a citation chip, and on `/characters`
 * a link into the script. Project scope is sent on the three record routes
 * - Characters (2026-09-17), Locations (2026-09-18) and, since the Timeline
 * rebuild's phase 5, Timeline, where the turn also carries `timeline: true`
 * so the server adds every scene's story time and the open findings to the
 * system block, and the drawer's scene as the Focus. The widening is per
 * route, and AGENTS.md puts each one behind a question.
 *
 * ## Background runs (roadmap task 4.4)
 *
 * A turn can hand a long task to a background run (`start_background_task`).
 * Its card sits under the answer that started it - live from the
 * `background_run` event, and read back from the stored tool result after a
 * reload - and polls the run every two seconds while it works (ADR 0003 D7).
 * **Open** shows the run's own chat, where its work and its proposals are:
 * the chat is re-read every two seconds while the run works, the composer is
 * off meanwhile (the run's transcript is its own, and the server refuses a
 * turn there with a 409), and when the run waits for its starter the composer
 * sends their reply as the run's continuation instead of a new turn. Once the
 * run is over the chat is an ordinary one.
 */

type Chip = { readonly label: string; readonly tone: 'live' | 'warn' | 'accent' | 'ok' | 'ink3'; readonly kind?: 'report' }

const CHIPS: readonly Chip[] = [
  { label: 'Punch up this scene', tone: 'live' },
  { label: 'Break the act into beats', tone: 'warn' },
  { label: 'Find continuity gaps', tone: 'accent' },
  { label: 'Draft a character from the cue', tone: 'ok' },
  { label: 'What changed since the last revision', tone: 'ink3' },
]

/**
 * The Outline route's chips and subhead - `docs/ui design/Route - Outline
 * v2.dc.html`, verbatim. The copy is the route's; what the model reads is
 * still the episode's script (the 2026-09-16 ruling), so "expand a beat"
 * is answered from the script and the writer's question, not from the
 * outline blocks. Widening the context to the outline is AGENTS.md's "ask
 * first" and is flagged in the phase record, not taken here.
 */
const OUTLINE_CHIPS: readonly Chip[] = [
  { label: 'Expand the synopsis', tone: 'live' },
  { label: 'Split beats into scenes', tone: 'warn' },
  { label: 'Tighten the logline', tone: 'accent' },
  { label: 'Check the act turns', tone: 'ok' },
  { label: 'Suggest a cold open', tone: 'ink3' },
]

/**
 * The Storyboard route's chips and subhead - `docs/ui design/Route -
 * Storyboard v2.dc.html`, verbatim. The same ruling as the Outline's: the
 * copy is the route's, the context is still the script, and a chip is a
 * question typed for the writer - "Auto board Scene 02" asks for coverage in
 * words; the board's own `Auto board` button is what writes proposals.
 */
const STORYBOARD_CHIPS: readonly Chip[] = [
  { label: 'Auto board Scene 02', tone: 'live' },
  { label: 'Suggest coverage for the turn', tone: 'warn' },
  { label: 'Write shot descriptions', tone: 'accent' },
  { label: 'Re-time the sequence', tone: 'ok' },
]

const STORYBOARD_SUBHEAD = 'Ask about the boards, or have me propose coverage for a scene.'

/**
 * The Production route's chips and subhead (v12, 2026-09-22; the spec
 * draws the orb and leaves the panel's copy to the route). The same ruling
 * again: the copy is the route's, the context is the script, and a chip is
 * a question typed for the writer - the board's own `✦ Propose shots` and
 * `✦ AI Shotlist` are what write shots. "Rewrite the refused shot" is also
 * what a refused shot's `Suggest rewrite` asks, with the refusal in the
 * writer's terms (`useEphemeral().assistantPrompt`).
 */
const PRODUCTION_CHIPS: readonly Chip[] = [
  { label: 'Propose shots for this scene', tone: 'accent' },
  { label: 'Tighten this reel to 10 seconds', tone: 'warn' },
  { label: 'Rewrite the refused shot', tone: 'live' },
  { label: 'What does this scene need before it can shoot?', tone: 'ok' },
]

const PRODUCTION_SUBHEAD = 'Ask about this reel, or have me propose shots from the scene.'

/**
 * The Characters route's chips and subhead (the fourth pass, 2026-09-20).
 * The first names the open record when the drawer has one, read from the
 * facts cell the workspace publishes, and is a prompt - the model reads
 * the script and describes the person; the other two are reports the
 * route already counts (`unrelated`, `bio === null`), so the panel answers
 * without a model.
 */
const charactersChips = (facts: CharacterFacts | null): readonly Chip[] => [
  { label: facts?.open == null ? 'Describe a character from the script' : `Describe ${facts.open.name} from the script`, tone: 'accent' },
  { label: 'Who has no relationships yet?', tone: 'warn', kind: 'report' },
  { label: 'Find characters with no description', tone: 'ok', kind: 'report' },
]

const charactersSubhead = (facts: CharacterFacts | null): string =>
  facts?.open == null ? 'Ask about the cast, or have me describe a character from the script.' : `Ask about the cast, or have me describe ${facts.open.name} from the script.`

/**
 * The Locations route's chips and subhead - the v2 mockup's words where
 * they still fit (`Describe a location from its scenes`, `Find locations
 * used only once`), the third re-worded as the report it is.
 */
const LOCATIONS_SUBHEAD = 'Ask about the locations, or have me describe one from its scenes.'

/**
 * Since the Locations rebuild (2026-09-18) the panel can see the drawer's
 * record through the facts cell the workspace publishes
 * (`lib/locations/facts.ts`), so the first chip names it; the other two are
 * reports the route already counts (`oneOffs`, `nightExteriors`).
 */
const locationsChips = (places: LocationFacts | null): readonly Chip[] => [
  { label: places?.open == null ? 'Describe a location from its scenes' : `Describe ${places.open.name} from its scenes`, tone: 'accent' },
  { label: 'Find locations used only once', tone: 'warn', kind: 'report' },
  { label: 'Which sets have night exteriors?', tone: 'ok', kind: 'report' },
]

const locationsSubhead = (places: LocationFacts | null): string =>
  places?.open == null ? LOCATIONS_SUBHEAD : `Ask about the locations, or have me describe ${places.open.name} from its scenes.`

/**
 * The Props route's chips. The first names the drawer's record when one is
 * open, as Characters' and Locations' do; the other two are reports the
 * route already counts from its facts cell (`lib/props/facts.ts`) -
 * arithmetic, no model.
 */
const propsChips = (things: PropFacts | null): readonly Chip[] => [
  { label: things?.open == null ? 'Describe a prop from its scenes' : `Describe ${things.open.name} from its scenes`, tone: 'accent' },
  { label: 'Which props has nobody found yet?', tone: 'warn', kind: 'report' },
  { label: 'Which props does the script never mention?', tone: 'ok', kind: 'report' },
]

const propsSubhead = (things: PropFacts | null): string =>
  things?.open == null
    ? 'Ask about the props, or have me describe one from its scenes.'
    : `Ask about the props, or have me describe ${things.open.name} from its scenes.`

/**
 * The Timeline route's chips (the rebuild, phase 5): three reports the
 * route already computes - the unplaced scenes, why the drawer's scene is
 * flagged, where a thread goes quiet - answered from the facts cell
 * (`lib/timeline/facts.ts`) with no model. The second names the open scene
 * when the drawer has one.
 */
const timelineChips = (times: TimelineFacts | null): readonly Chip[] => [
  { label: times === null || times.unplaced.length === 0 ? 'Which scenes have no story time?' : `Which ${String(times.unplaced.length)} scenes have no story time?`, tone: 'warn', kind: 'report' },
  { label: times?.open == null ? 'Why is this scene flagged?' : `Why is ${formatRef(times.open.ref)} flagged?`, tone: 'accent', kind: 'report' },
  { label: 'Where does a thread go quiet?', tone: 'ok', kind: 'report' },
]

const formatRef = (ref: { readonly episodeOrdinal: number; readonly number: number }): string => `E${String(ref.episodeOrdinal)} Sc ${String(ref.number)}`

const chipsFor = (
  route: WorkspaceRoute | null,
  facts: CharacterFacts | null,
  places: LocationFacts | null,
  times: TimelineFacts | null,
  things: PropFacts | null,
): readonly Chip[] =>
  route === 'outline'
    ? OUTLINE_CHIPS
    : route === 'storyboard'
      ? STORYBOARD_CHIPS
      : route === 'production'
        ? PRODUCTION_CHIPS
        : route === 'characters'
          ? charactersChips(facts)
          : route === 'locations'
            ? locationsChips(places)
            : route === 'props'
              ? propsChips(things)
              : route === 'timeline'
                ? timelineChips(times)
                : CHIPS

const subheadFor = (
  route: WorkspaceRoute | null,
  section: RailSection | null,
  facts: CharacterFacts | null,
  places: LocationFacts | null,
  things: PropFacts | null,
): string =>
  route === 'outline'
    ? OUTLINE_SUBHEAD
    : route === 'storyboard'
      ? STORYBOARD_SUBHEAD
      : route === 'production'
        ? PRODUCTION_SUBHEAD
        : route === 'characters'
          ? charactersSubhead(facts)
          : route === 'locations'
            ? locationsSubhead(places)
            : route === 'props'
              ? propsSubhead(things)
              : SUBHEAD[section ?? 'writing']

/** The project-scoped routes: the panel says what it reads - the whole project on all four. */
const PROJECT_ROUTES: readonly WorkspaceRoute[] = ['characters', 'locations', 'props', 'timeline']

/** The routes the model reads the whole project on: Characters by the 2026-09-17 ruling, Locations by the 2026-09-18 one (with the location records beside the cast), Timeline by the rebuild's phase 5 (with story time and the findings). */
const WHOLE_PROJECT_ROUTES: readonly WorkspaceRoute[] = ['characters', 'locations', 'timeline']

/** A report's answer, printed by the panel: the sentence, its citations, the records it names. */
type Report = {
  readonly id: string
  readonly role: 'report'
  readonly label: string
  readonly sentence: string
  readonly cites: readonly CitationChip[]
  readonly people: readonly { readonly id: string; readonly name: string }[]
  readonly createdAt: string
}

const reportFor = (label: string, facts: CharacterFacts): Omit<Report, 'id' | 'createdAt'> | null => {
  if (label === 'Who has no relationships yet?') {
    const people = facts.unrelated
    return {
      role: 'report',
      label,
      sentence:
        people.length === 0
          ? 'Every character has at least one relationship.'
          : `${String(people.length)} ${people.length === 1 ? 'character has' : 'characters have'} no relationship yet. Drag a card's handle onto another on the Canvas to add one.`,
      cites: [],
      people,
    }
  }
  if (label === 'Find characters with no description') {
    const people = facts.noDescription
    return {
      role: 'report',
      label,
      sentence:
        people.length === 0
          ? 'Every character has a description.'
          : `${String(people.length)} ${people.length === 1 ? 'character has' : 'characters have'} no description.`,
      cites: [],
      people,
    }
  }
  return null
}

/** The Locations route's reports, over the facts its workspace publishes: arithmetic, no model. */
const placeReportFor = (label: string, places: LocationFacts): Omit<Report, 'id' | 'createdAt'> | null => {
  const cite = (ref: LocationFacts['index'][number] | null): readonly CitationChip[] =>
    ref === null ? [] : [citeOf(places.projectId, places.shape, ref)]
  if (label === 'Find locations used only once') {
    const once = places.oneOffs
    return {
      role: 'report',
      label,
      sentence:
        once.length === 0
          ? 'Every place the script names is used more than once.'
          : `${String(once.length)} ${once.length === 1 ? 'place is' : 'places are'} used once: ${once.map((place) => place.name).join(', ')}. A one-off set is a day the schedule pays for one scene.`,
      cites: once.flatMap((place) => cite(place.first)),
      people: [],
    }
  }
  if (label === 'Which sets have night exteriors?') {
    const nights = places.nightExteriors
    return {
      role: 'report',
      label,
      sentence:
        nights.length === 0
          ? 'No heading is an exterior at night.'
          : `${String(nights.length)} ${nights.length === 1 ? 'set has' : 'sets have'} night exteriors: ${nights.map((place) => `${place.name} (${String(place.nights)})`).join(', ')}.`,
      cites: nights.flatMap((place) => cite(place.first)),
      people: [],
    }
  }
  return null
}

/** The Props route's reports, over the facts its workspace publishes: arithmetic, no model. */
const thingReportFor = (label: string, things: PropFacts): Omit<Report, 'id' | 'createdAt'> | null => {
  const cite = (ref: PropFacts['index'][number] | null): readonly CitationChip[] =>
    ref === null ? [] : [citeOf(things.projectId, things.shape, ref)]
  if (label === 'Which props has nobody found yet?') {
    const waiting = things.unsourced
    return {
      role: 'report',
      label,
      sentence:
        waiting.length === 0
          ? 'Every prop is sourced or on set.'
          : `${String(waiting.length)} ${waiting.length === 1 ? 'prop is' : 'props are'} still needed: ${waiting.map((thing) => thing.name).join(', ')}.`,
      cites: waiting.flatMap((thing) => cite(thing.first)),
      people: [],
    }
  }
  if (label === 'Which props does the script never mention?') {
    const quiet = things.unwritten
    return {
      role: 'report',
      label,
      sentence:
        quiet.length === 0
          ? 'Every prop has a line of action that reads as it.'
          : `${String(quiet.length)} ${quiet.length === 1 ? 'prop has' : 'props have'} no line in the script: ${quiet.map((thing) => thing.name).join(', ')}. Either the page has not asked for it yet, or nothing is bound to what the page calls it.`,
      cites: [],
      people: [],
    }
  }
  return null
}

/** The Timeline route's reports, over the facts its workspace publishes: arithmetic, no model. */
const timeReportFor = (label: string, times: TimelineFacts): Omit<Report, 'id' | 'createdAt'> | null => {
  const cite = (ref: TimelineFacts['index'][number]): CitationChip => citeOf(times.projectId, times.shape, ref)
  if (label.startsWith('Which') && label.endsWith('have no story time?')) {
    const unplaced = times.unplaced
    return {
      role: 'report',
      label,
      sentence:
        unplaced.length === 0
          ? 'Every scene has a story time.'
          : `${String(unplaced.length)} ${unplaced.length === 1 ? 'scene has' : 'scenes have'} no story time yet. Open the queue with Place scenes to read a day for each off the page.`,
      cites: unplaced.map(cite),
      people: [],
    }
  }
  if (label.startsWith('Why is') && label.endsWith('flagged?')) {
    const open = times.open
    if (open === null) {
      return { role: 'report', label, sentence: 'Open a scene from the grid first - the drawer is what "this scene" means.', cites: [], people: [] }
    }
    return {
      role: 'report',
      label,
      sentence: open.findings.length === 0 ? `${formatRef(open.ref)} has no open finding.` : open.findings.map((finding) => finding.note).join(' '),
      cites: [cite(open.ref)],
      people: [],
    }
  }
  if (label === 'Where does a thread go quiet?') {
    const quiet = times.quiet
    return {
      role: 'report',
      label,
      sentence: quiet.length === 0 ? 'No thread goes quiet for a whole episode or thirty pages.' : quiet.map((finding) => finding.note).join(' '),
      cites: quiet.map((finding) => cite(finding.ref)),
      people: [],
    }
  }
  return null
}

/**
 * An answer's body with every `Scene N` / `Sc N` turned into a citation chip
 * for the episode the model read - a link into the script where the scene
 * index says the number exists (the Characters route publishes it), a plain
 * chip elsewhere. Presentation only; the text is the model's.
 */
const SCENE_REF = /\b(?:E(\d+)\s+)?(?:Scene|Sc\.?)\s+(\d+)\b/gu

const CitedBody = ({
  body,
  ordinal,
  facts,
  episode,
}: {
  readonly body: string
  readonly ordinal: number | null
  /** The scene index and the address a `Scene N` links with - the Characters or Locations facts cell. */
  readonly facts: Pick<CharacterFacts, 'projectId' | 'shape' | 'index'> | null
  readonly episode: EpisodeSlug
}) => {
  const parts: ReactNode[] = []
  let last = 0
  for (const match of body.matchAll(SCENE_REF)) {
    const index = match.index
    const number = Number(match[2])
    if (index === undefined || Number.isNaN(number)) continue
    parts.push(body.slice(last, index))
    // `E2 Sc 9` names its episode (project scope); a bare `Scene 9` is the read episode's.
    const cited = match[1] === undefined ? null : Number(match[1])
    const citedOrdinal = cited ?? ordinal
    const label = citedOrdinal === null ? match[0] : `E${String(citedOrdinal)} Sc ${String(number)}`
    const ref =
      cited === null
        ? facts?.index.find((entry) => entry.episode === episode && entry.number === number)
        : facts?.index.find((entry) => entry.episodeOrdinal === cited && entry.number === number)
    parts.push(
      ref === undefined || facts === null ? (
        <span key={index} className="folio-cite mx-[2px] align-baseline">
          {label}
        </span>
      ) : (
        <Link
          key={index}
          href={citeOf(facts.projectId, facts.shape, ref).href}
          data-cite-link
          className="folio-cite mx-[2px] align-baseline no-underline hover:border-accent hover:text-accent hover:no-underline"
        >
          {label}
        </Link>
      ),
    )
    last = index + match[0].length
  }
  parts.push(body.slice(last))
  return <>{parts}</>
}

const TONE_CLASS: Record<Chip['tone'], string> = {
  live: 'bg-live',
  warn: 'bg-warn',
  accent: 'bg-accent',
  ok: 'bg-ok',
  ink3: 'bg-ink3',
}

const SUBHEAD: Record<RailSection, string> = {
  writing: 'Ask about the draft, or have me rough out a scene, a beat or a character.',
  characters: 'Ask about the cast, who shares scenes with whom, or a character who needs a record.',
  locations: 'Ask about the sets, what happens where, or a slugline that needs a home.',
  props: 'Ask about the props, what the page says about one, or what a scene needs on the table.',
  timeline: 'Ask how the story sits in time, or where a thread goes quiet.',
  research: 'Ask about the draft. Research sources are not readable yet.',
  production: 'Ask about the shots and reels, or what a scene needs to shoot.',
}

const OUTLINE_SUBHEAD = 'Ask about the outline, or have me expand a beat, a synopsis or an act turn.'

/** A tool call as the answer shows it: a status line, its summary the tool's own (roadmap task 2.3). */
type ToolLine = {
  readonly id: string
  readonly label: string
  readonly state: 'running' | 'done' | 'failed'
  readonly summary: string | null
}

/** A download event's file, saved as a Blob through a transient link - how exports reach the writer (ruling R2). */
const saveFile = (filename: string, mime: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/** A proposal the answer made (roadmap task 3.3); `auto` is the writer's autonomy letting the card apply it at once. */
type ProposalLine = { readonly id: string; readonly auto: boolean }

type Turn =
  | (Omit<MessageRow, 'proposals'> & { readonly tools?: readonly ToolLine[]; readonly proposals?: readonly ProposalLine[] })
  | {
      readonly id: 'pending'
      readonly role: 'assistant'
      readonly body: string
      readonly createdAt: ''
      readonly tools: readonly ToolLine[]
      readonly proposals: readonly ProposalLine[]
      readonly runs: readonly RunStarted[]
    }
  | Report

/** Stored turns, with the proposals read back from their tool results - a reloaded card never applies itself. */
const turnsOf = (rows: readonly MessageRow[]): readonly Turn[] =>
  rows.map(({ proposals, ...row }) => (proposals === undefined ? row : { ...row, proposals: proposals.map((id) => ({ id, auto: false })) }))

export const AssistantPanel = ({
  projectId,
  episode,
  episodeCount,
  reading,
  section,
  route,
  connected,
  inFlow,
  hidden,
  onClose,
}: {
  readonly projectId: ProjectId
  readonly episode: EpisodeSlug
  /** How many episodes the project has - `Reading all 3 episodes.` on Characters. */
  readonly episodeCount: number
  /** The read episode's label (`Episode 2 · Standpipe`), for the project-scoped routes' subhead. */
  readonly reading: string | null
  readonly section: RailSection | null
  /** The route under the section, when the URL names one: the Outline has its own copy. */
  readonly route: WorkspaceRoute | null
  readonly connected: boolean
  readonly inFlow: boolean
  /** Closed: drawn `hidden`, never unmounted, so the conversation and a running answer survive. */
  readonly hidden: boolean
  readonly onClose: () => void
}) => {
  const [chats, setChats] = useState<readonly ChatRow[]>([])
  const [chat, setChat] = useState<ChatRow | null>(null)
  const [turns, setTurns] = useState<readonly Turn[]>([])
  const draft = useSession((state) => state.assistantDraft)
  const setDraft = useSession((state) => state.setAssistantDraft)
  const setStoredChat = useSession((state) => state.setAssistantChat)
  const chatKey = assistantChatKey(projectId, episode)
  const storedChat = useSession((state) => state.assistantChats[chatKey] ?? null)
  /** The chat whose turns are on screen, so the effect below reloads only what changed. */
  const shown = useRef<string | null>(null)
  /** The project the shown chat belongs to. */
  const shownProject = useRef<string | null>(null)
  /**
   * The episode the open chat belongs to - the one a turn is asked about. It
   * can differ from `episode` (the page's) once the writer, or the agent's
   * `navigate`, has moved to another episode with the conversation open.
   */
  const [chatEpisode, setChatEpisode] = useState<EpisodeSlug | null>(null)
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** The background run the open chat belongs to, when it is one's (roadmap task 4.4). */
  const [chatRun, setChatRun] = useState<RunView | null>(null)
  const [listOpen, setListOpen] = useState(false)
  /** `Chat · History` (roadmap task 5.4): client state, like every switch in a panel. History lists the project's runs. */
  const [tab, setTab] = useState<'chat' | 'history'>('chat')
  const scroller = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const abort = useRef<AbortController | null>(null)
  const { assistantPrompt, setAssistantPrompt, assistantFocus, assistantSelection } = useEphemeral()
  const facts = useCharacterFacts()
  const places = useLocationFacts()
  const things = usePropFacts()
  const times = useTimelineFacts()
  const routeFacts = route === 'characters' ? facts : route === 'locations' ? places : route === 'props' ? things : route === 'timeline' ? times : null
  const readOrdinal = routeFacts?.episodes.find((entry) => entry.slug === episode)?.ordinal ?? null
  const projectScoped = route !== null && PROJECT_ROUTES.includes(route)
  const wholeProject = route !== null && WHOLE_PROJECT_ROUTES.includes(route)
  const focus =
    wholeProject &&
    assistantFocus !== null &&
    ((route === 'characters' && assistantFocus.kind === 'character') || (route === 'locations' && assistantFocus.kind === 'location') || (route === 'timeline' && assistantFocus.kind === 'scene'))
      ? assistantFocus
      : null

  // The editor selection (roadmap task 2.6), sent only from the editor it came from.
  const selection =
    assistantSelection !== null && ((route === 'script' && assistantSelection.kind === 'script') || (route === 'outline' && assistantSelection.kind === 'outline'))
      ? assistantSelection
      : null

  // A route handed a question in (Production's `Suggest rewrite`): it becomes the draft, once.
  useEffect(() => {
    if (assistantPrompt === null) return
    setDraft(assistantPrompt)
    setAssistantPrompt(null)
    composer.current?.focus()
  }, [assistantPrompt, setAssistantPrompt])

  useEffect(() => {
    let cancelled = false
    void listAssistantChats(projectId, episode).then((result) => {
      if (cancelled || result.status !== 'ok') return
      setChats(result.chats)
    })
    return () => {
      cancelled = true
    }
  }, [episode, projectId])

  // The episode the panel reads changed (another route, another project), or
  // the tab was reloaded: show the chat the store remembers for it, re-read
  // from the server - which re-checks it - or an empty chat when there is none.
  //
  // Within one project an open conversation stays open across episodes
  // (roadmap task 2.5): moving to another episode's page - the writer's click
  // or the agent's `navigate` - is no reason to lose the answer being read.
  // A new project, or no open chat, is what reads the store again.
  useEffect(() => {
    const sameProject = shownProject.current === projectId
    shownProject.current = projectId
    if (sameProject && shown.current !== null) return
    if (storedChat === shown.current) return
    shown.current = storedChat
    if (storedChat === null) {
      setChat(null)
      setChatEpisode(null)
      setTurns([])
      setChatRun(null)
      return
    }
    let cancelled = false
    void openAssistantChat(projectId, episode, storedChat).then((result) => {
      if (cancelled || shown.current !== storedChat) return
      if (result.status !== 'ok') {
        shown.current = null
        setStoredChat(chatKey, null)
        setChat(null)
        setChatEpisode(null)
        setTurns([])
        setChatRun(null)
        return
      }
      setChat(result.chat)
      setChatEpisode(episode)
      setTurns(turnsOf(result.messages))
      setChatRun(result.run ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [chatKey, episode, projectId, setStoredChat, storedChat])

  useEffect(() => {
    const node = scroller.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [turns])

  useEffect(
    () => () => {
      abort.current?.abort()
    },
    [],
  )

  /** Show a chat - one from the list (the page's episode), or a background run's (the episode of the chat that started it). */
  const open = useCallback(
    async (chatId: string, about: EpisodeSlug = episode) => {
      setListOpen(false)
      const result = await openAssistantChat(projectId, about, chatId)
      if (result.status !== 'ok') {
        setNotice(result.message)
        return
      }
      shown.current = result.chat.id
      setStoredChat(chatKey, result.chat.id)
      setChat(result.chat)
      setChatEpisode(about)
      setTurns(turnsOf(result.messages))
      setChatRun(result.run ?? null)
      setNotice(null)
    },
    [chatKey, episode, projectId, setStoredChat],
  )

  /** A run card's Open: the run's own chat. */
  const openRun = useCallback(
    (chatId: string) => {
      void open(chatId, chatEpisode ?? episode)
    },
    [chatEpisode, episode, open],
  )

  // The open chat is a background run's and the run is working: re-read the chat every two seconds (D7).
  const runLive = chat !== null && chatRun !== null && isLiveRun(chatRun.status)
  useLivePoll(runLive, async () => {
    if (chat === null) return
    const id = chat.id
    const result = await openAssistantChat(projectId, chatEpisode ?? episode, id)
    if (result.status !== 'ok' || shown.current !== id) return
    setTurns(turnsOf(result.messages))
    setChatRun(result.run ?? null)
  })
  /** The run waits for its starter, who is the one reading: the composer replies to it. */
  const replying = chatRun !== null && chatRun.status === 'waiting_for_user' && chatRun.mine
  /** It waits at a story checkpoint: only the card's Approve carries on, so an empty reply sends nothing. */
  const atCheckpoint = replying && chatRun.checkpoint !== null
  /** The run waits, but for someone else: only its starter may reply (it acts as them). */
  const notMine = chatRun !== null && chatRun.status === 'waiting_for_user' && !chatRun.mine

  const fresh = useCallback(() => {
    setListOpen(false)
    shown.current = null
    setStoredChat(chatKey, null)
    setChat(null)
    setChatEpisode(null)
    setTurns([])
    setChatRun(null)
    setNotice(null)
    composer.current?.focus()
  }, [chatKey, setStoredChat])

  /** Ask. `override` is a message that did not come from the composer - the launcher's story. */
  const send = useCallback(async (override?: string) => {
    const message = (override ?? draft).trim()
    if (busy || runLive) return
    // A background run waiting for its starter (roadmap task 4.4): the reply is its continuation, not a turn.
    if (chat !== null && chatRun !== null && replying) {
      // An empty reply at a checkpoint is not an approval: nothing happens.
      if (message.length === 0 && chatRun.checkpoint !== null) return
      setBusy(true)
      setNotice(null)
      setDraft('')
      const stamp = new Date().toISOString()
      const result = await continueBackgroundRunAction(projectId, chatRun.id, message)
      setBusy(false)
      if (result.status !== 'ok') {
        setNotice(result.message)
        setDraft(message)
        return
      }
      setTurns((existing) => [...existing, { id: `user:${stamp}`, role: 'user', body: message.length === 0 ? 'Carry on.' : message, createdAt: stamp }])
      setChatRun(result.run)
      return
    }
    if (message.length === 0 || !connected) return
    setBusy(true)
    setNotice(null)
    let current = chat
    // A turn is about the open chat's episode; a new chat is about the page's.
    let askEpisode = chatEpisode ?? episode
    if (current === null) {
      const started = await startAssistantChat(projectId, episode)
      if (started.status !== 'ok') {
        setNotice(started.message)
        setBusy(false)
        return
      }
      current = started.chat
      askEpisode = episode
      setChatRun(null)
      shown.current = current.id
      setStoredChat(chatKey, current.id)
      setChat(current)
      setChatEpisode(episode)
      setChats((existing) => [started.chat, ...existing])
    }
    const chatId = current.id
    const stamp = new Date().toISOString()
    setDraft('')
    setTurns((existing) => [
      ...existing,
      { id: `user:${stamp}`, role: 'user', body: message, createdAt: stamp },
      { id: 'pending', role: 'assistant', body: '', createdAt: '', tools: [], proposals: [], runs: [] },
    ])
    const controller = new AbortController()
    abort.current = controller
    try {
      const request: AskRequest = {
        projectId,
        episode: askEpisode,
        chatId,
        message,
        scope: wholeProject ? 'project' : 'episode',
        ...(route === null ? {} : { route }),
        ...(selection === null ? {} : { selection: { kind: selection.kind, nodeIds: [...selection.nodeIds] } }),
        ...(focus === null ? {} : { focus: { kind: focus.kind, id: focus.id } }),
        ...(route === 'locations' ? { places: true } : {}),
        ...(route === 'timeline' ? { timeline: true } : {}),
      }
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      })
      if (!response.ok || response.body === null) {
        const failed = (await response.json().catch(() => null)) as { readonly message?: string } | null
        throw new Error(failed?.message ?? 'The assistant could not answer.')
      }
      // One `AgentEvent` per line (roadmap task 2.3): text is the answer as
      // before; a tool call is a status line under it, its summary computed
      // by the tool, never the model's words.
      let answer = ''
      let tools: readonly ToolLine[] = []
      let proposals: readonly ProposalLine[] = []
      let runs: readonly RunStarted[] = []
      const show = (): void => {
        const body = answer
        const lines = tools
        const made = proposals
        const started = runs
        setTurns((existing) => existing.map((turn) => (turn.id === 'pending' ? { ...turn, body, tools: lines, proposals: made, runs: started } : turn)))
      }
      await readAgentStream(response.body, (event) => {
        switch (event.type) {
          case 'text':
            answer += event.text
            show()
            return
          case 'tool_started':
            tools = [...tools, { id: event.id, label: event.label, state: 'running', summary: null }]
            show()
            return
          case 'tool_finished':
            tools = tools.map((line) => (line.id === event.id ? { ...line, state: event.ok ? 'done' : 'failed', summary: event.summary } : line))
            show()
            return
          // A write (roadmap task 3.3): a card the writer reviews, or - under
          // `auto`, and never for a confirmation - one that applies itself.
          case 'proposal':
            if (!proposals.some((line) => line.id === event.proposalId)) {
              proposals = [...proposals, { id: event.proposalId, auto: event.auto && !event.needsConfirmation }]
              show()
            }
            return
          // A background run started (roadmap task 4.4): its card, under this answer.
          case 'background_run':
            if (!runs.some((run) => run.runId === event.runId)) {
              runs = [...runs, { runId: event.runId, chatId: event.chatId, title: event.title }]
              show()
            }
            return
          case 'error':
            setNotice(event.message)
            return
          // The client half of the read tools (roadmap task 2.5): a place the
          // server resolved, built into a URL by `hrefs.ts` alone; a re-read
          // of the server components; a file the writer could have clicked.
          case 'navigate':
            router.push(asRoute(hrefOfTarget(event.target)))
            return
          case 'refresh':
            router.refresh()
            return
          case 'download':
            if (event.encoding === 'base64') saveBase64File(event.filename, event.mime, event.text)
            else saveFile(event.filename, event.mime, event.text)
            return
          default:
            return
        }
      })
      const finished = answer
      const lines = tools
      const made = proposals
      const started = runs
      setTurns((existing) =>
        existing.flatMap((turn): Turn[] => {
          if (turn.id !== 'pending') return [turn]
          // A turn that said nothing and called nothing leaves no row behind.
          if (finished.length === 0 && lines.length === 0) return []
          return [{ id: `assistant:${stamp}`, role: 'assistant', body: finished, createdAt: new Date().toISOString(), tools: lines, proposals: made, runs: started }]
        }),
      )
      setChats((existing) =>
        existing.map((row) => (row.id === chatId && row.title === null ? { ...row, title: message.split('\n')[0] ?? message } : row)),
      )
      setChat((existing) => (existing !== null && existing.title === null ? { ...existing, title: message.split('\n')[0] ?? message } : existing))
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setNotice(cause instanceof Error ? cause.message : 'The assistant could not answer.')
        setTurns((existing) => existing.filter((turn) => turn.id !== 'pending'))
      }
    } finally {
      abort.current = null
      setBusy(false)
    }
  }, [busy, chat, chatEpisode, chatKey, chatRun, connected, draft, episode, focus, projectId, replying, route, router, runLive, selection, setDraft, setStoredChat, wholeProject])

  // The launcher's "Start from a story" (roadmap task 3.6, ADR 0003 D15): the
  // story it was given becomes this project's first message, sent once. With
  // no assistant connected it waits in the composer instead.
  const pending = useSession((state) => state.assistantPending)
  const setPending = useSession((state) => state.setAssistantPending)
  const sendRef = useRef(send)
  sendRef.current = send
  useEffect(() => {
    if (pending === null || pending.projectId !== projectId || hidden || busy) return
    setPending(null)
    if (connected) void sendRef.current(pending.message)
    else setDraft(pending.message)
  }, [busy, connected, hidden, pending, projectId, setDraft, setPending])

  const empty = turns.length === 0

  return (
    <aside
      data-assistant-panel
      data-in-flow={inFlow ? 'true' : 'false'}
      data-assistant-scope={wholeProject ? 'project' : 'episode'}
      data-assistant-focus={focus === null ? undefined : focus.id}
      aria-label="Assistant"
      hidden={hidden}
      className={`folio-assistant-panel ${inFlow ? 'relative' : 'absolute inset-y-0 right-0'} z-[3] ${hidden ? 'hidden' : 'flex'} flex-none flex-col`}
    >
      <div className="flex h-[60px] flex-none items-center gap-[8px] pl-[16px] pr-[12px]">
        <Orb size={20} />
        <div className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={listOpen}
            onClick={() => {
              setListOpen((value) => !value)
            }}
            className="folio-ghost-button flex items-center gap-[6px] rounded-[8px] px-[8px] py-[5px] text-13-5 font-medium text-ink"
          >
            <span className="max-w-[200px] truncate">{chat?.title ?? 'New chat'}</span>
            <Icon name="chevron" size={11} strokeWidth={1.5} className="opacity-50" />
          </button>
          {listOpen ? (
            <div role="menu" data-chat-list className="folio-menu absolute left-0 top-[34px] w-[280px]">
              <button type="button" role="menuitem" className="folio-menu-item" onClick={fresh}>
                New chat
              </button>
              {chats.length === 0 ? (
                <p className="m-0 px-[10px] pb-[6px] pt-[4px] text-12 text-ink3">No chats on this episode yet.</p>
              ) : (
                chats.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    role="menuitem"
                    className="folio-menu-item"
                    aria-current={chat?.id === row.id ? 'true' : undefined}
                    onClick={() => {
                      void open(row.id)
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{row.title ?? 'Untitled chat'}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
        <div className="flex-1" />
        <div role="tablist" aria-label="Assistant view" className="flex items-center gap-[2px] rounded-pill border border-line2 bg-s1 p-[2px]">
          {(['chat', 'history'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              data-panel-tab={value}
              aria-selected={tab === value ? 'true' : 'false'}
              onClick={() => {
                setTab(value)
              }}
              className={`rounded-pill px-[9px] py-[3px] text-12 ${tab === value ? 'bg-s2 text-ink' : 'text-ink3'}`}
            >
              {value === 'chat' ? 'Chat' : 'History'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setTab('chat')
            fresh()
          }}
          className="folio-ghost-button rounded-[8px] px-[10px] py-[6px] text-12-5 text-ink2"
        >
          + New
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close the assistant"
          className="folio-ghost-button grid h-[28px] w-[28px] place-items-center rounded-[8px] text-ink3"
        >
          <Icon name="close" size={14} strokeWidth={1.5} />
        </button>
      </div>

      {tab === 'history' ? (
        <RunHistory
          projectId={projectId}
          onOpenChat={(chatId, about) => {
            setTab('chat')
            void open(chatId, about ?? episode)
          }}
        />
      ) : (
      <>
      {empty ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[16px] px-[28px] py-[20px]">
          <Orb size={124} drift />
          <div className="flex flex-col gap-[7px] text-center">
            <span className="text-17 font-medium tracking-title">How can I help?</span>
            <span className="text-13-5 leading-[1.55] text-ink2">
              {wholeProject ? (
                <span data-assistant-reading>Reading {episodeCount === 1 ? 'the script' : `all ${String(episodeCount)} episodes`}. </span>
              ) : projectScoped && reading !== null ? (
                <span data-assistant-reading>Reading {reading}. </span>
              ) : null}
              {subheadFor(route, section, facts, places, things)}
            </span>
          </div>
        </div>
      ) : (
        <div ref={scroller} data-assistant-turns className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto px-[16px] py-[16px]">
          {turns.map((turn) =>
            turn.role === 'report' ? (
              <div key={turn.id} data-turn="report" data-report-note className="flex flex-col gap-[6px] rounded-[12px] border border-line2 bg-s1 px-[12px] py-[10px]">
                <span className="flex items-center gap-[8px]">
                  <span className="folio-cite">report · no model</span>
                  <span className="min-w-0 truncate text-11 text-ink3">{turn.label}</span>
                </span>
                <span className="text-13-5 leading-[1.6] text-read" style={{ textWrap: 'pretty' }}>
                  {turn.sentence}
                </span>
                {turn.people.length === 0 ? null : (
                  <span className="flex flex-wrap items-center gap-[4px]">
                    {turn.people.map((person) => (
                      <Link
                        key={person.id}
                        href={characterHref(projectId, person.id)}
                        className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline"
                      >
                        {person.name}
                      </Link>
                    ))}
                  </span>
                )}
                {turn.cites.length === 0 ? null : <CitationChips refs={turn.cites} />}
              </div>
            ) : (
              <div
                key={turn.id}
                data-turn={turn.role}
                className={
                  turn.role === 'user'
                    ? 'max-w-[86%] self-end whitespace-pre-wrap rounded-[14px] rounded-br-[4px] bg-s2 px-[12px] py-[8px] text-13-5 leading-[1.55] text-ink'
                    : 'whitespace-pre-wrap text-13-5 leading-[1.65] text-read'
                }
              >
                {turn.role === 'assistant' && turn.tools !== undefined && turn.tools.length > 0 ? (
                  <span data-tool-lines className="mb-[6px] flex flex-col gap-[2px] whitespace-normal">
                    {turn.tools.map((line) => (
                      <span key={line.id} data-tool-line={line.state} className="flex items-center gap-[6px] font-mono text-11 leading-[1.5] text-ink3">
                        <span
                          aria-hidden="true"
                          className={`h-[5px] w-[5px] flex-none rounded-full ${line.state === 'failed' ? 'bg-live' : line.state === 'done' ? 'bg-ok' : 'bg-ink3'}`}
                        />
                        <span className="min-w-0 truncate">
                          {line.label}
                          {line.summary === null ? '…' : ` · ${line.summary}`}
                        </span>
                      </span>
                    ))}
                  </span>
                ) : null}
                {turn.body.length === 0 && turn.id === 'pending' ? (
                  <span className="folio-thinking">Thinking</span>
                ) : turn.role === 'assistant' ? (
                  <CitedBody body={turn.body} ordinal={readOrdinal} facts={routeFacts} episode={episode} />
                ) : (
                  turn.body
                )}
                {turn.role === 'assistant' && turn.proposals !== undefined && turn.proposals.length > 0 ? (
                  <div data-proposals className="mt-[8px] flex flex-col gap-[8px] whitespace-normal">
                    {turn.proposals.map((proposal) => (
                      <ProposalCard key={proposal.id} projectId={projectId} proposalId={proposal.id} auto={proposal.auto} onOpenRun={openRun} />
                    ))}
                  </div>
                ) : null}
                {turn.role === 'assistant' && turn.runs !== undefined && turn.runs.length > 0 ? (
                  <div data-runs className="mt-[8px] flex flex-col gap-[8px] whitespace-normal">
                    {turn.runs.map((run) => (
                      <RunCard key={run.runId} projectId={projectId} runId={run.runId} title={run.title} onOpen={openRun} />
                    ))}
                  </div>
                ) : null}
              </div>
            ),
          )}
        </div>
      )}

      {empty ? (
        <div className="flex flex-none flex-col items-start gap-[7px] px-[20px] pb-[14px]">
          {chipsFor(route, facts, places, times, things).map((chip) => (
            <button
              key={chip.label}
              type="button"
              className="folio-chip-button"
              data-chip-kind={chip.kind ?? 'ask'}
              onClick={() => {
                if (chip.kind === 'report' && routeFacts !== null) {
                  const report =
                    route === 'locations' && places !== null
                      ? placeReportFor(chip.label, places)
                      : route === 'props' && things !== null
                        ? thingReportFor(chip.label, things)
                        : route === 'timeline' && times !== null
                          ? timeReportFor(chip.label, times)
                          : facts === null
                            ? null
                            : reportFor(chip.label, facts)
                  if (report !== null) {
                    const stamp = new Date().toISOString()
                    setTurns((existing) => [...existing, { ...report, id: `report:${stamp}`, createdAt: stamp }])
                    return
                  }
                }
                setDraft(chip.label)
                composer.current?.focus()
              }}
            >
              <span className={`h-[7px] w-[7px] flex-none rounded-[2px] ${TONE_CLASS[chip.tone]}`} />
              {chip.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex-none px-[16px] pb-[16px]">
        {chat === null || chatRun === null ? null : (
          <div data-chat-run className="mb-[10px]">
            <RunCard projectId={projectId} runId={chatRun.id} title={chatRun.title} run={chatRun} onChange={setChatRun} />
          </div>
        )}
        {notice === null ? null : (
          <p role="status" className="m-0 mb-[8px] text-12 text-live">
            {notice}
          </p>
        )}
        {connected ? null : (
          <p role="status" data-assistant-disconnected className="m-0 mb-[8px] text-12 leading-[1.5] text-ink3">
            The assistant is not connected. Set <span className="font-mono">ANTHROPIC_API_KEY</span> on the server to switch it on.
          </p>
        )}
        <div className="flex flex-col gap-[10px] rounded-panel border border-line bg-s1 px-[14px] pb-[10px] pt-[12px]">
          <textarea
            ref={composer}
            value={draft}
            rows={1}
            disabled={busy || runLive || notMine || (!connected && !replying)}
            placeholder={
              runLive
                ? 'The run is working. You can leave - it carries on.'
                : atCheckpoint
                  ? 'Say what to change, or press Approve on the run…'
                  : replying
                    ? 'Reply to the run, or leave it empty to carry on…'
                    : notMine
                      ? 'Only the person who started this run can reply to it.'
                      : 'Ask, or @ to add context…'
            }
            aria-label="Ask the assistant"
            onChange={(event) => {
              setDraft(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            className="folio-composer"
          />
          <div className="flex items-center gap-[8px]">
            <button
              type="button"
              disabled
              title="Attachments are not built yet"
              className="grid h-[30px] w-[30px] cursor-default place-items-center rounded-full border border-line2 bg-transparent text-15 leading-none text-ink3 opacity-60"
            >
              +
            </button>
            <div className="flex-1" />
            <button
              type="button"
              disabled
              title="Dictation is not built yet"
              className="grid h-[30px] w-[30px] cursor-default place-items-center rounded-full border-none bg-transparent text-ink3 opacity-60"
            >
              <Icon name="mic" size={15} strokeWidth={1.4} />
            </button>
            <button
              type="button"
              title="Send"
              aria-label="Send"
              disabled={busy || runLive || notMine || (replying && !atCheckpoint ? false : (!connected && !replying) || draft.trim().length === 0)}
              onClick={() => {
                void send()
              }}
              className="folio-solid-button grid h-[30px] w-[30px] place-items-center rounded-full p-0"
            >
              <Icon name="send" size={15} strokeWidth={1.6} />
            </button>
          </div>
        </div>
      </div>
      </>
      )}
    </aside>
  )
}
