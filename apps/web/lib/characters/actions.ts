'use server'

import {
  CharacterIdSchema,
  CharacterProfileEditSchema,
  NewCharacterSchema,
  PORTRAIT_MAX_BYTES,
  PORTRAIT_TYPES,
} from '@folio/contracts'
import type { PortraitType } from '@folio/contracts'
import {
  bindCue,
  createCharacterRecord,
  deleteAbsentCharacter,
  listBoundCues,
  listCharacterRecords,
  listEpisodes,
  listOpenCueRows,
  mergeCharacterRecords,
  readDerivationInput,
  readDocumentByKind,
  readScreenplayNodes,
  recordResolveDecisions,
  renameCharacterRecord,
  rewriteCueNodes,
  setPortraitKey,
  snapshotVersion,
  unbindCue,
  updateCharacterProfile,
} from '@folio/db'
import type { CueNodeRewrite, ProjectScope } from '@folio/db'
import type { CharacterId, ProposalTarget, ResolveSubject } from '@folio/script'
import { canonicalKey, cueSpelling, matchCharacters, readCue, renameCharacterCues } from '@folio/script'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { isRefusal, openProject } from '../script/gate'
import { rederiveProject } from '../script/server'
import { deleteObject, publicUrl, putObject, storageAvailable } from '../storage/r2'
import type {
  BindResult,
  CreateResult,
  DeleteResult,
  DeriveResult,
  MergeResult,
  PortraitResult,
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
 * A profile field, a portrait: authored data on the record, and nothing
 * about the script changed, so nothing is re-derived - a pass that runs
 * later leaves these rows alone because `commitDerivation` never touches
 * an authored table.
 *
 * Binding a cue, a queue decision, a merge, a rename: each changes what the
 * alias table says, and so what the next pass resolves. Each **awaits** a
 * project-wide re-derive before answering, because what the writer sees
 * next - the ghost cards, the counts, the grid - is that pass's output.
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
 * "Not a character." The pure core keeps a row open with no proposal once
 * every candidate and `new-record` have been rejected, and never asks
 * again. So the decision records exactly those rejections -
 * `matchCharacters` lists the candidates by the same scoring the queue
 * uses - in one insert, then re-derives. The row stays open, un-proposed,
 * leaves the badge, and is drawn nowhere.
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
  // holds is left with them; the writer sees it as a ghost card.
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

  const before = (await listCharacterRecords(gate.scope)).find((entry) => entry.id === loser)
  const merged = await mergeCharacterRecords(gate.scope, loser, winner)
  if (!merged) return { status: 'error', message: REFUSED_CHARACTER }
  // The loser's portrait has no card to sit on any more. Best effort: a
  // failed delete leaves an orphan object, never a broken row.
  if (before?.portraitKey !== undefined && before.portraitKey !== null && storageAvailable()) {
    await deleteObject(before.portraitKey)
  }
  await rederiveProject(gate.scope)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'merged', into: winner }
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
