import { CharacterIdSchema, CharacterProfileEditSchema, RelationshipInputSchema } from '@folio/contracts'
import {
  bindCue,
  deleteAbsentCharacter,
  deleteBlankCharacter,
  deleteRelationship as deleteRelationshipRow,
  deleteResolveDecisions,
  listBoundCues,
  listCharacterRecords,
  listEpisodes,
  listOpenCueRows,
  listResolveDecisions,
  mergeCharacterRecords,
  proposalTargetKey,
  readDerivationInput,
  readDocumentByKind,
  readScreenplayNodes,
  recordResolveDecisions,
  renameCharacterRecord,
  rewriteCueNodes,
  snapshotVersion,
  unbindCue,
  updateCharacterProfile,
  upsertRelationship,
} from '@folio/db'
import type { CueNodeRewrite, ProjectScope } from '@folio/db'
import type { CharacterId, NodeId, ProposalTarget, ResolveSubject } from '@folio/script'
import { canonicalKey, cueSpelling, matchCharacters, readCue, renameCharacterCues, revertCueRewrites } from '@folio/script'
import { z } from 'zod'

import { ROLE } from '../auth/roles'
import type { ProjectGate } from '../script/actor-gate'
import { roleRefusal } from '../script/actor-gate'
import { requestRederive } from '../script/derive-batch'
import { deleteObject, storageAvailable } from '../storage/r2'
import { orderInput, orderPair } from './relationships'
import type { DeleteResult, MergeResult, RelationshipResult, RenamePreview, RenameRestore, RenameResult, ResolveResult, SavedResult, UndoRenameResult } from './result'
import { relationshipOf } from './server'

/**
 * The Characters route's writes as **core functions** - roadmap task 4.2.
 *
 * Each takes a gate already opened and the raw input its action takes, checks
 * the role itself, and does everything the action did after its gate - except
 * `revalidatePath`, which is the action's (`actions.ts`), because there is no
 * cache to revalidate when the agent's tool or the worker calls one. No cookie
 * and no Next is reachable from here.
 *
 * The parse each action runs before its gate is exported (`*Problem`) so the
 * action keeps refusing bad input before it asks who is signed in.
 * `actions.ts`'s header is the route's own account of what each write does.
 */

const REFUSED_CHARACTER = 'That character could not be found.'
const NAME_SHAPE = 'A character needs a name, up to 200 characters.'
const UNREADABLE_DECISION = 'That decision could not be read.'

type Problem = { readonly status: 'error'; readonly message: string }

const parseId = (raw: unknown): CharacterId | null => {
  const parsed = CharacterIdSchema.safeParse(typeof raw === 'string' ? raw : '')
  return parsed.success ? parsed.data : null
}

const NameSchema = z.string().trim().min(1).max(200)

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

export const profileProblem = (rawId: unknown, rawEdit: unknown): Problem | null =>
  parseId(rawId) === null || !CharacterProfileEditSchema.safeParse(rawEdit).success ? { status: 'error', message: 'That edit could not be read.' } : null

export const saveProfileWith = async (gate: ProjectGate, rawId: unknown, rawEdit: unknown): Promise<SavedResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  const id = parseId(rawId)
  const edit = CharacterProfileEditSchema.safeParse(rawEdit)
  if (id === null || !edit.success) return { status: 'error', message: 'That edit could not be read.' }
  const written = await updateCharacterProfile(gate.scope, id, edit.data)
  if (!written) return { status: 'error', message: REFUSED_CHARACTER }
  return { status: 'saved' }
}

export const renameProblem = (rawId: unknown, rawName: unknown): Problem | null =>
  parseId(rawId) === null || !NameSchema.safeParse(rawName).success ? { status: 'error', message: NAME_SHAPE } : null

/**
 * The record-level rename - the sanctioned write-back. The old name's bound
 * spellings are swapped for the new spelling, and the cues carrying the old
 * name are rewritten in every episode behind a `before_rename` version.
 */
