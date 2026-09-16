import type { CharacterId, LocationId, NodeId } from '@folio/script'
import { z } from 'zod'

import type { SceneRef } from './characters'
import type { ResearchClipId, ResearchCollectionId, ResearchFilingId, ResearchSourceId } from './ids'
import { CharacterIdSchema, LocationIdSchema, NodeIdSchema, ResearchCollectionIdSchema } from './ids'
import type { Timestamp } from './primitives'

/**
 * The Research route: sources, the clips cut from them, and where each clip
 * was filed. `docs/ui design/Route - Research v2.dc.html` (2026-09-16).
 *
 * Everything here is AUTHORED. A source is something a writer brought in
 * from outside the script - an article, a document, a set of photographs,
 * an interview, a recording - so nothing about it is a function of the node
 * list and nothing here is a derived cache. AGENTS.md, Derivation: the
 * script is the source of truth *for the script*; research is what the
 * script was written from, and the app keeps the two apart.
 *
 * ## A clip points at the script; the script never points back
 *
 * The mockup's clip carries `to: ["E1 Sc 3", ...]` - the places a line
 * was *filed*. That is the reverse of the README's citation pattern (a
 * derived claim carries the scene refs that prove it) and deliberately so:
 * a clip comes from outside the script and cannot be derived, so its link
 * to a scene is authored, and it lives on the clip's side. The three
 * targets are a character record, a location record and a scene. A scene
 * is its heading node's id, keyed the way `shots.scene_node_id` is - with
 * no foreign key, so a heading that leaves the script and comes back by
 * undo finds its clips where it left them. The mockup also files clips to
 * the Bible; the Bible was removed (`docs/build-decisions.md`, "Bible
 * route removed") and no target here names it.
 *
 * ## What the mockup shows that is not stored
 *
 * The card's two-line snippet, the source page's byline and the mono
 * `origin · meta` line are derived at read (`apps/web/lib/research/view.ts`)
 * from the body, the note and the origin - AGENTS.md, "nothing is stored
 * that can be computed". The count of clips, of filed clips, and the
 * highlight spans in the body are all reads too.
 */

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/**
 * The five source kinds the mockup's `types()` names. `media` is its
 * `clip` - "Audio / video" - renamed so a source kind and a research clip
 * are never one word.
 */
export const RESEARCH_SOURCE_KINDS = ['article', 'document', 'image', 'interview', 'media'] as const

export type ResearchSourceKind = (typeof RESEARCH_SOURCE_KINDS)[number]

export const ResearchSourceKindSchema = z.enum(RESEARCH_SOURCE_KINDS)

/** How a kind reads on the card's badge, in the drawer and in the type filter. Specified copy. */
export const RESEARCH_SOURCE_KIND_LABELS: Readonly<Record<ResearchSourceKind, string>> = {
  article: 'Article',
  document: 'Document',
  image: 'Images',
  interview: 'Interview',
  media: 'Audio / video',
}

/** The glyph beside the label, as the mockup writes it. Text, not an icon. */
export const RESEARCH_SOURCE_KIND_GLYPHS: Readonly<Record<ResearchSourceKind, string>> = {
  article: '¶',
  document: '▤',
  image: '▣',
  interview: '◉',
  media: '▶',
}

/**
 * The collection colours: the five hues the mockup assigns its five fixture
 * collections (`collHue`), named by hue rather than by fixture because the
 * fixture's names are one project's folders. Each is a themed token in
 * `packages/ui` (`--coll-<name>-h`).
 */
export const RESEARCH_COLLECTION_COLOURS = ['sky', 'violet', 'cobalt', 'terracotta', 'moss'] as const

export type ResearchCollectionColour = (typeof RESEARCH_COLLECTION_COLOURS)[number]

export const ResearchCollectionColourSchema = z.enum(RESEARCH_COLLECTION_COLOURS)

export const RESEARCH_TITLE_MAX = 200
export const RESEARCH_ORIGIN_MAX = 300
export const RESEARCH_NOTE_MAX = 4_000
export const RESEARCH_BODY_MAX = 200_000
export const RESEARCH_COLLECTION_NAME_MAX = 60

