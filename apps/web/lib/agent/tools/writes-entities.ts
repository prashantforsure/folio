import {
  CharacterIdSchema,
  CharacterProfileEditSchema,
  LocationEditSchema,
  LocationIdSchema,
  NewCharacterSchema,
  PropEditSchema,
  RelationshipInputSchema,
} from '@folio/contracts'
import type { CharacterProfileEdit, LocationEdit, PropEdit } from '@folio/contracts'
import { listCharacterRecords, listEpisodes, listLocationRecords, listPropRecords, listRelationships, readDocumentByKind } from '@folio/db'
import type { CharacterRecordRow, LocationRecordRow, PropRecordRow } from '@folio/db'
import type { DocumentId } from '@folio/script'
import { z } from 'zod'

import { ROLE } from '../../auth/roles'
import {
  deleteCharacter,
  deleteRelationship,
  mergeCharacters,
  previewRename as previewCharacterRename,
  renameCharacter,
  resolveCue,
  revokeDecision as revokeCueDecision,
  saveProfile,
  saveRelationship,
  undoRename as undoCharacterRename,
} from '../../characters/actions'
import { createCharacterIn } from '../../characters/create'
import {
  createLocation,
  deleteLocation,
  mergeLocations,
  previewRename as previewLocationRename,
  renameLocation,
  resolveSlugline,
  resolveStructure,
  revokeDecision as revokeLocationDecision,
  saveLocation,
  setParent,
  undoRename as undoLocationRename,
} from '../../locations/actions'
import { createProp, deleteProp, mergeProps, renameProp, saveProp } from '../../props/actions'
import type { RecordChange } from '../diff-view'
import type { ExecContext, ExecOutcome, InvertOutcome } from '../executors'
import type { ToolContext } from '../registry'
import type { WriteTool } from '../write-tool'
import { defineWriteTool } from '../write-tool'

/**
 * The Characters, Locations and Props write tools - `docs/agents/tools.md`,
 * the Phase 3 rows, roadmap task 3.5. Each wraps the action the route's own
 * buttons call, re-gated there for the browser and the agent alike (D2); the
 * one exception is `create_character`, which goes through the action's own
 * body (`characters/create.ts`) so the record says `origin = 'agent'` (D11).
 *
 * **Undo records.** An update stores the fields it overwrote; a rename stores
 * the restore payload `undoRename` needs, as its result hands it back; a
 * relationship stores the row it replaced. A merge and a delete store
 * nothing - neither has an inverse - and the card says so before either is
 * applied. Both are `confirm`, as a rename is: a rename rewrites every cue or
 * heading that is the name, which is its blast radius (tools.md).
 *
 * **Undoing what the writer changed since.** An update's inverse checks the
 * fields still hold what the agent wrote; if the writer edited them after,
 * nothing is overwritten and the old values come back as a new proposal.
 */

const ENTITY = z.enum(['character', 'location', 'prop'])

type Entity = z.infer<typeof ENTITY>

type Failure = { readonly status: string; readonly message?: string }

/** An action's refusal or error, as an operation's failure. */
const failure = (result: Failure, fallback: string): ExecOutcome => ({ ok: false, message: result.message ?? fallback })

const text = (value: unknown): string | null => (value === null || value === undefined || value === '' ? null : String(value))

const FIELD_LABEL: Readonly<Record<string, string>> = {
  color: 'Colour',
  gender: 'Gender',
  age: 'Age',
  role: 'Role',
  bio: 'Bio',
  appearance: 'Appearance',
  description: 'Description',
  address: 'Address',
  status: 'Status',
  scheduledDays: 'Shooting days',
  category: 'Category',
  name: 'Name',
  parent: 'Inside',
}

const changesOf = (before: Readonly<Record<string, unknown>> | null, after: Readonly<Record<string, unknown>>): readonly RecordChange[] =>
  Object.entries(after).map(([field, value]) => ({ field: FIELD_LABEL[field] ?? field, before: before === null ? null : text(before[field]), after: text(value) }))