export const renameCharacterWith = async (gate: ProjectGate, rawId: unknown, rawName: unknown): Promise<RenameResult> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const id = parseId(rawId)
  const name = NameSchema.safeParse(rawName)
  if (id === null || !name.success) return { status: 'error', message: NAME_SHAPE }
  const { scope } = gate

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
    return { status: 'taken', by: outcome.by, name: holder?.name ?? 'another character', cue: newCue }
  }
  if (outcome.status === 'missing') return { status: 'error', message: REFUSED_CHARACTER }

  // The rewrite, episode by episode: a `before_rename` version of every
  // script that changes, then every changed cue in one statement.
  const restores: RenameRestore[] = []
  const pending: CueNodeRewrite[] = []
  for (const episode of await listEpisodes(scope)) {
    const document = await readDocumentByKind(scope, episode.id, 'screenplay')
    if (document === null) continue
    const read = await readScreenplayNodes(scope, document.id)
    if (!read.ok) continue
    const before = read.value.map((entry) => entry.node)
    const result = renameCharacterCues(before, record.name, name.data)
    if (result.rewritten.length === 0) continue
    restores.push({ episode: episode.slug, restores: result.before })
    await snapshotVersion(scope, document.id, 'before_rename', before, before.length)
    const changed = new Set(result.rewritten)
    for (const node of result.nodes) if (changed.has(node.id)) pending.push({ id: node.id, content: node.content })
  }
  const cues = await rewriteCueNodes(scope, pending)
  await requestRederive(scope)
  return { status: 'renamed', cues, episodes: restores.length, previousName: record.name, name: name.data, restores }
}

const RestoreSchema = z.object({
  previousName: z.string().trim().min(1).max(200),
  restores: z.array(
    z.object({
      episode: z.string().min(1),
      restores: z.array(z.object({ id: z.string().min(1), text: z.string() })).max(10_000),
    }),
  ),
})

export const undoRenameProblem = (rawId: unknown, rawRestore: unknown): Problem | null =>
  parseId(rawId) === null || !RestoreSchema.safeParse(rawRestore).success ? { status: 'error', message: 'That rename could not be taken back.' } : null

/**
 * Take a rename back: the inverse alias swap, then per episode the old text
 * back by node id behind a `before_rename` snapshot, then a re-derive. A cue
 * edited since the rename is skipped and counted.
 */
export const undoRenameWith = async (gate: ProjectGate, rawId: unknown, rawRestore: unknown): Promise<UndoRenameResult> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const id = parseId(rawId)
  const restore = RestoreSchema.safeParse(rawRestore)
  if (id === null || !restore.success) return { status: 'error', message: 'That rename could not be taken back.' }
  const { scope } = gate

  const [records, bound] = await Promise.all([listCharacterRecords(scope), listBoundCues(scope)])
  const record = records.find((entry) => entry.id === id)
  if (record === undefined) return { status: 'error', message: REFUSED_CHARACTER }
  const currentKey = canonicalKey(record.name)
  const currentCues = bound
    .filter((entry) => entry.characterId === id && canonicalKey(entry.cue) === currentKey)
    .map((entry) => entry.cue)
  const oldCue = cueSpelling(restore.data.previousName)

  const outcome = await renameCharacterRecord(scope, id, restore.data.previousName, currentCues, oldCue)
  if (outcome.status === 'taken') {
    const holder = records.find((entry) => entry.id === outcome.by)
    return {
      status: 'refused',
      message: `${oldCue} is now ${holder?.name ?? 'another character'}'s cue. The rename cannot be undone from here - merge the two records instead.`,
    }
  }
  if (outcome.status === 'missing') return { status: 'error', message: REFUSED_CHARACTER }

  let skipped = 0
  const pending: CueNodeRewrite[] = []
  const episodes = await listEpisodes(scope)
  for (const entry of restore.data.restores) {
    const episode = episodes.find((candidate) => candidate.slug === entry.episode)
    if (episode === undefined) {
      skipped += entry.restores.length
      continue
    }
    const document = await readDocumentByKind(scope, episode.id, 'screenplay')
    if (document === null) {
      skipped += entry.restores.length
      continue
    }
    const read = await readScreenplayNodes(scope, document.id)
    if (!read.ok) {
      skipped += entry.restores.length
      continue
    }
    const before = read.value.map((node) => node.node)
    const result = revertCueRewrites(
      before,
      entry.restores.map((line) => ({ id: line.id as NodeId, text: line.text })),
      currentKey,
    )
    skipped += result.skipped.length
    if (result.restored.length === 0) continue
    await snapshotVersion(scope, document.id, 'before_rename', before, before.length)
    const changed = new Set(result.restored)
    for (const node of result.nodes) if (changed.has(node.id)) pending.push({ id: node.id, content: node.content })
  }
  const cues = await rewriteCueNodes(scope, pending)
  await requestRederive(scope)
  return { status: 'undone', cues, skipped }
}

