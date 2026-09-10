import type { NodeType, OrderKey, Timestamp } from '@folio/contracts'
import { toTimestamp } from '@folio/contracts'
import {
  err,
  isOutlineNodeType,
  isScreenplayNodeType,
  ok,
  byAgent,
  typed,
  readOutlineNode,
  readScreenplayNode,
  runId as makeRunId,
} from '@folio/script'
import type {
  DeliveryModifier,
  ModelDefect,
  NodeId,
  OutlineNode,
  Provenance,
  Result,
  ScreenplayNode,
} from '@folio/script'

/**
 * The one place a row becomes a model value, and back.
 *
 * `@folio/contracts` is deliberately not a mirror of the database - timestamps
 * are ISO strings there because a `Date` does not survive a queue payload,
 * fields are `camelCase` because columns are `snake_case`, and the node model
 * has no ordering because a node list is ordered by being a list. Something has
 * to reconcile the two, and this file is it. Nothing else in the package
 * converts.
 *
 * ## Reading a node is not this file's job either
 *
 * `nodeFromRow` assembles the candidate object out of columns and then hands it
 * straight to `@folio/script`'s own reader. It does not decide what a valid node
 * is - that reader is strict, rejects unrecognised fields, and rejects the five
 * `PAGINATION_FIELDS` by name, and a second opinion here would be the third
 * enforcement point that eventually disagrees with the other two.
 *
 * The assembly is fussy on purpose, because the reader's strictness makes it
 * fussy: a cue must carry `modifiers` and nothing else may, and an outline
 * `rule` block must carry no `content` field **at all** - not an empty one.
 * Getting either wrong is a rejection rather than a silent difference, which is
 * the behaviour worth having.
 */

/** A `Date` from Drizzle becomes the ISO string the contracts carry. */
export const stamp = (value: Date): Timestamp => toTimestamp(value)

export const stampOrNull = (value: Date | null): Timestamp | null =>
  value === null ? null : toTimestamp(value)

/**
 * Provenance, reassembled.
 *
 * The model is a discriminated union so that "agent-authored with no run" is
 * unrepresentable. A row cannot hold a union, so it holds `source` and a
 * nullable `run_id` with a check constraint tying them together. This is where
 * the pair becomes the union again, and the lossy shape stops here.
 */
export const provenanceFromRow = (
  source: string,
  runId: string | null,
): Result<Provenance, ModelDefect> => {
  if (source === 'typed' && runId === null) return ok(typed())
  // `runId` here is `@folio/script`'s own brand constructor: the row is where a
  // run id re-enters the model, and this is the only place it does.
  if (source === 'agent' && runId !== null) return ok(byAgent(makeRunId(runId)))
  return err({
    at: 'provenance',
    reason: {
      kind: 'unknown-value',
      received: `${source}/${runId === null ? 'null' : 'run'}`,
      allowed: ['typed/null', 'agent/run'],
    },
  })
}

/** The columns of a node row that this file reads. Structural, so it is not tied to Drizzle. */
export type NodeRowShape = {
  readonly id: string
  readonly documentKind: string
  readonly type: string
  readonly content: unknown
  readonly modifiers: readonly string[]
  readonly provenanceSource: string
  readonly provenanceRunId: string | null
}

const defect = (at: string, received: string, allowed: readonly string[]): ModelDefect => ({
  at,
  reason: { kind: 'unknown-value', received, allowed },
})

/**
 * A screenplay node row, read.
 *
 * The `allowed` field sets in `read.ts` are exact, so the object built here has
 * to be exact too: `modifiers` on a cue and on nothing else.
 */
export const screenplayNodeFromRow = (
  row: NodeRowShape,
): Result<ScreenplayNode, ModelDefect> => {
  const provenance = provenanceFromRow(row.provenanceSource, row.provenanceRunId)
  if (!provenance.ok) return provenance
  if (!isScreenplayNodeType(row.type)) {
    return err(defect('type', row.type, ['one of the eight screenplay types']))
  }
  const base = {
    type: row.type,
    id: row.id,
    provenance: provenance.value,
    content: row.content,
  }
  return readScreenplayNode(
    row.type === 'character' ? { ...base, modifiers: row.modifiers } : base,
  )
}

/**
 * An outline block row, read.
 *
 * A `rule` block carries no content field at all - the union is what makes that
 * expressible, and the reader rejects an empty array as an unexpected field. The
 * column is `NOT NULL`, so a rule is stored with `[]` and the key is dropped
 * here on the way out. That asymmetry is the price of one nodes table, and it
 * is cheaper than a nullable content column that every other block type would
 * then have to null-check.
 */
export const outlineNodeFromRow = (row: NodeRowShape): Result<OutlineNode, ModelDefect> => {
  const provenance = provenanceFromRow(row.provenanceSource, row.provenanceRunId)
  if (!provenance.ok) return provenance
  if (!isOutlineNodeType(row.type)) {
    return err(defect('type', row.type, ['one of the seven outline block types']))
  }
  const base = { type: row.type, id: row.id, provenance: provenance.value }
  return readOutlineNode(row.type === 'rule' ? base : { ...base, content: row.content })
}

/** The columns a node row is written from. */
export type NodeWrite = {
  readonly id: NodeId
  readonly type: NodeType
  readonly orderKey: OrderKey
  readonly content: unknown
  readonly modifiers: readonly DeliveryModifier[]
  readonly provenanceSource: 'typed' | 'agent'
  readonly provenanceRunId: string | null
}

/**
 * A model node, flattened into columns.
 *
 * `content` on a `rule` is `[]`, which is the mirror of the note above.
 * `modifiers` is empty for everything but a cue, which the
 * `nodes_modifiers_only_on_cues` constraint also enforces - two mechanisms,
 * because this one is the honest mistake and that one is the `psql` session.
 */
export const nodeToWrite = (
  node: ScreenplayNode | OutlineNode,
  orderKey: OrderKey,
): NodeWrite => ({
  id: node.id,
  type: node.type,
  orderKey,
  content: node.type === 'rule' ? [] : node.content,
  modifiers: node.type === 'character' ? node.modifiers : [],
  provenanceSource: node.provenance.source,
  provenanceRunId: node.provenance.source === 'agent' ? node.provenance.runId : null,
})
