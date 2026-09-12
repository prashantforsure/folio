'use server'

import type { SceneRef } from '@folio/contracts'
import {
  ArcTurnEditSchema,
  ArcTurnIdSchema,
  CharacterIdSchema,
  CharacterProfileEditSchema,
  KeyLinesEditSchema,
  RelationshipEditSchema,
  TitleSchema,
} from '@folio/contracts'
import {
  addArcTurn,
  bindCue,
  createCharacterRecord,
  deleteAbsentCharacter,
  deleteArcTurn,
  listBoundCues,
  listCharacterRecords,
  listEpisodes,
  listOpenCueRows,
  listSceneIndex,
  mergeCharacterRecords,
  readDerivationInput,
  readDocumentByKind,
  readProjectScreenplayNodes,
  readScreenplayNodes,
  recordResolveDecisions,
  removeRelationship,
  renameCharacterRecord,
  reorderArcTurns,
  rewriteCueNodes,
  setKeyLines,
  snapshotVersion,
  unbindCue,
  updateArcTurn,
  updateCharacterProfile,
  upsertRelationship,
} from '@folio/db'
import type { CueNodeRewrite, ProjectScope } from '@folio/db'
import type { CharacterId, NodeId, ProposalTarget, ResolveSubject } from '@folio/script'
import {
  boundCueMap,
  canonicalKey,
  cueSpelling,
  matchCharacters,
  readCue,
  renameCharacterCues,
} from '@folio/script'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { isRefusal, openProject } from '../script/gate'
import { rederiveProject } from '../script/server'
import { sceneRefOf } from './figures'
import type {
  ArcTurnResult,
  BindResult,
  CreateResult,
  DeleteResult,
  DeriveResult,
  DialogueResult,
  MergeResult,
  RenameResult,
  ResolveResult,
  SavedResult,
} from './result'

/**
 * The Characters route's writes.
 *
 * Every one goes gate -> repository -> (pipeline) -> result, through the
 * project-scoped gate in `lib/script/gate.ts`: identity, membership, scope,
 * project. Membership, not role - unchanged from every earlier phase and
 * flagged again.
 *
 * ## Which writes re-derive, and which do not
 *
 * A profile field, a relationship, an arc turn, a key line: authored data
 * on the record, and nothing about the script changed, so nothing is
 * re-derived - a pass that runs later leaves these rows alone because
 * `commitDerivation` never touches an authored table.
 *
 * Binding a cue, a queue decision, a merge, a rename: each changes what the
 * alias table says, and so what the next pass resolves. Each **awaits** a
 * project-wide re-derive before answering, because what the writer sees
 * next - the queue, the counts, the cast - is that pass's output.
 *
 * ## The rename is the sanctioned write-back
 *
 * AGENTS.md, "Derivation is one-way - except": a character record rename is
 * "an explicit rewrite operation, returns a diff, single undo entry".
 * `renameCharacter` is that operation and nothing else here writes a node:
 * the pure core's `renameCharacterCues` decides which cues change, a
 * `before_rename` version is taken of every document it touches, the cues
 * are rewritten in one statement, and the count comes back as the diff.
 *
 * ## Walk-on is one act
 *
 * "This cue is nobody." The pure core keeps a row open with no proposal
 * once every candidate and `new-record` have been rejected, and never asks
 * again. So Walk-on records exactly those rejections - `matchCharacters`
 * lists the candidates by the same scoring the queue uses - in one insert,
 * then re-derives. The row stays open, un-proposed, and leaves the badge.
 */

const workspacePath = (projectId: string): string => `/app/project/${projectId}`

const REFUSED_CHARACTER = 'That character could not be found.'