/** The fields an edit names, as the record holds them now. */
const priorOf = (record: Readonly<Record<string, unknown>>, edit: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  Object.fromEntries(Object.keys(edit).map((field) => [field, record[field] ?? null]))

/** Whether every field still holds what the agent wrote - an empty string saves as null. */
const stillAsWritten = (record: Readonly<Record<string, unknown>>, edit: Readonly<Record<string, unknown>>): boolean =>
  Object.entries(edit).every(([field, value]) => (record[field] ?? null) === (value === '' ? null : (value ?? null)))

const characterById = async (ctx: { readonly gate: ToolContext['gate'] }, id: string): Promise<CharacterRecordRow | undefined> =>
  (await listCharacterRecords(ctx.gate.scope)).find((record) => record.id === id)

const locationById = async (ctx: { readonly gate: ToolContext['gate'] }, id: string): Promise<LocationRecordRow | undefined> =>
  (await listLocationRecords(ctx.gate.scope)).find((record) => record.id === id)

const propById = async (ctx: { readonly gate: ToolContext['gate'] }, id: string): Promise<PropRecordRow | undefined> =>
  (await listPropRecords(ctx.gate.scope)).find((record) => record.id === id)

const nameOf = async (ctx: { readonly gate: ToolContext['gate'] }, entity: Entity, id: string): Promise<string | null> => {
  const record = entity === 'character' ? await characterById(ctx, id) : entity === 'location' ? await locationById(ctx, id) : await propById(ctx, id)
  return record?.name ?? null
}

const ROUTE_OF: Readonly<Record<Entity, 'characters' | 'locations' | 'props'>> = { character: 'characters', location: 'locations', prop: 'props' }

/** Every script document in the project - a rename rewrites cues or headings in all of them (D11 snapshots them first). */
const screenplayDocuments = async (ctx: ExecContext): Promise<readonly DocumentId[]> => {
  const episodes = await listEpisodes(ctx.gate.scope)
  const documents = await Promise.all(episodes.map((episode) => readDocumentByKind(ctx.gate.scope, episode.id, 'screenplay')))
  return documents.flatMap((document) => (document === null ? [] : [document.id]))
}

const IdResult = z.object({ id: z.uuid() })

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const CreateCharacterArgs = NewCharacterSchema

export const createCharacterTool = defineWriteTool({
  name: 'create_character',
  description:
    'Propose a new character record: a name (their cue spelling, e.g. "MEERA"), and optionally a role, bio, age, gender or appearance. ' +
    'Create a character before writing their cues or mentioning them in the script. Check search_project first that they do not already exist.',
  toolset: 'entities',
  minimumRole: ROLE.entityOperation,
  mode: 'propose',
  input: CreateCharacterArgs,
  label: (input) => `Proposing the character ${input.name}`,
  prepare: async (ctx, input) => {
    const taken = (await listCharacterRecords(ctx.gate.scope)).find((record) => record.name.toUpperCase() === input.name.toUpperCase())
    if (taken !== undefined) return { ok: false, message: `There is already a character called ${taken.name} (${taken.id}).` }
    return { ok: true, args: input }
  },
  executor: {
    args: CreateCharacterArgs,
    describe: (args) => `Create the character ${args.name}`,
    target: () => ({ type: 'character', id: null }),
    capture: () => Promise.resolve(null),
    run: async (ctx, args) => {
      const id = await createCharacterIn(ctx.gate.scope, args, ctx.idempotencyKey, 'agent')
      return { ok: true, result: { id }, undo: { id } }
    },
    invert: async (ctx, _args, undo) => {
      const { id } = IdResult.parse(undo)
      const result = await deleteCharacter(ctx.gate.project.id, id)
      if (result.status === 'deleted') return { kind: 'undone' }
      return { kind: 'skipped', reason: `Kept: ${result.message}` }
    },
    preview: (_ctx, args, op) => {
      const { name, ...profile } = args
      const id = IdResult.safeParse(op.result)
      return Promise.resolve({ changes: changesOf(null, { name, ...profile }), open: { route: 'characters', ...(id.success ? { recordId: id.data.id } : {}) } })
    },
  },
})

const CreateLocationArgs = z.object({
  name: z.string().trim().min(1).max(200).describe('The set as it reads in a slugline: "HOSPITAL WARD".'),
  parent: LocationIdSchema.nullable().default(null).describe('The primary set this sits inside, by id; null for a primary set.'),
})

export const createLocationTool = defineWriteTool({
  name: 'create_location',
  description:
    'Propose a new location record - a set, optionally inside a primary set. Create a location before writing scene headings that use it, and reuse its name in the heading exactly.',
  toolset: 'entities',
  minimumRole: ROLE.entityOperation,
  mode: 'propose',
  input: CreateLocationArgs,
  label: (input) => `Proposing the location ${input.name}`,
  prepare: async (ctx, input) => {
    const records = await listLocationRecords(ctx.gate.scope)
    const taken = records.find((record) => record.name.toUpperCase() === input.name.toUpperCase())
    if (taken !== undefined) return { ok: false, message: `There is already a location called ${taken.name} (${taken.id}).` }
    if (input.parent !== null && !records.some((record) => record.id === input.parent)) return { ok: false, message: 'There is no such parent location.' }
    return { ok: true, args: input }
  },
  executor: {
    args: CreateLocationArgs,
    describe: (args) => `Create the location ${args.name}`,
    target: () => ({ type: 'location', id: null }),
    capture: () => Promise.resolve(null),
    run: async (ctx, args) => {
      const result = await createLocation(ctx.gate.project.id, args.name, args.parent, ctx.idempotencyKey)
      return result.status === 'created' ? { ok: true, result: { id: result.id }, undo: { id: result.id } } : failure(result, 'The location could not be created.')
    },
    invert: async (ctx, _args, undo) => {
      const { id } = IdResult.parse(undo)
      const result = await deleteLocation(ctx.gate.project.id, id)
      return result.status === 'deleted' ? { kind: 'undone' } : { kind: 'skipped', reason: `Kept: ${result.message}` }
    },
    preview: (_ctx, args, op) => {
      const id = IdResult.safeParse(op.result)
      return Promise.resolve({ changes: changesOf(null, { name: args.name }), open: { route: 'locations', ...(id.success ? { recordId: id.data.id } : {}) } })
    },
  },
})

const CreatePropArgs = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(80).nullable().default(null),
})

