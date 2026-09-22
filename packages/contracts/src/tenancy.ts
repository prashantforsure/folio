import { z } from 'zod'

import {
  MembershipRoleSchema,
  PageModeSchema,
  ProjectKindSchema,
  ProjectTypeSchema,
  RevisionColourSchema,
  ScriptFormatSchema,
} from './enums'
import {
  EpisodeIdSchema,
  EpisodeSlugSchema,
  MembershipIdSchema,
  ProjectIdSchema,
  UserIdSchema,
} from './ids'
import { TimestampSchema, TitleSchema } from './primitives'

/**
 * Users, memberships, projects and episodes.
 *
 * AGENTS.md, Tech stack: "`auth.users` is identity; `users`/`memberships` are
 * ours." So a `User` here is our profile row, one-to-one with a Supabase auth
 * row by id, and it is the only shape in this package that is not
 * project-scoped - a person exists before they are a member of anything. Every
 * other schema in the package carries `projectId`.
 */

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/**
 * Our half of a person.
 *
 * `id` **is** the `auth.users` id, not a foreign key to it - one row, one
 * person, one id, so nothing has to join two identity tables to find a display
 * name. `email` is stored because AGENTS.md, Constraints leaves us with Google
 * OAuth only and no email provider: it is an identifier and a display string,
 * never an address anything sends to.
 */