/**
 * What a rename would do, before it does: the cues per episode, the record's
 * other bound spellings (which a rename leaves bound), and whether the new
 * spelling is already somebody's. Nothing written.
 */
export const previewRenameWith = async (gate: ProjectGate, rawId: unknown, rawName: unknown): Promise<RenamePreview> => {
  const refused = roleRefusal(gate, ROLE.read)
  if (refused !== null) return refused
  const id = parseId(rawId)
  const name = NameSchema.safeParse(rawName)
  if (id === null || !name.success) return { status: 'error', message: NAME_SHAPE }
  const { scope } = gate

  const [records, bound, episodes] = await Promise.all([listCharacterRecords(scope), listBoundCues(scope), listEpisodes(scope)])
  const record = records.find((entry) => entry.id === id)
  if (record === undefined) return { status: 'error', message: REFUSED_CHARACTER }
  const oldKey = canonicalKey(record.name)
  const newCue = cueSpelling(name.data)
  const newKey = canonicalKey(newCue)

  // Three waves of reads rather than two per episode in series.
  const documents = await Promise.all(episodes.map((episode) => readDocumentByKind(scope, episode.id, 'screenplay')))
  const reads = await Promise.all(
    documents.map((document) => (document === null ? Promise.resolve(null) : readScreenplayNodes(scope, document.id))),
  )
  const perEpisode = episodes.flatMap((episode, index) => {
    const read = reads[index]
    if (read === null || read === undefined || !read.ok) return []
    const nodes = read.value.map((entry) => entry.node)
    const cues = renameCharacterCues(nodes, record.name, name.data).rewritten.length
    return cues === 0 ? [] : [{ ordinal: episode.ordinal, cues }]
  })

  const stays = bound
    .filter((entry) => entry.characterId === id)
    .map((entry) => entry.cue)
    .filter((cue) => {
      const key = canonicalKey(readCue(cue).name)
      return key !== oldKey && key !== newKey
    })
  // The unique index is on the spelling itself, so `taken` mirrors it exactly.
  const holder = bound.find((entry) => entry.characterId !== id && entry.cue === newCue)
  const holderRecord = holder === undefined ? undefined : records.find((entry) => entry.id === holder.characterId)

  return {
    status: 'preview',
    to: newCue,
    cues: perEpisode.reduce((total, entry) => total + entry.cues, 0),
    episodes: perEpisode,
    stays,
    taken: holder === undefined ? null : { by: holder.characterId, name: holderRecord?.name ?? 'another character' },
  }
}

/** The merge itself, shared by the drawer's foot, the queue's pair row and the agent's `merge_entities`. */
export const mergeCharacterInto = async (scope: ProjectScope, loser: CharacterId, winner: CharacterId): Promise<MergeResult> => {
  const before = (await listCharacterRecords(scope)).find((entry) => entry.id === loser)
  const merged = await mergeCharacterRecords(scope, loser, winner)
  if (!merged) return { status: 'error', message: REFUSED_CHARACTER }
  // The loser's portrait has no card to sit on any more. Best effort: a
  // failed delete leaves an orphan object, never a broken row.
  if (before?.portraitKey !== undefined && before.portraitKey !== null && storageAvailable()) {
    await deleteObject(before.portraitKey)
  }
  await requestRederive(scope)
  return { status: 'merged', into: winner }
}

