/**
 * Identifiers.
 *
 * Every id in the model is a branded string. The brand is a type-level tag
 * only - it carries no format, no prefix, no length and no validation, because
 * **the id format has not been ruled on**.
 *
 * Two open questions block it, and both are escalated in
 * `docs/adr/0001-node-identity.md`:
 *
 *   - AGENTS.md open decision 1: which node id survives a split, and what
 *     happens on merge and paste. That is the id's *lifecycle*.
 *   - AGENTS.md, Conventions > Naming: "scene ids appear as `SCENE_xxx` in the
 *     route spec - the casing is inconsistent with `ep_NNN` and needs one
 *     ruling before either is codified." That is the id's *shape*.
 *
 * So the constructors below brand and nothing else. When the shape is ruled on,
 * a validating reader belongs here and `readScreenplayNode` should call it.
 * Until then the only thing asserted about an id anywhere in this package is
 * that it is a non-empty string - true under every candidate ruling.
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