export const UserSchema = z.object({
  id: UserIdSchema,
  email: z.email(),
  displayName: TitleSchema,
  /** A Supabase Storage signed URL, or null. Never a data URI, never a hotlink. */
  avatarUrl: z.url().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type User = z.infer<typeof UserSchema>

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

/**
 * One person's place in one project.
 *
 * `invitedVia` records that AGENTS.md, Constraints has no email provider:
 * "Team invites are **share links** generated in-app and copied by the
 * inviter." A membership therefore comes into being either because the person
 * created the project or because they opened a link, and the row says which.
 */
export const MembershipSchema = z.object({
  id: MembershipIdSchema,
  projectId: ProjectIdSchema,
  userId: UserIdSchema,
  role: MembershipRoleSchema,
  invitedVia: z.enum(['created', 'share_link']),
  createdAt: TimestampSchema,
})

export type Membership = z.infer<typeof MembershipSchema>

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/**
 * A project.
 *
 * Note what is **not** here. Appendix A of the design handoff sketches
 * `Project { ..., pageCount, updatedAt, ... }` and the design README requires
 * project cards to show "**real derived metadata** - episode, scene and page
 * counts, last edited - never a placeholder string". A `pageCount` column would
 * be the fastest way to make that card lie: it is a function of the node list
 * and the sheet format, so AGENTS.md, Development philosophy 1 makes it a
 * derived value, and the exception table puts page counts on a **measurement
 * record**. The card reads the measurement; the project row does not carry one.
 *
 * `trashedAt` is soft delete. AGENTS.md, When to ask first: "Delete or purge
 * user data" needs asking, so nothing in this phase hard-deletes a project.
 */
export const ProjectSchema = z.object({
  id: ProjectIdSchema,
  title: TitleSchema,
  /**
   * The three creation axes. See `enums.ts` for what each decides. All three
   * are required at creation and none has a default in the contract: a project
   * whose format was assumed is a project whose page count is a guess.
   */
  kind: ProjectKindSchema,
  projectType: ProjectTypeSchema,
  format: ScriptFormatSchema,
  /**
   * The pagination preference. AGENTS.md's exception table: `pageMode` +
   * `liveRepaginate`, per project, not in the URL. Two rendering modes plus a
   * cadence flag, never three peer modes - the Script route's three-way
   * control maps onto this pair at the boundary and nowhere else.
   */
  pageMode: PageModeSchema,
  liveRepaginate: z.boolean(),
  /** Free tags, as the project cards show them. Lower case, deduplicated by the repository. */
  tags: z.array(z.string().trim().min(1).max(40)).max(24),
  createdBy: UserIdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  trashedAt: TimestampSchema.nullable(),
})

export type Project = z.infer<typeof ProjectSchema>

/**
 * What `/app/new` submits.
 *
 * The three axes plus a title, and nothing else - no episode count, no page
 * mode, no tags. Creation writes the project, the creator's `owner` membership
 * and **exactly one episode row** whatever the project type (AGENTS.md,
 * Routing), and then the workspace takes over.
 *
 * This is the boundary schema a server action parses a `FormData` against. It
 * is here rather than in `apps/web` because the worker will one day create
 * projects too (an import job), and AGENTS.md, Architecture says types flow
 * from this package and are not redeclared downstream.
 */
export const CreateProjectInputSchema = z.object({
  title: TitleSchema,
  kind: ProjectKindSchema,
  projectType: ProjectTypeSchema,
  format: ScriptFormatSchema,
})

export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>

// ---------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------

/**
 * An episode.
 *
 * **A film has exactly one of these.** AGENTS.md, Routing: "`projectType:
 * 'film'` **hides** the episode segment. The database still stores one episode
 * row. The router special-cases the shape; the schema never does." Nothing in
 * this schema knows what `kind` the project is, and that is deliberate - the
 * moment an episode is optional, every episode-scoped join gets a null branch
 * and the film case starts being a second code path.
 *
 * `id` is an opaque key; `slug` is `ep_NNN` and is what the router shows. See
 * `docs/adr/0002-episode-identity.md` - that separation is a ruling, it was
 * delegated, and it is reversible.
 *
 * `ordinal` is the running order and it is what `slug` is generated from, but
 * the two are then independent: reordering rewrites `ordinal` and may leave
 * `slug` alone, which is the whole reason the slug is not the key.
 */
export const EpisodeSchema = z.object({
  id: EpisodeIdSchema,
  projectId: ProjectIdSchema,
  slug: EpisodeSlugSchema,
  /** 1-based running order. Unique within a project. */
  ordinal: z.int().min(1),
  title: TitleSchema,
  /**
   * The colour of the current production draft.
   *
   * AGENTS.md, UI fidelity: revision colours "are industry artefacts, not
   * palette tokens, and must survive a theme switch intact." Stored as the
   * value `@folio/script` defines, never as a token name.
   */
  revisionColour: RevisionColourSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type Episode = z.infer<typeof EpisodeSchema>

/**
 * What the project list actually renders.
 *
 * The design README: project cards show "real derived metadata - episode, scene
 * and page counts, last edited - never a placeholder string. If a project has
 * no script, the card says so." Every field below names where it is read from,
 * because a value quietly computed in the component is the failure this shape
 * exists to prevent:
 *
 *   `episodes`      `episodes` - an authored table, counted. A film has one by
 *                   construction, so the card shows it for a series only.
 *   `script`        `documents` - whether a screenplay document exists for any
 *                   of the project's episodes. "No script yet" is this being
 *                   `absent`; it is a designed state, not a zero.
 *   `scenes`        `scene_derivations` - the derived cache, counted where
 *                   `presence = 'present'`. Legitimately zero for a script with
 *                   no headings yet, and the convention shows `0`.
 *   `pages`         `measurements` - the measurement record, `total_pages`
 *                   summed over the project's documents at the project's
 *                   `format` in `paged` mode. `null` when nothing has been
 *                   measured: a measurement either exists or does not, so the
 *                   card shows `—`, never 0.
 *   `lastEditedAt`  the later of `projects.updated_at` and the newest
 *                   `documents.updated_at` - the project row and the document
 *                   headers, because `replaceNodes` stamps the header on every
 *                   write to the node list.
 *
 * AGENTS.md, UI fidelity: "things that legitimately count to zero show `0`;
 * things that either exist or don't show `—`; the script says `empty`."
 *
 * This is a **read model**, assembled by one repository query. It is not a
 * table, and there is no column anywhere it could be cached in.
 */
export const ProjectCardSchema = z.object({
  project: ProjectSchema,
  episodes: z.int().min(1),
  /** Whether any screenplay document exists yet. Not a count. */
  script: z.enum(['absent', 'present']),
  scenes: z.int().min(0),
  /** `null` when no measurement exists yet - the card shows `—` rather than 0. */
  pages: z.int().min(0).nullable(),
  lastEditedAt: TimestampSchema,
  /**
   * The episode the card opens on: the first in running order. A series URL
   * always carries an episode segment, so the card needs one to link anywhere;
   * for a film the router drops it (AGENTS.md, Routing) and it is unused.
   */
  openingEpisode: EpisodeSlugSchema,
})

export type ProjectCard = z.infer<typeof ProjectCardSchema>

// ---------------------------------------------------------------------------
// Title pages
// ---------------------------------------------------------------------------

/**
 * The title page - the cover the Script route shows under `?doc=cover`.
 *
 * AGENTS.md, Export: "The title page is a separate document on the same sheet
 * geometry, exported with the script." Separate in that it is its own sheet
 * and its own row; not a `documents` row, because it carries no node list.
 * The fields are Fountain's title-page keys, the same closed list
 * `@folio/script`'s `fountain-syntax.ts` recognises on import, so an exported
 * cover and an imported one share a vocabulary. Every field is nullable - an
 * empty cover is a valid cover - and `draftDate` is text, as Fountain has it.
 */
export const TitlePageSchema = z.object({
  id: z.uuid(),
  projectId: ProjectIdSchema,
  episodeId: EpisodeIdSchema,
  title: z.string().nullable(),
  credit: z.string().nullable(),
  author: z.string().nullable(),
  source: z.string().nullable(),
  draftDate: z.string().nullable(),
  contact: z.string().nullable(),
  copyright: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type TitlePage = z.infer<typeof TitlePageSchema>

/** The eight fields a writer edits on the cover, in the order the sheet draws them. */
export const TITLE_PAGE_FIELDS = [
  'title',
  'credit',
  'author',
  'source',
  'draftDate',
  'contact',
  'copyright',
  'notes',
] as const

export type TitlePageField = (typeof TITLE_PAGE_FIELDS)[number]

const TitlePageFieldInput = z
  .string()
  .max(2000)
  .transform((value) => (value.trim() === '' ? null : value.trim()))

/** What a cover edit submits: every field, each trimmed, empty meaning null. */
export const TitlePageInputSchema = z.object({
  title: TitlePageFieldInput,
  credit: TitlePageFieldInput,
  author: TitlePageFieldInput,
  source: TitlePageFieldInput,
  draftDate: TitlePageFieldInput,
  contact: TitlePageFieldInput,
  copyright: TitlePageFieldInput,
  notes: TitlePageFieldInput,
})

export type TitlePageInput = z.infer<typeof TitlePageInputSchema>
