import type { OutlineDocument, ScreenplayDocument } from './document'
import type { CharacterId, LocationId } from './ids'
import { characterId, documentId, locationId, nodeId, runId } from './ids'
import type { InlineContent, InlineRun, MentionTarget } from './inline'
import { INLINE_KINDS, MENTION_ENTITIES } from './inline'
import type { DeliveryModifier, ScreenplayNode } from './node'
import {
  DELIVERY_MODIFIERS,
  PAGINATION_FIELDS,
  SCREENPLAY_NODE_TYPES,
  isDeliveryModifier,
  isScreenplayNodeType,
} from './node'
import type { OutlineNode } from './outline'
import { OUTLINE_NODE_TYPES, isOutlineNodeType } from './outline'
import type { Provenance } from './provenance'
import { PROVENANCE_SOURCES } from './provenance'
import type { Result } from './result'
import { err, ok } from './result'

/**
 * Reading untrusted values into the model.
 *
 * "Rejecting anything outside the eight types is that schema's entire job"
 * (AGENTS.md, The node model) is a claim about runtime as much as compile time:
 * nodes arrive from a database row, from an agent proposal and from an import,
 * and a TypeScript union rejects none of those on its own.
 *
 * Nothing here throws. A malformed value is a `ModelDefect` in the return type,
 * per AGENTS.md, Conventions > Errors.
 *
 * Reading is **strict**: an unrecognised field is a rejection, not something to
 * ignore. A node model whose whole job is to be closed cannot quietly carry a
 * field it does not understand. The cost is that adding a field to a node
 * becomes a breaking wire change - which is correct, since AGENTS.md, When to
 * ask first already lists changing the node schema as needing an ADR.
 *
 * Defects are first-failure-wins, not accumulated. Accumulation is worth adding
 * when a UI needs to show every problem in an import at once.
 */

export type DefectReason =
  | { readonly kind: 'not-an-object'; readonly received: string }
  | { readonly kind: 'not-an-array'; readonly received: string }
  | { readonly kind: 'not-a-string'; readonly received: string }
  | { readonly kind: 'missing-field'; readonly field: string }
  | { readonly kind: 'unexpected-field'; readonly field: string }
  /** A page number tried to ride in on a node. See `NoPagination` in `node.ts`. */
  | { readonly kind: 'pagination-on-node'; readonly field: string }
  | { readonly kind: 'empty-id' }
  | { readonly kind: 'duplicate-node-id'; readonly id: string }
  | {
      readonly kind: 'unknown-value'
      readonly received: string
      readonly allowed: readonly string[]
    }

export type ModelDefect = {
  /** Dotted path from the value that was read. `''` is the value itself. */
  readonly at: string
  readonly reason: DefectReason
}

const describeValue = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const at = (path: string, key: string): string => (path === '' ? key : `${path}.${key}`)

const atIndex = (path: string, index: number): string => `${path}[${index}]`

const defect = (path: string, reason: DefectReason): ModelDefect => ({ at: path, reason })

const prefix = (error: ModelDefect, path: string): ModelDefect => ({
  at: error.at === '' ? path : `${path}.${error.at}`,
  reason: error.reason,
})

/**
 * Pagination fields first, then anything else unrecognised.
 *
 * The ordering matters: a node carrying both a page and some other stray field
 * must report the page, because that is the failure worth the loud message.
 */
const firstUnexpectedField = (
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): ModelDefect | undefined => {
  for (const field of PAGINATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      return defect(at(path, field), { kind: 'pagination-on-node', field })
    }
  }
  for (const field of Object.keys(record)) {
    if (!allowed.includes(field)) {
      return defect(at(path, field), { kind: 'unexpected-field', field })
    }
  }
  return undefined
}

const readIdString = (
  record: Record<string, unknown>,
  field: string,
  path: string,
): Result<string, ModelDefect> => {
  const raw = record[field]
  if (raw === undefined) return err(defect(path, { kind: 'missing-field', field }))
  if (typeof raw !== 'string') {
    return err(defect(at(path, field), { kind: 'not-a-string', received: describeValue(raw) }))
  }
  // The only assertion this package makes about the shape of an id. An empty
  // string cannot serve as a join key under any candidate format ruling;
  // nothing beyond this is checked until that ruling lands. See `ids.ts`.
  if (raw === '') return err(defect(at(path, field), { kind: 'empty-id' }))
  return ok(raw)
}