const parseId = (raw: unknown): CharacterId | null => {
  const parsed = CharacterIdSchema.safeParse(typeof raw === 'string' ? raw : '')
  return parsed.success ? parsed.data : null
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

export const createCharacter = async (projectId: string, rawName: string): Promise<CreateResult> => {
  const name = TitleSchema.safeParse(rawName)
  if (!name.success) return { status: 'error', message: 'A character needs a name, up to 200 characters.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const id = await createCharacterRecord(gate.scope, name.data, 'supporting')
  // The name's spelling binds to the new record, so a cue typed later
  // resolves to it rather than proposing. A spelling somebody else already
  // holds is left with them; the writer sees it in the queue.
  await bindCue(gate.scope, id, cueSpelling(name.data))
  await rederiveProject(gate.scope)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'created', id }
}

export const saveProfile = async (
  projectId: string,
  rawId: string,
  rawEdit: unknown,
): Promise<SavedResult> => {
  const id = parseId(rawId)
  const edit = CharacterProfileEditSchema.safeParse(rawEdit)
  if (id === null || !edit.success) return { status: 'error', message: 'That edit could not be read.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const written = await updateCharacterProfile(gate.scope, id, edit.data)
  if (!written) return { status: 'error', message: REFUSED_CHARACTER }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

/**
 * The record-level rename. See the header.
 *
 * The old name's bound spellings are the ones whose canonical key is the
 * old name's; they are swapped for the new spelling in the alias table
 * (`renameCharacterRecord`), and the cues carrying the old name are
 * rewritten in every episode. Aliases the writer bound stay bound.
 */
export const renameCharacter = async (
  projectId: string,
  rawId: string,
  rawName: string,
): Promise<RenameResult> => {
  const id = parseId(rawId)
  const name = TitleSchema.safeParse(rawName)
  if (id === null || !name.success) return { status: 'error', message: 'A character needs a name, up to 200 characters.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const { scope, project } = gate

  const [records, bound] = await Promise.all([listCharacterRecords(scope), listBoundCues(scope)])
  const record = records.find((entry) => entry.id === id)
  if (record === undefined) return { status: 'error', message: REFUSED_CHARACTER }
  const oldKey = canonicalKey(record.name)
  const oldCues = bound
    .filter((entry) => entry.characterId === id && canonicalKey(entry.cue) === oldKey)
    .map((entry) => entry.cue)
  const newCue = cueSpelling(name.data)

  const outcome = await renameCharacterRecord(scope, id, name.data, oldCues, newCue)
  if (outcome.status === 'taken') {
    const holder = records.find((entry) => entry.id === outcome.by)
    return {
      status: 'refused',
      message: `${newCue} is already ${holder === undefined ? "another character's" : `${holder.name}'s`} cue. Merge the two records instead.`,
    }
  }
  if (outcome.status === 'missing') return { status: 'error', message: REFUSED_CHARACTER }

  // The rewrite, episode by episode: a `before_rename` version of every
  // script that changes, then every changed cue in one statement.
  let episodesTouched = 0
  const pending: CueNodeRewrite[] = []
  for (const episode of await listEpisodes(scope)) {
    const document = await readDocumentByKind(scope, episode.id, 'screenplay')
    if (document === null) continue
    const read = await readScreenplayNodes(scope, document.id)
    if (!read.ok) continue
    const before = read.value.map((entry) => entry.node)
    const result = renameCharacterCues(before, record.name, name.data)
    if (result.rewritten.length === 0) continue
    episodesTouched += 1
    await snapshotVersion(scope, document.id, 'before_rename', before, before.length)
    const changed = new Set(result.rewritten)
    for (const node of result.nodes) if (changed.has(node.id)) pending.push({ id: node.id, content: node.content })
  }
  const cues = await rewriteCueNodes(scope, pending)
  await rederiveProject(scope)
  revalidatePath(workspacePath(project.id), 'layout')
  return { status: 'renamed', cues, episodes: episodesTouched }
}

export const mergeCharacters = async (
  projectId: string,
  rawLoser: string,
  rawWinner: string,
): Promise<MergeResult> => {
  const loser = parseId(rawLoser)
  const winner = parseId(rawWinner)
  if (loser === null || winner === null || loser === winner) {
    return { status: 'error', message: 'Pick a different character to merge into.' }
  }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const merged = await mergeCharacterRecords(gate.scope, loser, winner)
  if (!merged) return { status: 'error', message: REFUSED_CHARACTER }
  await rederiveProject(gate.scope)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'merged', into: winner }
}

export const deleteCharacter = async (projectId: string, rawId: string): Promise<DeleteResult> => {
  const id = parseId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_CHARACTER }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const outcome = await deleteAbsentCharacter(gate.scope, id)
  if (outcome === 'missing') return { status: 'error', message: REFUSED_CHARACTER }
  if (outcome === 'present') {
    return {
      status: 'refused',
      message: 'This character is still in the script. Remove their cues first, or merge the record into another.',
    }
  }
  await rederiveProject(gate.scope)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'deleted' }
}

// ---------------------------------------------------------------------------
// The alias table
// ---------------------------------------------------------------------------

const CueSchema = z.string().trim().min(1).max(200)

export const bindAlias = async (projectId: string, rawId: string, rawCue: string): Promise<BindResult> => {
  const id = parseId(rawId)
  const cue = CueSchema.safeParse(rawCue)
  if (id === null || !cue.success) return { status: 'error', message: 'An alias is a cue spelling, up to 200 characters.' }
  const spelling = cueSpelling(readCue(cue.data).name)
  if (canonicalKey(spelling) === '') return { status: 'error', message: 'An alias needs at least one letter or digit.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const outcome = await bindCue(gate.scope, id, spelling)
  if (outcome.status === 'missing') return { status: 'error', message: REFUSED_CHARACTER }
  if (outcome.status === 'taken') {
    const records = await listCharacterRecords(gate.scope)
    const holder = records.find((entry) => entry.id === outcome.by)
    return {
      status: 'refused',
      message: `${spelling} already resolves to ${holder?.name ?? 'another character'}. Unbind it there first, or merge.`,
    }
  }
  if (outcome.status === 'bound') await rederiveProject(gate.scope)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'bound' }
}

export const unbindAlias = async (projectId: string, rawId: string, rawCue: string): Promise<SavedResult> => {
  const id = parseId(rawId)
  const cue = CueSchema.safeParse(rawCue)
  if (id === null || !cue.success) return { status: 'error', message: REFUSED_CHARACTER }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const outcome = await unbindCue(gate.scope, id, cue.data)
  if (outcome === 'missing') return { status: 'error', message: 'That spelling is not bound here.' }
  if (outcome === 'last') {
    return { status: 'refused', message: 'That is the only spelling bound to this record. Rename the record, or merge it, instead.' }
  }
  await rederiveProject(gate.scope)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

// ---------------------------------------------------------------------------
// Relationships, arc, key lines
// ---------------------------------------------------------------------------

export const saveRelationship = async (
  projectId: string,
  rawId: string,
  rawEdit: unknown,
): Promise<SavedResult> => {
  const id = parseId(rawId)
  const edit = RelationshipEditSchema.safeParse(rawEdit)
  if (id === null || !edit.success) return { status: 'error', message: 'That relationship could not be read.' }
  if (edit.data.otherId === id) return { status: 'error', message: 'A character cannot relate to themselves.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const what = edit.data.what.trim()
  const shift = edit.data.shift === null || edit.data.shift === '' ? null : edit.data.shift
  if (what === '' && shift === null) await removeRelationship(gate.scope, id, edit.data.otherId)
  else await upsertRelationship(gate.scope, id, edit.data.otherId, what === '' ? '—' : what, shift)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

export const addTurn = async (projectId: string, rawId: string, rawEdit: unknown): Promise<ArcTurnResult> => {
  const id = parseId(rawId)
  const edit = ArcTurnEditSchema.safeParse(rawEdit)
  if (id === null || !edit.success) return { status: 'error', message: 'A turn is a line of text, up to 2000 characters.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const turnId = await addArcTurn(gate.scope, id, edit.data)
  if (turnId === null) return { status: 'error', message: REFUSED_CHARACTER }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved', id: turnId }
}

export const saveTurn = async (projectId: string, rawTurnId: string, rawEdit: unknown): Promise<SavedResult> => {
  const turnId = ArcTurnIdSchema.safeParse(rawTurnId)
  const edit = ArcTurnEditSchema.safeParse(rawEdit)
  if (!turnId.success || !edit.success) return { status: 'error', message: 'A turn is a line of text, up to 2000 characters.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const written = await updateArcTurn(gate.scope, turnId.data, edit.data)
  if (!written) return { status: 'error', message: 'That turn is no longer on the record.' }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

export const removeTurn = async (projectId: string, rawTurnId: string): Promise<SavedResult> => {
  const turnId = ArcTurnIdSchema.safeParse(rawTurnId)
  if (!turnId.success) return { status: 'error', message: 'That turn is no longer on the record.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  await deleteArcTurn(gate.scope, turnId.data)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

export const reorderTurns = async (projectId: string, rawId: string, rawOrder: unknown): Promise<SavedResult> => {
  const id = parseId(rawId)
  const order = z.array(ArcTurnIdSchema).max(200).safeParse(rawOrder)
  if (id === null || !order.success) return { status: 'error', message: 'That order could not be read.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  await reorderArcTurns(gate.scope, id, order.data)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

export const saveKeyLines = async (projectId: string, rawId: string, rawLines: unknown): Promise<SavedResult> => {
  const id = parseId(rawId)
  const lines = KeyLinesEditSchema.safeParse(rawLines)
  if (id === null || !lines.success) return { status: 'error', message: 'Up to fifty key lines.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const written = await setKeyLines(gate.scope, id, lines.data)
  if (!written) return { status: 'error', message: REFUSED_CHARACTER }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

/** How many lines the picker offers. A principal in a series can have a thousand. */
const DIALOGUE_LIMIT = 400

/**
 * The character's own dialogue, for picking key lines. A read-shaped
 * action: it walks every screenplay node in the project, which the profile
 * does not do on render, and hands back the lines spoken under any spelling
 * bound to the record, each with the scene it sits in.
 */
export const listDialogue = async (projectId: string, rawId: string): Promise<DialogueResult> => {
  const id = parseId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_CHARACTER }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const [bound, index] = await Promise.all([listBoundCues(scope), listSceneIndex(scope)])
  const mine = new Set(
    [...boundCueMap(bound.filter((entry) => entry.characterId === id)).keys()],
  )
  if (mine.size === 0) return { status: 'ok', lines: [] }
  const refs = new Map<NodeId, SceneRef>(index.map((row) => [row.sceneNodeId, sceneRefOf(row)]))

  const all = await readProjectScreenplayNodes(scope)
  if (!all.ok) return { status: 'error', message: 'The script could not be read.' }

  const lines: { nodeId: NodeId; text: string; scene: SceneRef | null }[] = []
  let scene: NodeId | null = null
  let speaking = false
  for (const node of all.value) {
    if (node.type === 'comment') continue
    if (node.type === 'scene') {
      scene = node.id
      speaking = false
      continue
    }
    if (node.type === 'character') {
      const raw = node.content.map((run) => (run.kind === 'text' ? run.text : '')).join('')
      speaking = mine.has(canonicalKey(readCue(raw).name))
      continue
    }
    if (node.type === 'dialogue') {
      if (!speaking) continue
      const text = node.content.map((run) => (run.kind === 'text' ? run.text : '')).join('').trim()
      if (text === '') continue
      lines.push({ nodeId: node.id, text, scene: scene === null ? null : (refs.get(scene) ?? null) })
      if (lines.length >= DIALOGUE_LIMIT) break
      continue
    }
    if (node.type !== 'paren') speaking = false
  }
  return { status: 'ok', lines }
}

// ---------------------------------------------------------------------------
// The resolve queue
// ---------------------------------------------------------------------------

const ChoiceSchema = z.discriminatedUnion('kind', [
  /** Take the row's own proposal, whatever it points at. */
  z.object({ kind: z.literal('proposal') }),
  /** "Other…": bind to this record instead. */
  z.object({ kind: z.literal('character'), id: CharacterIdSchema }),
  z.object({ kind: z.literal('new-record') }),
  /** "Walk-on": this cue is nobody. Never ask again. */
  z.object({ kind: z.literal('walk-on') }),
])

const isCueSubject = (value: unknown): value is Extract<ResolveSubject, { kind: 'cue' }> =>
  typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'cue'

const isTarget = (value: unknown): value is ProposalTarget =>
  typeof value === 'object' && value !== null && 'kind' in value && typeof value.kind === 'string'

const pendingCount = async (scope: ProjectScope): Promise<number> =>
  (await listOpenCueRows(scope)).filter((row) => row.proposalTarget !== null).length

export const resolveCue = async (projectId: string, rawKey: string, rawChoice: unknown): Promise<ResolveResult> => {
  const key = z.string().min(1).max(400).safeParse(rawKey)
  const choice = ChoiceSchema.safeParse(rawChoice)
  if (!key.success || !choice.success) return { status: 'error', message: 'That decision could not be read.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const { scope, project } = gate

  const row = (await listOpenCueRows(scope)).find((entry) => entry.key === key.data)
  if (row === undefined || !isCueSubject(row.subject)) {
    return { status: 'error', message: 'That cue is no longer in the queue. It may have been matched already.' }
  }
  const subject = row.subject
  const target: ProposalTarget | null = isTarget(row.proposalTarget) ? row.proposalTarget : null

  if (choice.data.kind === 'walk-on') {
    const previous = await readDerivationInput(scope)
    const candidates = matchCharacters(subject.cue, previous.characters)
    await recordResolveDecisions(scope, subject, [
      { verdict: 'rejected', target: { kind: 'new-record' } },
      ...candidates.map((candidate) => ({
        verdict: 'rejected' as const,
        target: { kind: 'character' as const, id: candidate.id },
      })),
    ])
  } else {
    const chosen: ProposalTarget | null =
      choice.data.kind === 'proposal'
        ? target
        : choice.data.kind === 'character'
          ? { kind: 'character', id: choice.data.id }
          : { kind: 'new-record' }
    if (chosen === null) return { status: 'error', message: 'That cue has no proposal to take. Pick a character, or mark it a walk-on.' }
    if (chosen.kind === 'character') {
      const outcome = await bindCue(scope, chosen.id, cueSpelling(subject.cue))
      if (outcome.status === 'taken') {
        return { status: 'refused', message: 'That spelling already resolves to another character. Reload the queue.' }
      }
      if (outcome.status === 'missing') return { status: 'error', message: REFUSED_CHARACTER }
    } else if (chosen.kind !== 'new-record') {
      return { status: 'error', message: 'A cue can only be matched to a character or made a new one.' }
    }
    await recordResolveDecisions(scope, subject, [{ verdict: 'accepted', target: chosen }])
  }

  const pass = await rederiveProject(scope)
  if (!pass.ok) return { status: 'error', message: `The script could not be re-derived (${pass.error.kind}).` }
  revalidatePath(workspacePath(project.id), 'layout')
  return { status: 'resolved', pending: await pendingCount(scope) }
}

/** The empty state's "Derive N characters": a pass, awaited, project-wide. */
export const deriveNow = async (projectId: string): Promise<DeriveResult> => {
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const pass = await rederiveProject(gate.scope)
  if (!pass.ok) return { status: 'error', message: `The script could not be derived (${pass.error.kind}).` }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return {
    status: 'derived',
    characters: pass.derivation.entities.characters.filter((record) => record.presence === 'present').length,
  }
}
