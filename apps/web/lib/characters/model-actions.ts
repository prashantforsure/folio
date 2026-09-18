'use server'

import type { DraftField, SceneRef } from '@folio/contracts'
import { CharacterFindingIdSchema, CharacterFindingStatusSchema, CharacterIdSchema, DRAFT_FIELD_LABELS, DraftFieldSchema } from '@folio/contracts'
import {
  listBoundCues,
  listCharacterFindings,
  listCharacterRecords,
  listSceneIndex,
  readMentionLabels,
  readProjectScreenplayByEpisode,
  replaceOpenFindings,
  setFindingStatus,
} from '@folio/db'
import type { ProjectScope } from '@folio/db'
import type { NodeId } from '@folio/script'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'

import { sliceScenes } from '../assistant/context'
import type { SceneText } from '../assistant/context'
import { ASSISTANT_MODEL, CHECK_MAX_TOKENS, DRAFT_MAX_CHARS, DRAFT_MAX_TOKENS, EVIDENCE_CHAR_CAP, FINDINGS_MAX, MODEL_ACTION_TIMEOUT_MS } from '../assistant/model'
import { assistantClient } from '../assistant/server'
import { isRefusal, openProject } from '../script/gate'
import { DraftOutputSchema, FindingsOutputSchema, claimHash, evidenceFor, validateDraft, validateFindings } from './evidence'
import { sceneRefOf } from './figures'
import type { CheckResult, DraftResult, FindingResult } from './result'
import { findingOf } from './server'

/**
 * The Characters route's two model actions, and the verdict on a finding.
 * The one Characters module that reaches the SDK (through
 * `lib/assistant/server.ts`'s `assistantClient`; the key never comes here).
 *
 * ## What the model is asked, and what it may do
 *
 * `draftField` asks for two or three sentences about one character, from
 * the scenes they are in, citing them - and **writes nothing**: the draft
 * lands in the drawer's unsaved field and the writer keeps it with the
 * existing Save, or not. `checkContradictions` asks for pairs of quotes
 * that cannot both be true of the character and keeps the ones that quote
 * the page (`replaceOpenFindings`); the writer's `It's deliberate` is
 * `setFindingVerdict`. AGENTS.md, The AI agent: every write returns a
 * proposal - a draft is a proposal into a field, a finding is a proposal
 * the writer waves through or not.
 *
 * ## The gates, in order
 *
 * Parse - the assistant connected - the project gate - the record live -
 * **on the page** (an off-page record has no scenes to draft from; refused
 * before any model call) - evidence non-empty - the cap - the call - the
 * answer validated (cite-or-drop) - the write. Every refusal is a sentence
 * in the writer's terms; a model error is one too, never a throw across
 * the boundary.
 *
 * ## Cost
 *
 * No price, no ledger row - the assistant send button's standing, open
 * decision 13 (`docs/build-decisions.md`, "Open, and blocking"). A rate
 * limit belongs with that decision and is not built.
 *
 * No `revalidatePath` on either model action: the drawer holds the draft
 * and the findings as state, and a router refresh under an unsaved draft
 * would race it.
 */

const NOT_CONNECTED = 'The assistant is not connected. Set ANTHROPIC_API_KEY on the server.'
const REFUSED_CHARACTER = 'That character could not be found.'
const NOTHING_TO_DRAFT = 'Nothing on the page to draft from.'
const NOTHING_TO_CHECK = 'Nothing on the page to check.'

const GUIDE: Readonly<Record<DraftField, string>> = {
  bio: 'who they are as the script shows them - what they do, how they carry themselves, what the other characters make of them',
  wants: 'what they are trying to get in this draft - the thing they act towards on the page',
  needs: 'what they actually need, whether or not they know it - the lack the story is working on',
}

const evidenceBlock = (name: string, cues: readonly string[], evidence: string): string =>
  `The scenes ${name} is in, from the writer's screenplay, in script order. ${name} is cued as: ${cues.join(', ')}. Each scene starts with its reference in brackets, "[E1 Sc 4]", then its heading; cite a scene by that reference exactly.\n\n${evidence}`

const draftTask = (name: string, field: DraftField): string =>
  `You are the writing assistant inside Folio, a screenwriting workspace. Write ${name}'s ${DRAFT_FIELD_LABELS[field]}: ${GUIDE[field]}.
- Two or three sentences at most, plain and specific, in the writer's language. No headings, no bullets.
- Every claim comes from a scene you were given. Put the references you drew on in refs, exactly as they appear in the headers ("E1 Sc 4"). At least one.
- If the scenes do not show enough to say anything, return an empty text and no refs. Do not guess.
- Do not describe the scenes; describe the person.
- Match the script's language.`