export const createPropTool = defineWriteTool({
  name: 'create_prop',
  description: 'Propose a new prop record, with an optional category ("Hand prop", "Vehicle").',
  toolset: 'entities',
  minimumRole: ROLE.entityOperation,
  mode: 'propose',
  input: CreatePropArgs,
  label: (input) => `Proposing the prop ${input.name}`,
  prepare: async (ctx, input) => {
    const taken = (await listPropRecords(ctx.gate.scope)).find((record) => record.name.toUpperCase() === input.name.toUpperCase())
    if (taken !== undefined) return { ok: false, message: `There is already a prop called ${taken.name} (${taken.id}).` }
    return { ok: true, args: input }
  },
  executor: {
    args: CreatePropArgs,
    describe: (args) => `Create the prop ${args.name}`,
    target: () => ({ type: 'prop', id: null }),
    capture: () => Promise.resolve(null),
    run: async (ctx, args) => {
      const result = await createProp(ctx.gate.project.id, args.name, args.category, ctx.idempotencyKey)
      return result.status === 'created' ? { ok: true, result: { id: result.id }, undo: { id: result.id } } : failure(result, 'The prop could not be created.')
    },
    invert: async (ctx, _args, undo) => {
      const { id } = IdResult.parse(undo)
      const result = await deleteProp(ctx.gate.project.id, id)
      return result.status === 'deleted' ? { kind: 'undone' } : { kind: 'skipped', reason: `Kept: ${result.message}` }
    },
    preview: (_ctx, args, op) => {
      const id = IdResult.safeParse(op.result)
      return Promise.resolve({ changes: changesOf(null, { name: args.name, category: args.category }), open: { route: 'props', ...(id.success ? { recordId: id.data.id } : {}) } })
    },
  },
})

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

const PriorSchema = z.record(z.string(), z.unknown())

/**
 * The three update tools share one shape: read the record, store the fields
 * the edit names as they were, save, and on undo put them back only if they
 * still hold what the agent wrote.
 */
const updateTool = <Edit extends Readonly<Record<string, unknown>>>(spec: {
  readonly name: 'update_character' | 'update_location' | 'update_prop'
  readonly entity: Entity
  readonly description: string
  readonly edit: z.ZodType<Edit>
  readonly read: (ctx: { readonly gate: ToolContext['gate'] }, id: string) => Promise<Readonly<Record<string, unknown>> | undefined>
  readonly save: (projectId: string, id: string, edit: Edit) => Promise<Failure>
}) => {
  const Args = z.object({ id: z.uuid(), name: z.string(), edit: spec.edit })
  const Input = z.object({ id: z.uuid().describe(`The ${spec.entity}'s id.`), edit: spec.edit })
  return defineWriteTool({
    name: spec.name,
    description: spec.description,
    toolset: 'entities',
    minimumRole: ROLE.authoredEdit,
    mode: 'propose',
    input: Input,
    label: () => `Proposing an edit to a ${spec.entity}`,
    prepare: async (ctx, input) => {
      if (Object.keys(input.edit).length === 0) return { ok: false, message: 'The edit names no field.' }
      const record = await spec.read(ctx, input.id)
      if (record === undefined) return { ok: false, message: `There is no such ${spec.entity}.` }
      return { ok: true, args: { id: input.id, name: String(record['name']), edit: input.edit } }
    },
    executor: {
      args: Args,
      describe: (args) => `Update ${args.name}: ${Object.keys(args.edit).map((field) => (FIELD_LABEL[field] ?? field).toLowerCase()).join(', ')}`,
      target: (args) => ({ type: spec.entity, id: args.id }),
      capture: async (ctx, args) => {
        const record = await spec.read(ctx, args.id)
        return record === undefined ? null : priorOf(record, args.edit)
      },
      run: async (ctx, args) => {
        const result = await spec.save(ctx.gate.project.id, args.id, args.edit)
        return result.status === 'saved' ? { ok: true, result: { saved: true } } : failure(result, `The ${spec.entity} could not be saved.`)
      },
      invert: async (ctx, args, undo): Promise<InvertOutcome> => {
        const prior = PriorSchema.parse(undo)
        const record = await spec.read(ctx, args.id)
        if (record === undefined) return { kind: 'skipped', reason: `The ${spec.entity} no longer exists.` }
        if (!stillAsWritten(record, args.edit)) {
          return { kind: 'changed', note: `${args.name} was edited after the run.`, ops: [{ tool: spec.name, args: { id: args.id, name: args.name, edit: prior }, mode: 'propose' }] }
        }
        const restored = spec.edit.safeParse(prior)
        if (!restored.success) return { kind: 'failed', message: 'The prior values did not read.' }
        const result = await spec.save(ctx.gate.project.id, args.id, restored.data)
        return result.status === 'saved' ? { kind: 'undone' } : { kind: 'failed', message: result.message ?? 'It could not be put back.' }
      },
      preview: async (ctx, args, op) => {
        const before = op.status === 'pending' ? ((await spec.read(ctx, args.id)) ?? null) : PriorSchema.safeParse(op.undo).success ? PriorSchema.parse(op.undo) : null
        return { changes: changesOf(before, args.edit), open: { route: ROUTE_OF[spec.entity], recordId: args.id } }
      },
    },
  })
}