const readProvenance = (raw: unknown, path: string): Result<Provenance, ModelDefect> => {
  if (!isRecord(raw)) {
    return err(defect(path, { kind: 'not-an-object', received: describeValue(raw) }))
  }
  const source = raw['source']
  if (source === undefined) return err(defect(path, { kind: 'missing-field', field: 'source' }))
  if (typeof source !== 'string') {
    return err(defect(at(path, 'source'), { kind: 'not-a-string', received: describeValue(source) }))
  }
  if (source === 'typed') {
    const unexpected = firstUnexpectedField(raw, ['source'], path)
    if (unexpected !== undefined) return err(unexpected)
    return ok({ source: 'typed' })
  }
  if (source === 'agent') {
    const run = readIdString(raw, 'runId', path)
    if (!run.ok) return run
    const unexpected = firstUnexpectedField(raw, ['source', 'runId'], path)
    if (unexpected !== undefined) return err(unexpected)
    return ok({ source: 'agent', runId: runId(run.value) })
  }
  return err(
    defect(at(path, 'source'), {
      kind: 'unknown-value',
      received: source,
      allowed: PROVENANCE_SOURCES,
    }),
  )
}

const readMentionTarget = (raw: unknown, path: string): Result<MentionTarget, ModelDefect> => {
  if (!isRecord(raw)) {
    return err(defect(path, { kind: 'not-an-object', received: describeValue(raw) }))
  }
  const entity = raw['entity']
  if (entity === undefined) return err(defect(path, { kind: 'missing-field', field: 'entity' }))
  if (typeof entity !== 'string') {
    return err(defect(at(path, 'entity'), { kind: 'not-a-string', received: describeValue(entity) }))
  }
  if (entity !== 'character' && entity !== 'location') {
    return err(
      defect(at(path, 'entity'), {
        kind: 'unknown-value',
        received: entity,
        allowed: MENTION_ENTITIES,
      }),
    )
  }
  const id = readIdString(raw, 'id', path)
  if (!id.ok) return id
  const unexpected = firstUnexpectedField(raw, ['entity', 'id'], path)
  if (unexpected !== undefined) return err(unexpected)
  if (entity === 'character') {
    const target: CharacterId = characterId(id.value)
    return ok({ entity: 'character', id: target })
  }
  const target: LocationId = locationId(id.value)
  return ok({ entity: 'location', id: target })
}

const readInlineRun = (raw: unknown, path: string): Result<InlineRun, ModelDefect> => {
  if (!isRecord(raw)) {
    return err(defect(path, { kind: 'not-an-object', received: describeValue(raw) }))
  }
  const kind = raw['kind']
  if (kind === undefined) return err(defect(path, { kind: 'missing-field', field: 'kind' }))
  if (typeof kind !== 'string') {
    return err(defect(at(path, 'kind'), { kind: 'not-a-string', received: describeValue(kind) }))
  }
  if (kind === 'text') {
    const value = raw['text']
    if (value === undefined) return err(defect(path, { kind: 'missing-field', field: 'text' }))
    if (typeof value !== 'string') {
      return err(defect(at(path, 'text'), { kind: 'not-a-string', received: describeValue(value) }))
    }
    const unexpected = firstUnexpectedField(raw, ['kind', 'text'], path)
    if (unexpected !== undefined) return err(unexpected)
    return ok({ kind: 'text', text: value })
  }
  if (kind === 'mention') {
    if (raw['target'] === undefined) {
      return err(defect(path, { kind: 'missing-field', field: 'target' }))
    }
    const target = readMentionTarget(raw['target'], at(path, 'target'))
    if (!target.ok) return target
    const unexpected = firstUnexpectedField(raw, ['kind', 'target'], path)
    if (unexpected !== undefined) return err(unexpected)
    return ok({ kind: 'mention', target: target.value })
  }
  return err(
    defect(at(path, 'kind'), { kind: 'unknown-value', received: kind, allowed: INLINE_KINDS }),
  )
}

const readContent = (raw: unknown, path: string): Result<InlineContent, ModelDefect> => {
  if (!Array.isArray(raw)) {
    return err(defect(path, { kind: 'not-an-array', received: describeValue(raw) }))
  }
  const runs: InlineRun[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const run = readInlineRun(raw[index], atIndex(path, index))
    if (!run.ok) return run
    runs.push(run.value)
  }
  return ok(runs)
}