export const mergeProblem = (rawLoser: unknown, rawWinner: unknown): Problem | null => {
  const loser = parseId(rawLoser)
  const winner = parseId(rawWinner)
  return loser === null || winner === null || loser === winner ? { status: 'error', message: 'Pick a different character to merge into.' } : null
}

export const mergeCharactersWith = async (gate: ProjectGate, rawLoser: unknown, rawWinner: unknown): Promise<MergeResult> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const loser = parseId(rawLoser)
  const winner = parseId(rawWinner)
  if (loser === null || winner === null || loser === winner) return { status: 'error', message: 'Pick a different character to merge into.' }
  return mergeCharacterInto(gate.scope, loser, winner)
}

export const characterIdProblem = (rawId: unknown): Problem | null => (parseId(rawId) === null ? { status: 'error', message: REFUSED_CHARACTER } : null)

export const deleteCharacterWith = async (gate: ProjectGate, rawId: unknown): Promise<DeleteResult> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const id = parseId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_CHARACTER }

  const before = (await listCharacterRecords(gate.scope)).find((entry) => entry.id === id)
  const outcome = await deleteAbsentCharacter(gate.scope, id)
  if (outcome === 'missing') return { status: 'error', message: REFUSED_CHARACTER }
  if (outcome === 'present') {
    return {
      status: 'refused',
      message: 'This character is still in the script. Remove their cues first, or merge the record into another.',
    }
  }
  if (before?.portraitKey !== undefined && before.portraitKey !== null && storageAvailable()) {
    await deleteObject(before.portraitKey)
  }
  await requestRederive(gate.scope)
  return { status: 'deleted' }
}

// ---------------------------------------------------------------------------
// The resolve queue
// ---------------------------------------------------------------------------

const ChoiceSchema = z.discriminatedUnion('kind', [
  /** Take the row's own proposal, whatever it points at. */
  z.object({ kind: z.literal('proposal') }),
  /** "Someone else…": bind to this record instead. */
  z.object({ kind: z.literal('character'), id: CharacterIdSchema }),
  z.object({ kind: z.literal('new-record') }),
  /** "Not a character": this cue is nobody. Never ask again. */
  z.object({ kind: z.literal('walk-on') }),
  /**
   * "It's deliberate" on a conflict block (README, "Conflict blocks"): the
   * spelling is not this record. Only that candidate is rejected; the next
   * pass proposes the next one, or a new record, and the cue stays open.
   */
  z.object({ kind: z.literal('not-this'), id: CharacterIdSchema }),
])

const QueueKeySchema = z.string().min(1).max(400)

const isCueSubject = (value: unknown): value is Extract<ResolveSubject, { kind: 'cue' }> =>
  typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'cue'

const isTarget = (value: unknown): value is ProposalTarget =>
  typeof value === 'object' && value !== null && 'kind' in value && typeof value.kind === 'string'

const pendingCount = async (scope: ProjectScope): Promise<number> =>
  (await listOpenCueRows(scope)).filter((row) => row.proposalTarget !== null).length

export const resolveCueProblem = (rawKey: unknown, rawChoice: unknown): Problem | null =>
  !QueueKeySchema.safeParse(rawKey).success || !ChoiceSchema.safeParse(rawChoice).success ? { status: 'error', message: UNREADABLE_DECISION } : null