export const updateCharacterTool = updateTool<CharacterProfileEdit>({
  name: 'update_character',
  entity: 'character',
  description: "Propose changes to a character's record: colour, gender, age, role, bio or appearance. Only the fields you name change.",
  edit: CharacterProfileEditSchema,
  read: characterById,
  save: saveProfile,
})

export const updateLocationTool = updateTool<LocationEdit>({
  name: 'update_location',
  entity: 'location',
  description: "Propose changes to a location's record: description, address, status (pending, scouted, locked) or scheduled shooting days.",
  edit: LocationEditSchema,
  read: locationById,
  save: saveLocation,
})

export const updatePropTool = updateTool<PropEdit>({
  name: 'update_prop',
  entity: 'prop',
  description: "Propose changes to a prop's record: category, description or status (needed, sourced, on set).",
  edit: PropEditSchema,
  read: propById,
  save: saveProp,
})

// ---------------------------------------------------------------------------
// Rename, merge, delete - confirm
// ---------------------------------------------------------------------------

const RenameInput = z.object({ entity: ENTITY, id: z.uuid(), name: z.string().trim().min(1).max(200).describe('The new name.') })
const RenameArgs = z.object({ entity: ENTITY, id: z.uuid(), from: z.string(), to: z.string(), reach: z.string() })

const CharacterUndo = z.object({ previousName: z.string(), restores: z.array(z.object({ episode: z.string(), restores: z.array(z.object({ id: z.string(), text: z.string() })) })) })
const PropUndo = z.object({ previousName: z.string() })

export const renameEntityTool = defineWriteTool({
  name: 'rename_entity',
  description:
    'Propose renaming a character, location or prop. A character rename rewrites every cue that is the name, in every episode; a location rename rewrites every scene heading that uses it. ' +
    'The tool previews the rename first and refuses a name already taken. The writer always confirms a rename.',
  toolset: 'entities',
  minimumRole: ROLE.entityOperation,
  mode: 'confirm',
  input: RenameInput,
  label: (input) => `Proposing a ${input.entity} rename`,
  // The preview is not optional (roadmap task 3.5): its counts are the blast radius the confirmation names.
  prepare: async (ctx, input) => {
    const from = await nameOf(ctx, input.entity, input.id)
    if (from === null) return { ok: false, message: `There is no such ${input.entity}.` }
    if (input.entity === 'prop') return { ok: true, args: { ...input, from, to: input.name, reach: '' } }
    const preview = input.entity === 'character' ? await previewCharacterRename(ctx.gate.project.id, input.id, input.name) : await previewLocationRename(ctx.gate.project.id, input.id, input.name)
    if (preview.status !== 'preview') return { ok: false, message: preview.message }
    if (preview.taken !== null) return { ok: false, message: `${preview.to} is already ${preview.taken.name}'s name. Merge the two instead, or choose another name.` }
    const count = 'cues' in preview ? preview.cues : preview.headings
    const unit = input.entity === 'character' ? 'cue' : 'heading'
    const reach = ` - rewrites ${String(count)} ${unit}${count === 1 ? '' : 's'} in ${String(preview.episodes.length)} episode${preview.episodes.length === 1 ? '' : 's'}`
    return { ok: true, args: { ...input, from, to: preview.to, reach }, note: { preview } }
  },
  executor: {
    args: RenameArgs,
    describe: (args) => `Rename ${args.from} to ${args.to}${args.reach}`,
    target: (args) => ({ type: args.entity, id: args.id }),
    documents: (ctx, args) => (args.entity === 'prop' ? Promise.resolve([]) : screenplayDocuments(ctx)),
    capture: (_ctx, args) => Promise.resolve({ previousName: args.from }),
    run: async (ctx, args) => {
      if (args.entity === 'character') {
        const result = await renameCharacter(ctx.gate.project.id, args.id, args.to)
        if (result.status === 'renamed') return { ok: true, result: { cues: result.cues, episodes: result.episodes }, undo: { previousName: result.previousName, restores: result.restores } }
        if (result.status === 'taken') return { ok: false, message: `${result.name} is already another character's name.` }
        return failure(result, 'The rename did not run.')
      }
      if (args.entity === 'location') {
        const result = await renameLocation(ctx.gate.project.id, args.id, args.to)
        if (result.status === 'renamed') return { ok: true, result: { headings: result.headings, episodes: result.episodes }, undo: result.undo }
        if (result.status === 'taken') return { ok: false, message: `${result.name} is already another location's name.` }
        return failure(result, 'The rename did not run.')
      }
      const result = await renameProp(ctx.gate.project.id, args.id, args.to)
      return result.status === 'saved' ? { ok: true, result: { renamed: true }, undo: { previousName: args.from } } : failure(result, 'The rename did not run.')
    },
    // The restore payload the rename handed back is what its own undo takes.
    invert: async (ctx, args, undo) => {
      if (args.entity === 'character') {
        const result = await undoCharacterRename(ctx.gate.project.id, args.id, CharacterUndo.parse(undo))
        return result.status === 'undone' ? { kind: 'undone', ...(result.skipped > 0 ? { note: `${String(result.skipped)} cue(s) edited since were left.` } : {}) } : { kind: 'failed', message: result.message }
      }
      if (args.entity === 'location') {
        const result = await undoLocationRename(ctx.gate.project.id, undo)
        return result.status === 'undone' ? { kind: 'undone', ...(result.skipped > 0 ? { note: `${String(result.skipped)} heading(s) edited since were left.` } : {}) } : { kind: 'failed', message: result.message }
      }
      const result = await renameProp(ctx.gate.project.id, args.id, PropUndo.parse(undo).previousName)
      return result.status === 'saved' ? { kind: 'undone' } : { kind: 'failed', message: result.message }
    },
    preview: (_ctx, args) => Promise.resolve({ changes: [{ field: 'Name', before: args.from, after: args.to }], open: { route: ROUTE_OF[args.entity], recordId: args.id } }),
  },
})