const readModifiers = (
  raw: unknown,
  path: string,
): Result<readonly DeliveryModifier[], ModelDefect> => {
  if (!Array.isArray(raw)) {
    return err(defect(path, { kind: 'not-an-array', received: describeValue(raw) }))
  }
  const modifiers: DeliveryModifier[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const value: unknown = raw[index]
    if (typeof value !== 'string') {
      return err(
        defect(atIndex(path, index), { kind: 'not-a-string', received: describeValue(value) }),
      )
    }
    if (!isDeliveryModifier(value)) {
      // The generated modifiers land here, which is the point of the check:
      // they are layout artefacts, stripped on import, never stored.
      return err(
        defect(atIndex(path, index), {
          kind: 'unknown-value',
          received: value,
          allowed: DELIVERY_MODIFIERS,
        }),
      )
    }
    modifiers.push(value)
  }
  return ok(modifiers)
}

type NodeShell = {
  readonly type: string
  readonly id: string
  readonly provenance: Provenance
  readonly record: Record<string, unknown>
}

const readNodeShell = (input: unknown): Result<NodeShell, ModelDefect> => {
  if (!isRecord(input)) {
    return err(defect('', { kind: 'not-an-object', received: describeValue(input) }))
  }
  const rawType = input['type']
  if (rawType === undefined) return err(defect('', { kind: 'missing-field', field: 'type' }))
  if (typeof rawType !== 'string') {
    return err(defect('type', { kind: 'not-a-string', received: describeValue(rawType) }))
  }
  const id = readIdString(input, 'id', '')
  if (!id.ok) return id
  if (input['provenance'] === undefined) {
    return err(defect('', { kind: 'missing-field', field: 'provenance' }))
  }
  const provenance = readProvenance(input['provenance'], 'provenance')
  if (!provenance.ok) return provenance
  return ok({ type: rawType, id: id.value, provenance: provenance.value, record: input })
}

/**
 * Read one screenplay node.
 *
 * Rejects the outline block set, anything carrying a page, and everything else
 * outside the eight types.
 */
export const readScreenplayNode = (input: unknown): Result<ScreenplayNode, ModelDefect> => {
  const shell = readNodeShell(input)
  if (!shell.ok) return shell
  const { type, id, provenance, record } = shell.value
  if (!isScreenplayNodeType(type)) {
    return err(
      defect('type', { kind: 'unknown-value', received: type, allowed: SCREENPLAY_NODE_TYPES }),
    )
  }
  const allowed =
    type === 'character'
      ? ['type', 'id', 'provenance', 'content', 'modifiers']
      : ['type', 'id', 'provenance', 'content']
  const unexpected = firstUnexpectedField(record, allowed, '')
  if (unexpected !== undefined) return err(unexpected)
  if (record['content'] === undefined) {
    return err(defect('', { kind: 'missing-field', field: 'content' }))
  }
  const content = readContent(record['content'], 'content')
  if (!content.ok) return content
  const base = { id: nodeId(id), provenance, content: content.value }
  switch (type) {
    case 'scene':
      return ok({ type: 'scene', ...base })
    case 'action':
      return ok({ type: 'action', ...base })
    case 'character': {
      if (record['modifiers'] === undefined) {
        return err(defect('', { kind: 'missing-field', field: 'modifiers' }))
      }
      const modifiers = readModifiers(record['modifiers'], 'modifiers')
      if (!modifiers.ok) return modifiers
      return ok({ type: 'character', ...base, modifiers: modifiers.value })
    }
    case 'paren':
      return ok({ type: 'paren', ...base })
    case 'dialogue':
      return ok({ type: 'dialogue', ...base })
    case 'transition':
      return ok({ type: 'transition', ...base })
    case 'comment':
      return ok({ type: 'comment', ...base })
    case 'subtitle':
      return ok({ type: 'subtitle', ...base })
  }
}

