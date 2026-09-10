import { z } from 'zod'

import { MembershipRoleSchema, ProjectKindSchema, RevisionColourSchema } from './enums'
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
  kind: ProjectKindSchema,
  /** Free tags, as the project cards show them. Lower case, deduplicated by the repository. */
  tags: z.array(z.string().trim().min(1).max(40)).max(24),
  createdBy: UserIdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  trashedAt: TimestampSchema.nullable(),
})

export type Project = z.infer<typeof ProjectSchema>

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
 * no script, the card says so." That last sentence is why `pages` is nullable
 * rather than zero: `null` means nothing has been measured, `0` would mean a
 * measured script of no length, and the card's two states are exactly that
 * distinction. AGENTS.md, UI fidelity: "things that legitimately count to zero
 * show `0`; things that either exist or don't show `—`".
 *
 * This is a **read model**, assembled by a repository from a project row and a
 * measurement. It is not a table.
 */
export const ProjectCardSchema = z.object({
  project: ProjectSchema,
  episodes: z.int().min(0),
  scenes: z.int().min(0),
  /** `null` when no measurement exists yet - the card says so rather than showing 0. */
  pages: z.int().min(0).nullable(),
  lastEditedAt: TimestampSchema.nullable(),
})

export type ProjectCard = z.infer<typeof ProjectCardSchema>