const checkTask = (name: string): string =>
  `You are the writing assistant inside Folio, a screenwriting workspace, checking one character for contradictions inside the writer's own script - the script against itself, never against notes or a bible. The character is ${name}.
For each contradiction: claim - one sentence saying what the two lines cannot both mean; a and b - the two scenes (their references exactly as the headers write them, "E1 Sc 4") and a short quote from each, copied character for character from the page. Copy; never paraphrase.
- Only contradictions the quotes prove. A change over time is not a contradiction. A character lying is not a contradiction unless the script treats it as fact both ways. If you are not sure, leave it out.
- An empty list is a good answer.
- At most eight, the strongest first.`

type Gathered = {
  readonly scope: ProjectScope
  readonly name: string
  readonly cues: readonly string[]
  readonly sceneIds: readonly NodeId[]
  readonly scenes: ReadonlyMap<NodeId, SceneText>
  readonly refs: ReadonlyMap<string, SceneRef>
}

/** The record, its cues and the text of every scene it is in - or a refusal in the writer's terms. */
const gather = async (projectId: string, rawId: string): Promise<Gathered | { readonly status: 'refused' | 'error' | 'nothing'; readonly message: string }> => {
  const id = CharacterIdSchema.safeParse(rawId)
  if (!id.success) return { status: 'error', message: REFUSED_CHARACTER }
  if (assistantClient() === null) return { status: 'refused', message: NOT_CONNECTED }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const { scope } = gate
  const [records, bound] = await Promise.all([listCharacterRecords(scope), listBoundCues(scope)])
  const record = records.find((entry) => entry.id === id.data)
  if (record === undefined) return { status: 'error', message: REFUSED_CHARACTER }
  const sceneIds = record.derived?.scenes ?? []
  if (record.derived === null || record.derived.presence !== 'present' || sceneIds.length === 0) {
    return { status: 'nothing', message: NOTHING_TO_DRAFT }
  }
  const [runs, sceneRows, labels] = await Promise.all([readProjectScreenplayByEpisode(scope), listSceneIndex(scope), readMentionLabels(scope)])
  if (!runs.ok) return { status: 'error', message: 'The script could not be read.' }
  const index = sceneRows.map(sceneRefOf)
  const scenes = sliceScenes(
    runs.value.map((run) => ({ ordinal: run.ordinal, title: run.title, nodes: run.nodes })),
    labels,
    index,
  )
  return {
    scope,
    name: record.name,
    cues: bound.filter((entry) => entry.characterId === record.id).map((entry) => entry.cue),
    sceneIds,
    scenes,
    refs: new Map(index.map((ref) => [`E${String(ref.episodeOrdinal)} Sc ${String(ref.number)}`, ref])),
  }
}

const isGathered = (value: Gathered | { readonly status: string }): value is Gathered => 'scope' in value

/** A model failure in the writer's terms. */
const failed = (cause: unknown): { readonly status: 'error'; readonly message: string } => {
  if (cause instanceof Anthropic.RateLimitError) return { status: 'error', message: 'The assistant is busy. Try again in a minute.' }
  if (cause instanceof Anthropic.APIError) return { status: 'error', message: `The assistant could not answer (${String(cause.status)}).` }
  return { status: 'error', message: 'The assistant could not answer.' }
}

export const draftField = async (projectId: string, rawId: string, rawField: unknown): Promise<DraftResult> => {
  const field = DraftFieldSchema.safeParse(rawField)
  if (!field.success) return { status: 'error', message: 'That field cannot be drafted.' }
  const gathered = await gather(projectId, rawId)
  if (!isGathered(gathered)) return gathered.status === 'nothing' ? { status: 'nothing', message: NOTHING_TO_DRAFT } : gathered
  const evidence = evidenceFor(gathered.sceneIds, gathered.scenes, EVIDENCE_CHAR_CAP)
  if (evidence.shown === 0) return { status: 'nothing', message: NOTHING_TO_DRAFT }
  const anthropic = assistantClient()
  if (anthropic === null) return { status: 'refused', message: NOT_CONNECTED }

  try {
    const response = await anthropic.messages.parse(
      {
        model: ASSISTANT_MODEL,
        max_tokens: DRAFT_MAX_TOKENS,
        system: [
          { type: 'text', text: evidenceBlock(gathered.name, gathered.cues, evidence.text), cache_control: { type: 'ephemeral' } },
          { type: 'text', text: draftTask(gathered.name, field.data) },
        ],
        messages: [{ role: 'user', content: `Write ${gathered.name}'s ${DRAFT_FIELD_LABELS[field.data]} from the scenes above.` }],
        output_config: { format: zodOutputFormat(DraftOutputSchema) },
      },
      { timeout: MODEL_ACTION_TIMEOUT_MS, maxRetries: 1 },
    )
    if (response.stop_reason === 'refusal') return { status: 'error', message: 'The assistant declined this one.' }
    if (response.stop_reason === 'max_tokens') return { status: 'error', message: 'The answer ran long and was cut. Try again.' }
    if (response.parsed_output === null) return { status: 'error', message: 'The assistant answered in a shape Folio could not read.' }
    const checked = validateDraft(response.parsed_output, [...evidence.labels], DRAFT_MAX_CHARS)
    if (!checked.ok) return { status: 'nothing', message: NOTHING_TO_DRAFT }
    return {
      status: 'drafted',
      field: field.data,
      text: checked.text,
      refs: checked.refs.flatMap((label) => {
        const ref = gathered.refs.get(label)
        return ref === undefined ? [] : [ref]
      }),
      shown: evidence.shown,
      total: evidence.total,
    }
  } catch (cause) {
    return failed(cause)
  }
}

