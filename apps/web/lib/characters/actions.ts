'use server'

import {
  CanvasPositionSchema,
  CharacterIdSchema,
  CharacterProfileEditSchema,
  NewCharacterSchema,
  PORTRAIT_MAX_BYTES,
  PORTRAIT_TYPES,
  RelationshipInputSchema,
} from '@folio/contracts'
import type { PortraitType } from '@folio/contracts'
import {
  bindCue,
  createCharacterRecord,
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
  placeCharacter,
  proposalTargetKey,
  readDerivationInput,
  readDocumentByKind,
  readScreenplayNodes,
  recordDecisionByKey,
  recordResolveDecisions,
  renameCharacterRecord,
  rewriteCueNodes,
  setPortraitKey,
  snapshotVersion,
  unbindCue,
  updateCharacterProfile,
  upsertRelationship,
} from '@folio/db'
import type { CueNodeRewrite, ProjectScope } from '@folio/db'
import type { CharacterId, NodeId, ProposalTarget, ResolveSubject } from '@folio/script'
import { canonicalKey, cueSpelling, matchCharacters, readCue, renameCharacterCues, revertCueRewrites } from '@folio/script'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { isRefusal, openProject } from '../script/gate'
import { rederiveProject } from '../script/server'
import { deleteObject, publicUrl, putObject, storageAvailable } from '../storage/r2'
import { orderInput, orderPair } from './relationships'
import type {
  CreateResult,
  DeleteResult,
  DeriveResult,
  MergeResult,
  PairResult,
  PlaceResult,
  PortraitResult,
  RelationshipResult,
  RenamePreview,
  RenameRestore,
  RenameResult,
  ResolveResult,
  SavedResult,
  UndoRenameResult,
} from './result'
import { pairDecisionKey, relationshipOf } from './server'

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
 * A profile field, a portrait: authored data on the record, and nothing
 * about the script changed, so nothing is re-derived - a pass that runs
 * later leaves these rows alone because `commitDerivation` never touches
 * an authored table.
 *
 * Binding a cue, a queue decision, a merge, a rename: each changes what the
 * alias table says, and so what the next pass resolves. Each **awaits** a
 * project-wide re-derive before answering, because what the writer sees
 * next - the queue's rows, the counts, the grid - is that pass's output.
 *
 * ## The rename is the sanctioned write-back
 *
 * AGENTS.md, "Derivation is one-way - except": a character record rename is
 * "an explicit rewrite operation, returns a diff, single undo entry".
 * `renameCharacter` is that operation and nothing else here writes a node:
 * the pure core's `renameCharacterCues` decides which cues change, a
 * `before_rename` version is taken of every document it touches, the cues
 * are rewritten in one statement, and the count comes back as the diff.
 * `previewRename` is the same decision as a read - the diff before it is
 * taken - so the confirm can say what will change and what stays bound.
 * `undoRename` is the same operation in reverse: the old text goes back by
 * node id (`revertCueRewrites`, never a second rename), behind its own
 * `before_rename` snapshot, so the undo of the sanctioned write-back is as
 * explicit as the write-back was and a cue edited since is left alone.
 *
 * ## Two records, one person
 *
 * `decidePair` answers the queue's pair row (`similarRecords`): `merge` is
 * the same merge the rename's `taken` door does; `different` writes a
 * `record:<a>:<b>` rejection through `recordDecisionByKey` so the pair is
 * never asked about again. The key is never a queue row's, so a pass never
 * sees it.
 *
 * ## Walk-on is one act, and every act can be taken back
 *
 * "Not a character." The pure core keeps a row open with no proposal once
 * every candidate and `new-record` have been rejected, and never asks
 * again. So the decision records exactly those rejections -
 * `matchCharacters` lists the candidates by the same scoring the queue
 * uses - in one insert, then re-derives. The row stays open, un-proposed,
 * leaves the badge, and is listed under the queue as a walk-on.
 *
 * `revokeDecision` is the reverse of every queue decision: the rows it
 * wrote are deleted (`deleteResolveDecisions` - the insert is idempotent on
 * the row and target, so deciding the opposite way is a no-op without it),
 * an accepted spelling is unbound, a `New character` that is still blank is
 * deleted, and the project re-derives so the cue is asked about again.
 *
 * ## The alias table is written by the queue
 *
 * Since the fourth pass (2026-09-20) the only doors into the alias table
 * are the queue's: `resolveCue` binds a spelling, `revokeDecision` unbinds
 * it, `mergeCharacters` (the rename's `taken` door, and the queue's pair
 * row) moves every spelling to the winner. The drawer's bind / move /
 * split / unbind doors went with the alias table.
 *
 * ## The canvas and the graph
 *
 * `placeCharacterOnCanvas` writes where a card was dropped; `saveRelationship`
 * and `deleteRelationship` write one authored row per pair. None of the
 * three re-derives: nothing derived reads them.
 *
 * ## A portrait goes through the action, not past it
 *
 * The file arrives as `FormData`, is capped at `PORTRAIT_MAX_BYTES`, has
 * its first bytes sniffed (the declared MIME is not trusted), is PUT to
 * storage under `projects/<projectId>/characters/<characterId>/`, and only
 * then does the row point at it; the object it replaced is deleted after
 * the row says so, never before. No browser ever holds a storage
 * credential, and `next.config.ts` raises the action body limit for it.
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