const MergeInput = z.object({
  entity: ENTITY,
  loser: z.uuid().describe('The record that goes away; its spellings move to the winner.'),
  winner: z.uuid().describe('The record that stays.'),
})
const MergeArgs = MergeInput.extend({ loserName: z.string(), winnerName: z.string() })

export const mergeEntitiesTool = defineWriteTool({
  name: 'merge_entities',
  description:
    'Propose merging two records of the same kind that are the same person, place or thing: the loser\'s spellings and relationships move to the winner. It cannot be undone, and the writer always confirms it.',
  toolset: 'entities',
  minimumRole: ROLE.entityOperation,
  mode: 'confirm',
  input: MergeInput,
  label: (input) => `Proposing a ${input.entity} merge`,
  prepare: async (ctx, input) => {
    if (input.loser === input.winner) return { ok: false, message: 'A record cannot be merged into itself.' }
    const [loserName, winnerName] = await Promise.all([nameOf(ctx, input.entity, input.loser), nameOf(ctx, input.entity, input.winner)])
    if (loserName === null || winnerName === null) return { ok: false, message: `Both must be live ${input.entity} records.` }
    return { ok: true, args: { ...input, loserName, winnerName } }
  },
  executor: {
    args: MergeArgs,
    describe: (args) => `Merge ${args.loserName} into ${args.winnerName}`,
    target: (args) => ({ type: args.entity, id: args.winner }),
    documents: () => Promise.resolve([]),
    capture: () => Promise.resolve(null),
    run: async (ctx, args) => {
      const projectId = ctx.gate.project.id
      const result = args.entity === 'character' ? await mergeCharacters(projectId, args.loser, args.winner) : args.entity === 'location' ? await mergeLocations(projectId, args.loser, args.winner) : await mergeProps(projectId, args.loser, args.winner)
      return result.status === 'merged' ? { ok: true, result: { into: args.winner } } : failure(result, 'The merge did not run.')
    },
    preview: (_ctx, args) => Promise.resolve({ changes: [{ field: 'Merged into', before: args.loserName, after: args.winnerName }], open: { route: ROUTE_OF[args.entity], recordId: args.winner } }),
  },
})

const DeleteInput = z.object({ entity: ENTITY, id: z.uuid() })
const DeleteArgs = DeleteInput.extend({ name: z.string() })