export const checkContradictions = async (projectId: string, rawId: string): Promise<CheckResult> => {
  const gathered = await gather(projectId, rawId)
  if (!isGathered(gathered)) return gathered.status === 'nothing' ? { status: 'nothing', message: NOTHING_TO_CHECK } : gathered
  const evidence = evidenceFor(gathered.sceneIds, gathered.scenes, EVIDENCE_CHAR_CAP)
  if (evidence.shown === 0) return { status: 'nothing', message: NOTHING_TO_CHECK }
  const anthropic = assistantClient()
  if (anthropic === null) return { status: 'refused', message: NOT_CONNECTED }

  try {
    const response = await anthropic.messages.parse(
      {
        model: ASSISTANT_MODEL,
        max_tokens: CHECK_MAX_TOKENS,
        system: [
          { type: 'text', text: evidenceBlock(gathered.name, gathered.cues, evidence.text), cache_control: { type: 'ephemeral' } },
          { type: 'text', text: checkTask(gathered.name) },
        ],
        messages: [{ role: 'user', content: `Check ${gathered.name} for contradictions in the scenes above.` }],
        output_config: { format: zodOutputFormat(FindingsOutputSchema) },
      },
      { timeout: MODEL_ACTION_TIMEOUT_MS, maxRetries: 1 },
    )
    if (response.stop_reason === 'refusal') return { status: 'error', message: 'The assistant declined this one.' }
    if (response.stop_reason === 'max_tokens') return { status: 'error', message: 'The answer ran long and was cut. Try again.' }
    if (response.parsed_output === null) return { status: 'error', message: 'The assistant answered in a shape Folio could not read.' }

    // Only the scenes the model was shown can be quoted from.
    const shown = new Map<string, SceneText>()
    for (const scene of gathered.scenes.values()) if (evidence.labels.has(scene.label)) shown.set(scene.label, scene)
    const { findings, dropped } = validateFindings(response.parsed_output, shown, FINDINGS_MAX)
    const id = CharacterIdSchema.parse(rawId)
    await replaceOpenFindings(
      gathered.scope,
      id,
      findings.flatMap((finding) => {
        const a = shown.get(finding.a.label)
        const b = shown.get(finding.b.label)
        if (a === undefined || b === undefined) return []
        const [first, second] = a.ref.sceneNodeId < b.ref.sceneNodeId ? [finding.a, finding.b] : [finding.b, finding.a]
        const [firstRef, secondRef] = a.ref.sceneNodeId < b.ref.sceneNodeId ? [a.ref, b.ref] : [b.ref, a.ref]
        return [
          {
            aRef: firstRef.sceneNodeId,
            bRef: secondRef.sceneNodeId,
            aQuote: first.quote,
            bQuote: second.quote,
            claim: finding.claim,
            claimHash: claimHash(finding.claim),
          },
        ]
      }),
    )
    const rows = await listCharacterFindings(gathered.scope, id)
    const refByScene = new Map<NodeId, SceneRef>([...gathered.refs.values()].map((ref) => [ref.sceneNodeId, ref]))
    return {
      status: 'checked',
      findings: rows.flatMap((row) => {
        const view = findingOf(row, refByScene)
        return view === null ? [] : [view]
      }),
      dropped,
      shown: evidence.shown,
      total: evidence.total,
    }
  } catch (cause) {
    return failed(cause)
  }
}

/** `It's deliberate`, or `Reopen`: the writer's verdict on one finding. */
export const setFindingVerdict = async (projectId: string, rawFindingId: string, rawStatus: unknown): Promise<FindingResult> => {
  const findingId = CharacterFindingIdSchema.safeParse(rawFindingId)
  const status = CharacterFindingStatusSchema.safeParse(rawStatus)
  if (!findingId.success || !status.success) return { status: 'error', message: 'That finding could not be read.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const { scope } = gate
  const [written, sceneRows] = await Promise.all([setFindingStatus(scope, findingId.data, status.data), listSceneIndex(scope)])
  if (written === null) return { status: 'error', message: 'That finding is no longer here.' }
  const refByScene = new Map<NodeId, SceneRef>(sceneRows.map((row) => [row.sceneNodeId, sceneRefOf(row)]))
  const view = findingOf(written, refByScene)
  if (view === null) return { status: 'error', message: 'That finding is no longer here.' }
  return { status: 'set', finding: view }
}