export const createCharacter = async (projectId: string, rawInput: unknown): Promise<CreateResult> => {
  const input = NewCharacterSchema.safeParse(rawInput)
  if (!input.success) return { status: 'error', message: 'A character needs a name, up to 200 characters.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const { name, ...profile } = input.data
  const id = await createCharacterRecord(gate.scope, name, profile)
  // The name's spelling binds to the new record, so a cue typed later
  // resolves to it rather than proposing. A spelling somebody else already
  // holds is left with them; the cue lands in the queue proposing this record.
  await bindCue(gate.scope, id, cueSpelling(name))
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
  const name = z.string().trim().min(1).max(200).safeParse(rawName)
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
  await rederiveProject(scope)
  revalidatePath(workspacePath(project.id), 'layout')
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

/**
 * Take a rename back. The inverse alias swap first (the old spelling
 * becomes the name's again; `taken` when somebody bound the old spelling
 * meanwhile - the rename cannot be undone from here), then per episode the
 * old text back by node id behind a `before_rename` snapshot - one undo
 * entry per direction - and a re-derive. A cue edited since the rename is
 * skipped and counted.
 */
export const undoRename = async (projectId: string, rawId: string, rawRestore: unknown): Promise<UndoRenameResult> => {
  const id = parseId(rawId)
  const restore = RestoreSchema.safeParse(rawRestore)
  if (id === null || !restore.success) return { status: 'error', message: 'That rename could not be taken back.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const { scope, project } = gate

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
  await rederiveProject(scope)
  revalidatePath(workspacePath(project.id), 'layout')
  return { status: 'undone', cues, skipped }
}

/**
 * What a rename would do, before it does. The same reads and the same pure
 * decision as `renameCharacter`, nothing written: the cues per episode,
 * the record's other bound spellings (which a rename leaves bound), and
 * whether the new spelling is already somebody's.
 */
export const previewRename = async (projectId: string, rawId: string, rawName: string): Promise<RenamePreview> => {
  const id = parseId(rawId)
  const name = z.string().trim().min(1).max(200).safeParse(rawName)
  if (id === null || !name.success) return { status: 'error', message: 'A character needs a name, up to 200 characters.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
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

/** The merge itself, shared by the drawer's foot and the queue's pair row. */
const mergeInto = async (scope: ProjectScope, projectId: string, loser: CharacterId, winner: CharacterId): Promise<MergeResult> => {
  const before = (await listCharacterRecords(scope)).find((entry) => entry.id === loser)
  const merged = await mergeCharacterRecords(scope, loser, winner)
  if (!merged) return { status: 'error', message: REFUSED_CHARACTER }
  // The loser's portrait has no card to sit on any more. Best effort: a
  // failed delete leaves an orphan object, never a broken row.
  if (before?.portraitKey !== undefined && before.portraitKey !== null && storageAvailable()) {
    await deleteObject(before.portraitKey)
  }
  await rederiveProject(scope)
  revalidatePath(workspacePath(projectId), 'layout')
  return { status: 'merged', into: winner }
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
  return mergeInto(gate.scope, gate.project.id, loser, winner)
}

/**
 * The queue's pair row: `Merge into <keep>` folds `other` into `keep`;
 * `They're different people` records a rejection under the pair's key so
 * the pair is never listed again. See the header.
 */
export const decidePair = async (
  projectId: string,
  rawKeep: string,
  rawOther: string,
  rawVerdict: unknown,
): Promise<PairResult> => {
  const keep = parseId(rawKeep)
  const other = parseId(rawOther)
  const verdict = z.enum(['merge', 'different']).safeParse(rawVerdict)
  if (keep === null || other === null || keep === other || !verdict.success) {
    return { status: 'error', message: 'That decision could not be read.' }
  }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  if (verdict.data === 'merge') return mergeInto(gate.scope, gate.project.id, other, keep)
  await recordDecisionByKey(gate.scope, pairDecisionKey(keep, other), 'rejected', { kind: 'character', id: other })
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'different' }
}

export const deleteCharacter = async (projectId: string, rawId: string): Promise<DeleteResult> => {
  const id = parseId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_CHARACTER }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

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
  await rederiveProject(gate.scope)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'deleted' }
}

// ---------------------------------------------------------------------------
// The portrait
// ---------------------------------------------------------------------------

/** The first bytes of the three formats accepted. The declared type is checked against these, not trusted. */
const sniff = (bytes: Uint8Array): PortraitType | null => {
  const at = (index: number): number => bytes[index] ?? -1
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if (
    at(0) === 0x52 &&
    at(1) === 0x49 &&
    at(2) === 0x46 &&
    at(3) === 0x46 &&
    at(8) === 0x57 &&
    at(9) === 0x45 &&
    at(10) === 0x42 &&
    at(11) === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

const EXTENSION: Readonly<Record<PortraitType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/**
 * Store a portrait for a record. The file is the `portrait` entry of the
 * form data. See the header for the order of operations.
 */
export const uploadPortrait = async (projectId: string, rawId: string, form: FormData): Promise<PortraitResult> => {
  const id = parseId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_CHARACTER }
  if (!storageAvailable()) return { status: 'refused', message: 'Portrait storage is not set up on this server yet.' }
  const entry = form.get('portrait')
  if (!(entry instanceof File)) return { status: 'error', message: 'Pick an image to upload.' }
  if (entry.size === 0) return { status: 'error', message: 'That file is empty.' }
  if (entry.size > PORTRAIT_MAX_BYTES) {
    return { status: 'refused', message: `A portrait is at most ${String(PORTRAIT_MAX_BYTES / (1024 * 1024))} MB.` }
  }
  const bytes = new Uint8Array(await entry.arrayBuffer())
  const type = sniff(bytes)
  if (type === null || !(PORTRAIT_TYPES as readonly string[]).includes(type)) {
    return { status: 'refused', message: 'A portrait is a PNG, JPEG or WebP image.' }
  }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const key = `projects/${gate.project.id}/characters/${id}/portrait-${crypto.randomUUID()}.${EXTENSION[type]}`
  const put = await putObject(key, bytes, type)
  if (!put.ok) return { status: 'error', message: put.message }
  const pointed = await setPortraitKey(gate.scope, id, key)
  if (!pointed.found) {
    await deleteObject(key)
    return { status: 'error', message: REFUSED_CHARACTER }
  }
  if (pointed.previous !== null && pointed.previous !== key) await deleteObject(pointed.previous)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved', url: publicUrl(key) }
}

export const removePortrait = async (projectId: string, rawId: string): Promise<PortraitResult> => {
  const id = parseId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_CHARACTER }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const pointed = await setPortraitKey(gate.scope, id, null)
  if (!pointed.found) return { status: 'error', message: REFUSED_CHARACTER }
  if (pointed.previous !== null && storageAvailable()) await deleteObject(pointed.previous)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved', url: null }
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

  const pass = await rederiveProject(scope)
  if (!pass.ok) return { status: 'error', message: `The script could not be re-derived (${pass.error.kind}).` }
  revalidatePath(workspacePath(project.id), 'layout')
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

/**
 * Take a queue decision back. The decisions are rows and the insert is
 * idempotent on the row and its target, so the reverse is a delete of
 * exactly the rows that decision wrote, then whatever it bound or minted
 * is undone, then the project re-derives so the cue is asked about again.
 * The row itself may be `settled` by now (a bind settles it); the key is
 * the cue's, and the decisions are looked up by it, not by an open row.
 */
export const revokeDecision = async (projectId: string, rawKey: string, rawUndo: unknown): Promise<ResolveResult> => {
  const key = z.string().min(1).max(400).safeParse(rawKey)
  const undo = UndoSchema.safeParse(rawUndo)
  if (!key.success || !undo.success) return { status: 'error', message: 'That decision could not be read.' }
  if (!key.data.startsWith('cue:')) return { status: 'error', message: 'That decision could not be read.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const { scope, project } = gate

  const decisions = (await listResolveDecisions(scope)).filter((decision) => decision.rowKey === key.data)
  if (decisions.length === 0) return { status: 'error', message: 'There is nothing to take back on that name.' }
  // The cue's spelling, from the key: `cue:<canonical key>`; the bound row
  // carries the spelling as typed, so read it from what was accepted.
  const cueOf = (id: CharacterId): string | null => {
    const accepted = decisions.find(
      (decision) => decision.verdict === 'accepted' && isTarget(decision.target) && decision.target.kind === 'character' && decision.target.id === id,
    )
    return accepted === undefined ? null : key.data.slice('cue:'.length)
  }

  if (undo.data.kind === 'walk-on') {
    await deleteResolveDecisions(scope, key.data, null)
  } else if (undo.data.kind === 'not-this') {
    await deleteResolveDecisions(scope, key.data, [proposalTargetKey({ kind: 'character', id: undo.data.id })])
  } else if (undo.data.kind === 'bound') {
    const id = undo.data.id
    if (cueOf(id) === null) return { status: 'error', message: 'That name was not matched to this character.' }
    const bound = (await listBoundCues(scope)).filter((entry) => entry.characterId === id)
    const spelling = bound.find((entry) => canonicalKey(readCue(entry.cue).name) === key.data.slice('cue:'.length))
    if (spelling === undefined) return { status: 'error', message: 'That spelling is no longer bound here.' }
    const outcome = await unbindCue(scope, id, spelling.cue)
    if (outcome === 'last') {
      return { status: 'refused', message: 'That is the only spelling bound to this record. Rename the record, or merge it, instead.' }
    }
    await deleteResolveDecisions(scope, key.data, [proposalTargetKey({ kind: 'character', id })])
  } else {
    await deleteResolveDecisions(scope, key.data, [proposalTargetKey({ kind: 'new-record' })])
    const cueKey = key.data.slice('cue:'.length)
    const holder = (await listBoundCues(scope)).find((entry) => canonicalKey(readCue(entry.cue).name) === cueKey)
    if (holder !== undefined) {
      const gone = await deleteBlankCharacter(scope, holder.characterId)
      // A record the writer has already written on is kept; only its
      // binding goes, so the cue proposes it (`same name`) rather than
      // resolving to it. Honest either way.
      if (gone === 'kept') await unbindCue(scope, holder.characterId, holder.cue)
    }
  }

  const pass = await rederiveProject(scope)
  if (!pass.ok) return { status: 'error', message: `The script could not be re-derived (${pass.error.kind}).` }
  revalidatePath(workspacePath(project.id), 'layout')
  return { status: 'resolved', pending: await pendingCount(scope) }
}

// ---------------------------------------------------------------------------
// The canvas and the graph (the fourth pass, 2026-09-20)
// ---------------------------------------------------------------------------

/**
 * Put a card where the canvas dropped it (`lib/storyboard/actions.ts`,
 * `placeShotOnCanvas`'s shape). Cosmetic - nothing derived reads it - so
 * nothing re-derives, and the layout is not revalidated: the canvas holds
 * the point optimistically and the next read agrees with it.
 */
export const placeCharacterOnCanvas = async (projectId: string, rawId: string, rawPosition: unknown): Promise<PlaceResult> => {
  const id = parseId(rawId)
  const position = CanvasPositionSchema.safeParse(rawPosition)
  if (id === null || !position.success) return { status: 'error', message: 'A card goes at a whole x and y.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const written = await placeCharacter(gate.scope, id, position.data)
  if (!written) return { status: 'error', message: REFUSED_CHARACTER }
  return { status: 'placed' }
}

/**
 * Write a pair's relationship, whole - the modal's `Create` and `Save`.
 * The pair is sorted and the labels swapped with it (`orderInput`), so
 * either end of the modal lands on the one row. Authored beside the
 * record, never derived from it: nothing re-derives, and the label
 * `derive.ts` reads next pass is this row's.
 */
export const saveRelationship = async (projectId: string, rawInput: unknown): Promise<RelationshipResult> => {
  const input = RelationshipInputSchema.safeParse(rawInput)
  if (!input.success) return { status: 'error', message: input.error.issues[0]?.message ?? 'That relationship could not be read.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const ordered = orderInput(input.data)
  const row = await upsertRelationship(gate.scope, {
    aId: ordered.aId,
    bId: ordered.bId,
    aIs: ordered.aIs,
    bIs: ordered.bIs,
    description: ordered.description === '' ? null : ordered.description,
  })
  if (row === null) return { status: 'error', message: 'One of those characters could not be found.' }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved', relationship: relationshipOf(row) }
}

export const deleteRelationship = async (projectId: string, rawA: string, rawB: string): Promise<RelationshipResult> => {
  const a = parseId(rawA)
  const b = parseId(rawB)
  if (a === null || b === null || a === b) return { status: 'error', message: 'That relationship could not be read.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const [x, y] = orderPair(a, b)
  const gone = await deleteRelationshipRow(gate.scope, x, y)
  if (!gone) return { status: 'error', message: 'That relationship is not here any more.' }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'gone' }
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