export const deleteEntityTool = defineWriteTool({
  name: 'delete_entity',
  description: 'Propose deleting a record the script does not use. A record the script still uses is refused. It cannot be undone, and the writer always confirms it.',
  toolset: 'entities',
  minimumRole: ROLE.entityOperation,
  mode: 'confirm',
  input: DeleteInput,
  label: (input) => `Proposing to delete a ${input.entity}`,
  prepare: async (ctx, input) => {
    const name = await nameOf(ctx, input.entity, input.id)
    return name === null ? { ok: false, message: `There is no such ${input.entity}.` } : { ok: true, args: { ...input, name } }
  },
  executor: {
    args: DeleteArgs,
    describe: (args) => `Delete the ${args.entity} ${args.name}`,
    target: (args) => ({ type: args.entity, id: args.id }),
    capture: () => Promise.resolve(null),
    run: async (ctx, args) => {
      const projectId = ctx.gate.project.id
      const result = args.entity === 'character' ? await deleteCharacter(projectId, args.id) : args.entity === 'location' ? await deleteLocation(projectId, args.id) : await deleteProp(projectId, args.id)
      return result.status === 'deleted' ? { ok: true, result: { deleted: args.id } } : failure(result, 'The delete did not run.')
    },
    preview: (_ctx, args) => Promise.resolve({ changes: [{ field: 'Record', before: args.name, after: null }] }),
  },
})

// ---------------------------------------------------------------------------
// The location tree, the resolve queue, relationships
// ---------------------------------------------------------------------------

const ParentInput = z.object({ id: LocationIdSchema, parent: LocationIdSchema.nullable().describe('The primary set it sits inside; null makes it a primary set.') })
const ParentArgs = z.object({ id: z.uuid(), parent: z.uuid().nullable(), name: z.string(), parentName: z.string().nullable() })
const ParentUndo = z.object({ parent: z.uuid().nullable(), parentName: z.string().nullable() })

export const setLocationParentTool = defineWriteTool({
  name: 'set_location_parent',
  description: 'Propose putting a location inside a primary set ("WARD" inside "HOSPITAL"), or making it a primary set again with parent null.',
  toolset: 'entities',
  minimumRole: ROLE.entityOperation,
  mode: 'propose',
  input: ParentInput,
  label: () => 'Proposing a set move',
  prepare: async (ctx, input) => {
    const records = await listLocationRecords(ctx.gate.scope)
    const record = records.find((entry) => entry.id === input.id)
    if (record === undefined) return { ok: false, message: 'There is no such location.' }
    const parent = input.parent === null ? null : records.find((entry) => entry.id === input.parent)
    if (parent === undefined) return { ok: false, message: 'There is no such parent location.' }
    return { ok: true, args: { id: input.id, parent: input.parent, name: record.name, parentName: parent === null ? null : parent.name } }
  },
  executor: {
    args: ParentArgs,
    describe: (args) => (args.parentName === null ? `Make ${args.name} a primary set` : `Put ${args.name} inside ${args.parentName}`),
    target: (args) => ({ type: 'location', id: args.id }),
    capture: async (ctx, args) => {
      const records = await listLocationRecords(ctx.gate.scope)
      const record = records.find((entry) => entry.id === args.id)
      const parent = record?.parentId === null || record === undefined ? null : records.find((entry) => entry.id === record.parentId)
      return { parent: record?.parentId ?? null, parentName: parent?.name ?? null }
    },
    run: async (ctx, args) => {
      const result = await setParent(ctx.gate.project.id, args.id, args.parent)
      return result.status === 'saved' ? { ok: true, result: { saved: true } } : failure(result, 'The set could not be moved.')
    },
    invert: async (ctx, args, undo) => {
      const prior = ParentUndo.parse(undo)
      const record = await locationById(ctx, args.id)
      if (record === undefined) return { kind: 'skipped', reason: 'The location no longer exists.' }
      if ((record.parentId ?? null) !== args.parent) {
        return { kind: 'changed', note: `${args.name} was moved after the run.`, ops: [{ tool: 'set_location_parent', args: { id: args.id, parent: prior.parent, name: args.name, parentName: prior.parentName }, mode: 'propose' }] }
      }
      const result = await setParent(ctx.gate.project.id, args.id, prior.parent)
      return result.status === 'saved' ? { kind: 'undone' } : { kind: 'failed', message: result.message }
    },
    preview: async (ctx, args, op) => {
      const before = op.status === 'pending' ? await locationById(ctx, args.id) : undefined
      const beforeParent = before === undefined ? (ParentUndo.safeParse(op.undo).success ? ParentUndo.parse(op.undo).parentName : null) : before.parentId === null ? null : ((await locationById(ctx, before.parentId))?.name ?? null)
      return { changes: [{ field: 'Inside', before: beforeParent ?? 'a primary set', after: args.parentName ?? 'a primary set' }], open: { route: 'locations', recordId: args.id } }
    },
  },
})

const CueChoice = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('proposal') }),
  z.object({ kind: z.literal('character'), id: CharacterIdSchema }),
  z.object({ kind: z.literal('new-record') }),
  z.object({ kind: z.literal('walk-on') }),
  z.object({ kind: z.literal('not-this'), id: CharacterIdSchema }),
])
const SluglineChoice = z.discriminatedUnion('kind', [z.object({ kind: z.literal('proposal') }), z.object({ kind: z.literal('location'), id: LocationIdSchema }), z.object({ kind: z.literal('new-record') })])
const StructureChoice = z.discriminatedUnion('kind', [z.object({ kind: z.literal('accept') }), z.object({ kind: z.literal('reject') })])

