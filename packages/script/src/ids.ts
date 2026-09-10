/**
 * Identifiers.
 *
 * Every id in the model is a branded string. The brand is a type-level tag
 * only - it carries no format, no prefix, no length and no validation, and that
 * is now a decision rather than a gap.
 *
 * The id *shape* was ruled in `docs/adr/0001-node-identity.md` (see "Ruling"):
 * a node id is opaque, globally unique and carries no type prefix - a prefix
 * would have to change when a Scene is retyped to Action, and AGENTS.md says
 * the id survives a type change. `SCENE_xxx` in the route spec is the *derived
 * scene record's* id, a different id space that never reaches this file.
 *
 * The ruling also says the format is codified where ids are **minted** -
 * `packages/db` and `packages/contracts` - and not here. This package has no
 * entropy by design and cannot mint one, so a validating reader here would
 * couple the deterministic core to a decision it takes no part in. The only
 * thing asserted about an id anywhere in this package remains that it is a
 * non-empty string.
 *
 * That ruling was delegated to the implementer, twice, and the ADR records it
 * as reversible. AGENTS.md open decision 1 still lists the lifecycle question
 * as open; amending the contract is a separate call.
 *
 * The brands are not decoration. The node id is the join key for comments,
 * proposals, provenance and every derived entity (AGENTS.md, When to ask
 * first), so passing a CharacterId where a NodeId belongs must not compile.
 */
declare const idBrand: unique symbol

type Branded<Tag extends string> = string & { readonly [idBrand]: Tag }

/** The join key. Stable across splits, merges, type changes and reorders. */
export type NodeId = Branded<'NodeId'>

/** A screenplay or outline document. */
export type DocumentId = Branded<'DocumentId'>

/** One agent run. `Provenance` records which run authored a node. */
export type RunId = Branded<'RunId'>

/** A character record. An `@mention` points at one of these, never at a name. */
export type CharacterId = Branded<'CharacterId'>

/** A location record. Locations are a tree; this is a node in that tree. */
export type LocationId = Branded<'LocationId'>

export const nodeId = (raw: string): NodeId => raw as NodeId
export const documentId = (raw: string): DocumentId => raw as DocumentId
export const runId = (raw: string): RunId => raw as RunId
export const characterId = (raw: string): CharacterId => raw as CharacterId
export const locationId = (raw: string): LocationId => raw as LocationId