/** Read one outline block. Rejects every one of the eight screenplay types. */
export const readOutlineNode = (input: unknown): Result<OutlineNode, ModelDefect> => {
  const shell = readNodeShell(input)
  if (!shell.ok) return shell
  const { type, id, provenance, record } = shell.value
  if (!isOutlineNodeType(type)) {
    return err(
      defect('type', { kind: 'unknown-value', received: type, allowed: OUTLINE_NODE_TYPES }),
    )
  }
  const allowed =
    type === 'rule' ? ['type', 'id', 'provenance'] : ['type', 'id', 'provenance', 'content']
  const unexpected = firstUnexpectedField(record, allowed, '')
  if (unexpected !== undefined) return err(unexpected)
  if (type === 'rule') {
    return ok({ type: 'rule', id: nodeId(id), provenance })
  }
  if (record['content'] === undefined) {
    return err(defect('', { kind: 'missing-field', field: 'content' }))
  }
  const content = readContent(record['content'], 'content')
  if (!content.ok) return content
  const base = { id: nodeId(id), provenance, content: content.value }
  switch (type) {
    case 'body':
      return ok({ type: 'body', ...base })
    case 'h1':
      return ok({ type: 'h1', ...base })
    case 'h2':
      return ok({ type: 'h2', ...base })
    case 'h3':
      return ok({ type: 'h3', ...base })
    case 'quote':
      return ok({ type: 'quote', ...base })
    case 'beat':
      return ok({ type: 'beat', ...base })
  }
}

type DocumentShell = {
  readonly kind: string
  readonly id: string
  readonly nodes: readonly unknown[]
}

const readDocumentShell = (input: unknown): Result<DocumentShell, ModelDefect> => {
  if (!isRecord(input)) {
    return err(defect('', { kind: 'not-an-object', received: describeValue(input) }))
  }
  const kind = input['kind']
  if (kind === undefined) return err(defect('', { kind: 'missing-field', field: 'kind' }))
  if (typeof kind !== 'string') {
    return err(defect('kind', { kind: 'not-a-string', received: describeValue(kind) }))
  }
  const id = readIdString(input, 'id', '')
  if (!id.ok) return id
  const unexpected = firstUnexpectedField(input, ['kind', 'id', 'nodes'], '')
  if (unexpected !== undefined) return err(unexpected)
  const nodes = input['nodes']
  if (nodes === undefined) return err(defect('', { kind: 'missing-field', field: 'nodes' }))
  if (!Array.isArray(nodes)) {
    return err(defect('nodes', { kind: 'not-an-array', received: describeValue(nodes) }))
  }
  return ok({ kind, id: id.value, nodes })
}

/**
 * Node ids are unique within a document.
 *
 * This much is safe to assert ahead of the identity ruling: a join key that
 * repeats inside one document cannot anchor a comment under any of the
 * candidate rules. Whether an id is unique *across* documents is part of what
 * paste has to decide - see `docs/adr/0001-node-identity.md`.
 */
const firstDuplicateId = (ids: readonly string[]): ModelDefect | undefined => {
  const seen = new Set<string>()
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index]
    if (id === undefined) continue
    if (seen.has(id)) {
      return defect(`${atIndex('nodes', index)}.id`, { kind: 'duplicate-node-id', id })
    }
    seen.add(id)
  }
  return undefined
}

export const readScreenplayDocument = (input: unknown): Result<ScreenplayDocument, ModelDefect> => {
  const shell = readDocumentShell(input)
  if (!shell.ok) return shell
  const { kind, id, nodes: raw } = shell.value
  if (kind !== 'screenplay') {
    return err(
      defect('kind', { kind: 'unknown-value', received: kind, allowed: ['screenplay'] }),
    )
  }
  const nodes: ScreenplayNode[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const node = readScreenplayNode(raw[index])
    if (!node.ok) return err(prefix(node.error, atIndex('nodes', index)))
    nodes.push(node.value)
  }
  const duplicate = firstDuplicateId(nodes.map((node) => node.id))
  if (duplicate !== undefined) return err(duplicate)
  return ok({ kind: 'screenplay', id: documentId(id), nodes })
}

export const readOutlineDocument = (input: unknown): Result<OutlineDocument, ModelDefect> => {
  const shell = readDocumentShell(input)
  if (!shell.ok) return shell
  const { kind, id, nodes: raw } = shell.value
  if (kind !== 'outline') {
    return err(defect('kind', { kind: 'unknown-value', received: kind, allowed: ['outline'] }))
  }
  const nodes: OutlineNode[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const node = readOutlineNode(raw[index])
    if (!node.ok) return err(prefix(node.error, atIndex('nodes', index)))
    nodes.push(node.value)
  }
  const duplicate = firstDuplicateId(nodes.map((node) => node.id))
  if (duplicate !== undefined) return err(duplicate)
  return ok({ kind: 'outline', id: documentId(id), nodes })
}