/** An optional line: trimmed, and empty becomes `null` so the row never holds `''`. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))

/**
 * Where a source is filed. An existing collection by id, a new one by name
 * (created in the same write, coloured with the least-used colour), or none.
 */
export const ResearchCollectionPickSchema = z.union([
  z.object({ id: ResearchCollectionIdSchema }),
  z.object({ name: z.string().trim().min(1).max(RESEARCH_COLLECTION_NAME_MAX) }),
  z.null(),
])

export type ResearchCollectionPick = z.infer<typeof ResearchCollectionPickSchema>

/** What the drawer saves, whole - create and edit take the same shape. */
export const ResearchSourceEditSchema = z.object({
  kind: ResearchSourceKindSchema,
  title: z.string().trim().min(1).max(RESEARCH_TITLE_MAX),
  origin: optionalText(RESEARCH_ORIGIN_MAX),
  note: optionalText(RESEARCH_NOTE_MAX),
  /** The text of the source - a transcript, an article's copy. Empty for a set of photographs. */
  body: z.string().max(RESEARCH_BODY_MAX),
  collection: ResearchCollectionPickSchema,
})

export type ResearchSourceEdit = z.infer<typeof ResearchSourceEditSchema>

// ---------------------------------------------------------------------------
// Clips and filings
// ---------------------------------------------------------------------------

export const RESEARCH_CLIP_MAX = 2_000

/** A highlighted line. The text as selected, trimmed; the body is where it is found again. */
export const ResearchClipEditSchema = z.object({
  text: z.string().trim().min(1).max(RESEARCH_CLIP_MAX),
})

export type ResearchClipEdit = z.infer<typeof ResearchClipEditSchema>

export const RESEARCH_FILING_KINDS = ['character', 'location', 'scene'] as const

export type ResearchFilingKind = (typeof RESEARCH_FILING_KINDS)[number]

export const ResearchFilingKindSchema = z.enum(RESEARCH_FILING_KINDS)

/** Where a clip is sent. Exactly one target per filing. */
export const ResearchFilingTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('character'), characterId: CharacterIdSchema }),
  z.object({ kind: z.literal('location'), locationId: LocationIdSchema }),
  z.object({ kind: z.literal('scene'), sceneNodeId: NodeIdSchema }),
])

export type ResearchFilingTarget = z.infer<typeof ResearchFilingTargetSchema>

// ---------------------------------------------------------------------------
// The read model
// ---------------------------------------------------------------------------

/** One row of the sidebar's `Collections` group. */
export type ResearchCollectionRow = {
  readonly id: ResearchCollectionId
  readonly name: string
  readonly colour: ResearchCollectionColour
  /** How many sources sit in it. */
  readonly sources: number
}

/** A source as stored, with its collection joined. Counts come with `ResearchSourceRow`. */
export type ResearchSource = {
  readonly id: ResearchSourceId
  readonly kind: ResearchSourceKind
  readonly title: string
  readonly origin: string | null
  readonly note: string | null
  readonly body: string
  readonly collection: { readonly id: ResearchCollectionId; readonly name: string; readonly colour: ResearchCollectionColour } | null
  readonly createdAt: Timestamp
  readonly updatedAt: Timestamp
}

/** The grid's card: the source and how many clips were cut from it. */
export type ResearchSourceRow = ResearchSource & {
  readonly clips: number
}

/**
 * A filing, resolved to what it names. A character or location that was
 * deleted takes its filings with it (a cascade); a scene whose heading is no
 * longer in the script keeps the filing and resolves to no `ref` - the chip
 * then reads the node id's short form, and the Send to… picker offers only
 * present scenes.
 */
export type ResearchFilingRow =
  | { readonly id: ResearchFilingId; readonly kind: 'character'; readonly characterId: CharacterId; readonly name: string }
  | { readonly id: ResearchFilingId; readonly kind: 'location'; readonly locationId: LocationId; readonly name: string }
  | { readonly id: ResearchFilingId; readonly kind: 'scene'; readonly sceneNodeId: NodeId; readonly ref: SceneRef | null }

/** One clip with everywhere it was filed. */
export type ResearchClipRow = {
  readonly id: ResearchClipId
  readonly sourceId: ResearchSourceId
  readonly text: string
  readonly createdAt: Timestamp
  readonly filings: readonly ResearchFilingRow[]
}