const ResolveInput = z.discriminatedUnion('queue', [
  z.object({ queue: z.literal('cue'), key: z.string().min(1).max(400), choice: CueChoice }),
  z.object({ queue: z.literal('slugline'), key: z.string().min(1).max(400), choice: SluglineChoice }),
  z.object({ queue: z.literal('structure'), key: z.string().min(1).max(400), choice: StructureChoice }),
])

type ResolveArgs = z.infer<typeof ResolveInput>

/** What `revokeDecision` takes to take a resolution back - where the choice has one. */
const revocationOf = (args: ResolveArgs): unknown => {
  if (args.queue === 'cue') {
    switch (args.choice.kind) {
      case 'character':
        return { kind: 'bound', id: args.choice.id }
      case 'new-record':
        return { kind: 'new-record' }
      case 'walk-on':
        return { kind: 'walk-on' }
      case 'not-this':
        return { kind: 'not-this', id: args.choice.id }
      case 'proposal':
        return null
    }
  }
  if (args.queue === 'slugline') {
    switch (args.choice.kind) {
      case 'location':
        return { kind: 'bound', id: args.choice.id }
      case 'new-record':
        return { kind: 'new-record' }
      case 'proposal':
        return null
    }
  }
  return args.choice.kind === 'reject' ? { kind: 'not-inside' } : null
}

export const resolveQueueItemTool = defineWriteTool({
  name: 'resolve_queue_item',
  description:
    "Propose an answer to one item of the resolve queue: a cue that names nobody yet (bind it to a character, make a new record, call it a walk-on, or say it is not someone), a slugline that names no location, or a set that reads as inside another. The key is the queue item's own.",
  toolset: 'entities',
  minimumRole: ROLE.entityOperation,
  mode: 'propose',
  input: ResolveInput,
  label: (input) => `Proposing an answer for a ${input.queue}`,
  prepare: (_ctx, input) => Promise.resolve({ ok: true, args: input }),
  executor: {
    args: ResolveInput,
    describe: (args) => `Resolve ${args.key}: ${args.choice.kind === 'new-record' ? 'a new record' : args.choice.kind}`,
    target: (args) => ({ type: args.queue, id: null }),
    irreversible: (args) => revocationOf(args) === null,
    capture: (_ctx, args) => Promise.resolve(revocationOf(args)),
    run: async (ctx, args) => {
      const projectId = ctx.gate.project.id
      const result =
        args.queue === 'cue' ? await resolveCue(projectId, args.key, args.choice) : args.queue === 'slugline' ? await resolveSlugline(projectId, args.key, args.choice) : await resolveStructure(projectId, args.key, args.choice)
      return result.status === 'resolved' ? { ok: true, result: { resolved: args.key } } : failure(result, 'That queue item could not be resolved.')
    },
    invert: async (ctx, args, undo) => {
      const projectId = ctx.gate.project.id
      const result = args.queue === 'cue' ? await revokeCueDecision(projectId, args.key, undo) : await revokeLocationDecision(projectId, args.key, undo)
      return result.status === 'resolved' ? { kind: 'undone' } : { kind: 'failed', message: result.message }
    },
    preview: (_ctx, args) => Promise.resolve({ open: { route: args.queue === 'cue' ? 'characters' : 'locations' } }),
  },
})

const RelationshipArgs = z.object({ input: RelationshipInputSchema, aName: z.string(), bName: z.string() })
const RelationshipUndo = z.object({ prior: RelationshipInputSchema.nullable() })

/** The pair's row as it stands, in `saveRelationship`'s input shape, whichever way round it was asked. */
const priorRelationship = async (ctx: { readonly gate: ToolContext['gate'] }, aId: string, bId: string) => {
  const row = (await listRelationships(ctx.gate.scope)).find((entry) => (entry.aId === aId && entry.bId === bId) || (entry.aId === bId && entry.bId === aId))
  if (row === undefined) return null
  return row.aId === aId ? { aId: row.aId, bId: row.bId, aIs: row.aIs, bIs: row.bIs, description: row.description } : { aId: row.bId, bId: row.aId, aIs: row.bIs, bIs: row.aIs, description: row.description }
}

const namesOfPair = async (ctx: { readonly gate: ToolContext['gate'] }, aId: string, bId: string): Promise<readonly [string, string] | null> => {
  const [a, b] = await Promise.all([characterById(ctx, aId), characterById(ctx, bId)])
  return a === undefined || b === undefined ? null : [a.name, b.name]
}