export const resolveCueWith = async (gate: ProjectGate, rawKey: unknown, rawChoice: unknown): Promise<ResolveResult> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const key = QueueKeySchema.safeParse(rawKey)
  const choice = ChoiceSchema.safeParse(rawChoice)
  if (!key.success || !choice.success) return { status: 'error', message: UNREADABLE_DECISION }
  const { scope } = gate

  const row = (await listOpenCueRows(scope)).find((entry) => entry.key === key.data)
  if (row === undefined || !isCueSubject(row.subject)) {
    return { status: 'error', message: 'That name is no longer waiting. It may have been matched already.' }
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
  } else if (choice.data.kind === 'not-this') {
    await recordResolveDecisions(scope, subject, [
      { verdict: 'rejected', target: { kind: 'character', id: choice.data.id } },
    ])
  } else {
    const chosen: ProposalTarget | null =
      choice.data.kind === 'proposal'
        ? target
        : choice.data.kind === 'character'
          ? { kind: 'character', id: choice.data.id }
          : { kind: 'new-record' }
    if (chosen === null) return { status: 'error', message: 'That name has no suggestion to take. Pick a character, or mark it as not one.' }
    if (chosen.kind === 'character') {
      const outcome = await bindCue(scope, chosen.id, cueSpelling(subject.cue))
      if (outcome.status === 'taken') {
        return { status: 'refused', message: 'That spelling already resolves to another character. Reload the page.' }
      }
      if (outcome.status === 'missing') return { status: 'error', message: REFUSED_CHARACTER }
    } else if (chosen.kind !== 'new-record') {
      return { status: 'error', message: 'A name can only be matched to a character or made a new one.' }
    }
    await recordResolveDecisions(scope, subject, [{ verdict: 'accepted', target: chosen }])
  }

  const pass = await requestRederive(scope)
  if (!pass.ok) return { status: 'error', message: `The script could not be re-derived (${pass.error.kind}).` }
  return { status: 'resolved', pending: await pendingCount(scope) }
}

const UndoSchema = z.discriminatedUnion('kind', [
  /** "Actually a character" on a walk-on, or Undo on "Not a character": every rejection on the row goes. */
  z.object({ kind: z.literal('walk-on') }),
  /** Undo on "It's deliberate": that one rejection goes; the pass proposes the record again. */
  z.object({ kind: z.literal('not-this'), id: CharacterIdSchema }),
  /** Undo on an accept: the acceptance goes and the spelling is unbound from the record. */
  z.object({ kind: z.literal('bound'), id: CharacterIdSchema }),
  /** Undo on "New character": the acceptance goes and the minted record, still blank, with it. */
  z.object({ kind: z.literal('new-record') }),
])

export const revokeProblem = (rawKey: unknown, rawUndo: unknown): Problem | null => {
  const key = QueueKeySchema.safeParse(rawKey)
  if (!key.success || !UndoSchema.safeParse(rawUndo).success) return { status: 'error', message: UNREADABLE_DECISION }
  return key.data.startsWith('cue:') ? null : { status: 'error', message: UNREADABLE_DECISION }
}

/**
 * Take a queue decision back: delete exactly the rows the decision wrote, undo
 * whatever it bound or minted, and re-derive so the cue is asked about again.
 */