export const saveRelationshipTool = defineWriteTool({
  name: 'save_relationship',
  description:
    'Propose the relationship between two characters as two short labels, one each way ("aIs": what A is to B, "bIs": what B is to A - "mother" / "son"), with an optional line of description. Replaces what the pair had.',
  toolset: 'entities',
  minimumRole: ROLE.authoredEdit,
  mode: 'propose',
  input: RelationshipInputSchema,
  label: () => 'Proposing a relationship',
  prepare: async (ctx, input) => {
    const names = await namesOfPair(ctx, input.aId, input.bId)
    return names === null ? { ok: false, message: 'Both characters must be live records.' } : { ok: true, args: { input, aName: names[0], bName: names[1] } }
  },
  executor: {
    args: RelationshipArgs,
    describe: (args) => `Set ${args.aName} and ${args.bName}: ${args.input.aIs || '—'} / ${args.input.bIs || '—'}`,
    target: (args) => ({ type: 'character', id: args.input.aId }),
    capture: async (ctx, args) => ({ prior: await priorRelationship(ctx, args.input.aId, args.input.bId) }),
    run: async (ctx, args) => {
      const result = await saveRelationship(ctx.gate.project.id, args.input)
      return result.status === 'saved' ? { ok: true, result: { saved: true } } : failure(result, 'The relationship could not be saved.')
    },
    invert: async (ctx, args, undo) => {
      const { prior } = RelationshipUndo.parse(undo)
      const result = prior === null ? await deleteRelationship(ctx.gate.project.id, args.input.aId, args.input.bId) : await saveRelationship(ctx.gate.project.id, prior)
      return result.status === 'saved' || result.status === 'gone' ? { kind: 'undone' } : { kind: 'failed', message: result.message }
    },
    preview: async (ctx, args, op) => {
      const prior = op.status === 'pending' ? await priorRelationship(ctx, args.input.aId, args.input.bId) : (RelationshipUndo.safeParse(op.undo).data?.prior ?? null)
      return {
        changes: [
          { field: `${args.aName} is`, before: prior?.aIs ?? null, after: args.input.aIs || null },
          { field: `${args.bName} is`, before: prior?.bIs ?? null, after: args.input.bIs || null },
          ...(args.input.description === null && (prior?.description ?? null) === null ? [] : [{ field: 'Description', before: prior?.description ?? null, after: args.input.description }]),
        ],
        open: { route: 'characters', recordId: args.input.aId },
      }
    },
  },
})

const DeleteRelationshipInput = z.object({ aId: CharacterIdSchema, bId: CharacterIdSchema })
const DeleteRelationshipArgs = z.object({ aId: z.uuid(), bId: z.uuid(), aName: z.string(), bName: z.string() })

export const deleteRelationshipTool = defineWriteTool({
  name: 'delete_relationship',
  description: 'Propose removing the relationship between two characters.',
  toolset: 'entities',
  minimumRole: ROLE.authoredEdit,
  mode: 'propose',
  input: DeleteRelationshipInput,
  label: () => 'Proposing to remove a relationship',
  prepare: async (ctx, input) => {
    const names = await namesOfPair(ctx, input.aId, input.bId)
    if (names === null) return { ok: false, message: 'Both characters must be live records.' }
    if ((await priorRelationship(ctx, input.aId, input.bId)) === null) return { ok: false, message: 'Those two have no relationship to remove.' }
    return { ok: true, args: { aId: input.aId, bId: input.bId, aName: names[0], bName: names[1] } }
  },
  executor: {
    args: DeleteRelationshipArgs,
    describe: (args) => `Remove the relationship between ${args.aName} and ${args.bName}`,
    target: (args) => ({ type: 'character', id: args.aId }),
    capture: async (ctx, args) => ({ prior: await priorRelationship(ctx, args.aId, args.bId) }),
    run: async (ctx, args) => {
      const result = await deleteRelationship(ctx.gate.project.id, args.aId, args.bId)
      return result.status === 'gone' ? { ok: true, result: { removed: true } } : failure(result, 'The relationship could not be removed.')
    },
    invert: async (ctx, _args, undo) => {
      const { prior } = RelationshipUndo.parse(undo)
      if (prior === null) return { kind: 'undone' }
      const result = await saveRelationship(ctx.gate.project.id, prior)
      return result.status === 'saved' ? { kind: 'undone' } : { kind: 'failed', message: result.status === 'gone' ? 'A character in it is gone.' : result.message }
    },
    preview: (_ctx, args) => Promise.resolve({ open: { route: 'characters', recordId: args.aId } }),
  },
})

export const ENTITY_WRITE_TOOLS: readonly WriteTool[] = [
  createCharacterTool,
  createLocationTool,
  createPropTool,
  updateCharacterTool,
  updateLocationTool,
  updatePropTool,
  renameEntityTool,
  mergeEntitiesTool,
  deleteEntityTool,
  setLocationParentTool,
  resolveQueueItemTool,
  saveRelationshipTool,
  deleteRelationshipTool,
]