export const revokeDecisionWith = async (gate: ProjectGate, rawKey: unknown, rawUndo: unknown): Promise<ResolveResult> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const problem = revokeProblem(rawKey, rawUndo)
  if (problem !== null) return problem
  const key = QueueKeySchema.parse(rawKey)
  const undo = UndoSchema.parse(rawUndo)
  const { scope } = gate

  const decisions = (await listResolveDecisions(scope)).filter((decision) => decision.rowKey === key)
  if (decisions.length === 0) return { status: 'error', message: 'There is nothing to take back on that name.' }
  // The cue's spelling, from the key: `cue:<canonical key>`; the bound row
  // carries the spelling as typed, so read it from what was accepted.
  const cueOf = (id: CharacterId): string | null => {
    const accepted = decisions.find(
      (decision) => decision.verdict === 'accepted' && isTarget(decision.target) && decision.target.kind === 'character' && decision.target.id === id,
    )
    return accepted === undefined ? null : key.slice('cue:'.length)
  }

  if (undo.kind === 'walk-on') {
    await deleteResolveDecisions(scope, key, null)
  } else if (undo.kind === 'not-this') {
    await deleteResolveDecisions(scope, key, [proposalTargetKey({ kind: 'character', id: undo.id })])
  } else if (undo.kind === 'bound') {
    const id = undo.id
    if (cueOf(id) === null) return { status: 'error', message: 'That name was not matched to this character.' }
    const bound = (await listBoundCues(scope)).filter((entry) => entry.characterId === id)
    const spelling = bound.find((entry) => canonicalKey(readCue(entry.cue).name) === key.slice('cue:'.length))
    if (spelling === undefined) return { status: 'error', message: 'That spelling is no longer bound here.' }
    const outcome = await unbindCue(scope, id, spelling.cue)
    if (outcome === 'last') {
      return { status: 'refused', message: 'That is the only spelling bound to this record. Rename the record, or merge it, instead.' }
    }
    await deleteResolveDecisions(scope, key, [proposalTargetKey({ kind: 'character', id })])
  } else {
    await deleteResolveDecisions(scope, key, [proposalTargetKey({ kind: 'new-record' })])
    const cueKey = key.slice('cue:'.length)
    const holder = (await listBoundCues(scope)).find((entry) => canonicalKey(readCue(entry.cue).name) === cueKey)
    if (holder !== undefined) {
      const gone = await deleteBlankCharacter(scope, holder.characterId)
      // A record the writer has already written on is kept; only its
      // binding goes, so the cue proposes it (`same name`) rather than
      // resolving to it. Honest either way.
      if (gone === 'kept') await unbindCue(scope, holder.characterId, holder.cue)
    }
  }

  const pass = await requestRederive(scope)
  if (!pass.ok) return { status: 'error', message: `The script could not be re-derived (${pass.error.kind}).` }
  return { status: 'resolved', pending: await pendingCount(scope) }
}

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

export const relationshipProblem = (rawInput: unknown): Problem | null => {
  const input = RelationshipInputSchema.safeParse(rawInput)
  return input.success ? null : { status: 'error', message: input.error.issues[0]?.message ?? 'That relationship could not be read.' }
}

/**
 * Write a pair's relationship, whole. The pair is sorted and the labels
 * swapped with it (`orderInput`), so either end lands on the one row.
 */
export const saveRelationshipWith = async (gate: ProjectGate, rawInput: unknown): Promise<RelationshipResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  const input = RelationshipInputSchema.safeParse(rawInput)
  if (!input.success) return { status: 'error', message: input.error.issues[0]?.message ?? 'That relationship could not be read.' }
  const ordered = orderInput(input.data)
  const row = await upsertRelationship(gate.scope, {
    aId: ordered.aId,
    bId: ordered.bId,
    aIs: ordered.aIs,
    bIs: ordered.bIs,
    description: ordered.description === '' ? null : ordered.description,
  })
  if (row === null) return { status: 'error', message: 'One of those characters could not be found.' }
  return { status: 'saved', relationship: relationshipOf(row) }
}

export const pairProblem = (rawA: unknown, rawB: unknown): Problem | null => {
  const a = parseId(rawA)
  const b = parseId(rawB)
  return a === null || b === null || a === b ? { status: 'error', message: 'That relationship could not be read.' } : null
}

export const deleteRelationshipWith = async (gate: ProjectGate, rawA: unknown, rawB: unknown): Promise<RelationshipResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  const a = parseId(rawA)
  const b = parseId(rawB)
  if (a === null || b === null || a === b) return { status: 'error', message: 'That relationship could not be read.' }
  const [x, y] = orderPair(a, b)
  const gone = await deleteRelationshipRow(gate.scope, x, y)
  if (!gone) return { status: 'error', message: 'That relationship is not here any more.' }
  return { status: 'gone' }
}
