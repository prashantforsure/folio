import type {
  CreateProjectInput,
  Episode,
  Membership,
  Project,
  ProjectCard,
  ProjectId,
  ProjectKind,
  User,
  UserId,
} from '@folio/contracts'
import {
  episodeSlug,
  projectId as brandProjectId,
  userId as brandUserId,
} from '@folio/contracts'
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'

import type { FolioDatabase } from '../client'
import {
  documents,
  episodes,
  measurements,
  memberships,
  projects,
  sceneDerivations,
  users,
} from '../schema'
import { mintEpisodeSlug } from './episode-slug'
import { stamp } from './mapping'
import { toEpisode, toProject } from './projects'

/**
 * The one repository that is not project-scoped, and why that is not a hole.
 *
 * AGENTS.md, Tenancy and data access: "Every table carries `project_id`. Every
 * query is tenant-scoped." `users` carries none, because a person exists before
 * they belong to a project and belongs to many. That is a real exception and it
 * is the only one.
 *
 * The exception is contained rather than waved through. Every function here
 * takes a `UserId` and scopes to **that person** - which is the same shape of
 * guarantee, with the actor as the tenant instead of the project. There is no
 * `listAllUsers`, no `readUserByEmail` and no unfiltered select anywhere in
 * this file.
 *
 * These functions take a raw `FolioDatabase` rather than a `ProjectScope`,
 * because the project is what they are looking for. That is exactly the
 * loophole a careless version of this file would become, so the rule is
 * written down: **a function belongs here only if its answer is "for this
 * person", and it must take the `UserId` it filters on.**
 */

const toUser = (row: typeof users.$inferSelect): User => ({
  id: brandUserId(row.id),
  email: row.email,
  displayName: row.displayName,
  avatarUrl: row.avatarUrl,
  createdAt: stamp(row.createdAt),
  updatedAt: stamp(row.updatedAt),
})

/** One person's profile. */
export const readUser = async (db: FolioDatabase, id: UserId): Promise<User | null> => {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
  const row = rows[0]
  return row === undefined ? null : toUser(row)
}

/**
 * Create or refresh our profile row for a Supabase auth user.
 *
 * `id` is the `auth.users` id - one person, one id.
 *
 * The display name and avatar are refreshed on every sign-in rather than being
 * editable: the account settings page is display only, and the signup trigger in
 * `0001` refreshes the row too (see that page's header). For a Google account they
 * come from the OAuth claims. For an email + password account there are no
 * claims at all - `auth.users` carries an address and nothing else - so the
 * caller derives a provisional name from the address; see
 * `apps/web/lib/auth/identity.ts`, which is where that product decision is
 * written down and can be argued with.
 *
 * (AGENTS.md, Constraints said "Google OAuth only" when this was written. It
 * was rewritten when auth was built: email + password exists, with confirmation
 * and reset through Supabase's built-in sender.)
 */
export const upsertUser = async (
  db: FolioDatabase,
  input: {
    readonly id: UserId
    readonly email: string
    readonly displayName: string
    readonly avatarUrl: string | null
  },
): Promise<User> => {
  const inserted = await db
    .insert(users)
    .values(input)
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: input.email,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
        updatedAt: new Date(),
      },
    })
    .returning()
  const row = inserted[0]
  if (row === undefined) {
    throw new Error('Folio: upserting a user returned no row. This is a bug in the repository.')
  }
  return toUser(row)
}

// ---------------------------------------------------------------------------
// The project list - four views over one query
// ---------------------------------------------------------------------------

/**
 * How `/app/recents`, `/app/screenwriting`, `/app/filmmaking` and `/app/trash`
 * differ from one another. That is the whole of the difference: one query, one
 * card, one empty state, and this filter.
 */
export type ProjectListFilter = {
  /** `'all'` is Recents. The other two list views filter on the project's kind. */
  readonly kind: ProjectKind | 'all'
  /** Trash is the same list with the predicate inverted. */
  readonly trashed: boolean
}

/**
 * The latest edit a card can honestly report.
 *
 * `projects.updated_at` moves on a rename, a trash or a restore.
 * `documents.updated_at` moves on every write to a node list - `replaceNodes`
 * stamps the header inside the same transaction. `greatest` ignores a null, so
 * a project with no document yet reports its own row's stamp.
 *
 * `.mapWith(projects.updatedAt)` runs that column's own decoder over the raw
 * value, so the expression comes back as the `Date` every other timestamp does
 * rather than as the driver's string.
 */
const lastEditedAt = sql<Date>`greatest(
  ${projects.updatedAt},
  (select max(${documents.updatedAt}) from ${documents} where ${documents.projectId} = ${projects.id})
)`.mapWith(projects.updatedAt)

/**
 * The project list, as the four list routes render it.
 *
 * The design README: project cards show "**real derived metadata** - episode,
 * scene and page counts, last edited - never a placeholder string. If a project
 * has no script, the card says so."
 *
 * So every number is read here from the table that owns it, in one round trip,
 * and none is read from a column on `projects` - there are no such columns, and
 * a `page_count` there would be the fastest way to make this card lie:
 *
 *   episodes   `episodes`, counted. An authored table; a film has one row.
 *   script     `documents` with `kind = 'screenplay'`, counted - but only ever
 *              asked "any?". No script is a designed state, not a zero.
 *   scenes     `scene_derivations` where `presence = 'present'`. The derived
 *              cache. Zero is a real answer for a script with no headings.
 *   pages      `measurements.total_pages`, summed over the project's documents
 *              **at the project's own format, in `paged` mode**. Not every
 *              measurement: a document measured in both modes would count
 *              twice, and a pass at the other format is a different page.
 *              `null` when nothing has been measured, so the card shows `—`.
 *
 * Correlated subqueries rather than joins with `group by`, because each count
 * is over a different table and one join would multiply the rows before
 * counting them. Postgres plans each as an index lookup per project.
 *
 * `ProjectCardSchema` in `@folio/contracts` is the shape, and its header is the
 * same table as this one - keep them in step.
 */
export const listProjectsFor = async (
  db: FolioDatabase,
  userId: UserId,
  filter: ProjectListFilter,
): Promise<readonly ProjectCard[]> => {
  const rows = await db
    .select({
      project: projects,
      episodes: sql<number>`(select count(*)::int from ${episodes} where ${episodes.projectId} = ${projects.id})`,
      screenplays: sql<number>`(select count(*)::int from ${documents} where ${documents.projectId} = ${projects.id} and ${documents.kind} = 'screenplay')`,
      scenes: sql<number>`(select count(*)::int from ${sceneDerivations} where ${sceneDerivations.projectId} = ${projects.id} and ${sceneDerivations.presence} = 'present')`,
      pages: sql<
        number | null
      >`(select sum(${measurements.totalPages})::int from ${measurements} where ${measurements.projectId} = ${projects.id} and ${measurements.format} = ${projects.format} and ${measurements.pageMode} = 'paged')`,
      lastEditedAt,
      // Ordered by `ordinal`, never by `slug` - ADR 0002. The slug is what the
      // URL shows; the ordinal is the running order.
      openingEpisode: sql<string>`(select ${episodes.slug} from ${episodes} where ${episodes.projectId} = ${projects.id} order by ${episodes.ordinal} asc limit 1)`,
    })
    .from(memberships)
    .innerJoin(projects, eq(projects.id, memberships.projectId))
    .where(
      and(
        eq(memberships.userId, userId),
        filter.trashed ? isNotNull(projects.trashedAt) : isNull(projects.trashedAt),
        filter.kind === 'all' ? undefined : eq(projects.kind, filter.kind),
      ),
    )
    .orderBy(desc(lastEditedAt), desc(projects.createdAt))

  return rows.map((row) => ({
    project: toProject(row.project),
    episodes: row.episodes,
    script: row.screenplays > 0 ? 'present' : 'absent',
    scenes: row.scenes,
    pages: row.pages,
    lastEditedAt: stamp(row.lastEditedAt),
    openingEpisode: episodeSlug(row.openingEpisode),
  }))
}

/**
 * How many projects this person has, live or in the trash.
 *
 * Two callers: the list header's `Trash · N` link, and `/app/new`, which reads
 * differently for someone starting their first project than for someone
 * starting their sixth.
 */
export const countProjectsFor = async (
  db: FolioDatabase,
  userId: UserId,
  filter: Pick<ProjectListFilter, 'trashed'>,
): Promise<number> => {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memberships)
    .innerJoin(projects, eq(projects.id, memberships.projectId))
    .where(
      and(
        eq(memberships.userId, userId),
        filter.trashed ? isNotNull(projects.trashedAt) : isNull(projects.trashedAt),
      ),
    )
  return rows[0]?.count ?? 0
}

/**
 * This person's membership of one project, or null.
 *
 * The gate a server action consults before it opens a `ProjectScope`. The scope
 * machinery guarantees a query cannot cross projects; it does not check that
 * the actor may see this one - `repositories/index.ts` says so - and this is
 * the read that check is made from. It answers "for this person", which is the
 * test for belonging in this file.
 *
 * Trashed projects are included on purpose: restoring one is exactly the case
 * where a member needs to reach a project the list routes hide.
 */
export const readMembershipFor = async (
  db: FolioDatabase,
  userId: UserId,
  projectId: ProjectId,
): Promise<Membership | null> => {
  const rows = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.projectId, projectId)))
    .limit(1)
  const row = rows[0]
  if (row === undefined) return null
  return {
    id: row.id as Membership['id'],
    projectId: brandProjectId(row.projectId),
    userId: brandUserId(row.userId),
    role: row.role,
    invitedVia: row.invitedVia,
    createdAt: stamp(row.createdAt),
  }
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/**
 * Create a project for this person: the row, their `owner` membership, and
 * **exactly one episode row** - whatever the project type.
 *
 * AGENTS.md, Routing: "`projectType: 'film'` **hides** the episode segment. The
 * database still stores one episode row. The router special-cases the shape;
 * the schema never does." Nothing in this function branches on `projectType`
 * except the episode's default title, and that is copy, not shape.
 *
 * ## Why it is here and not in `projects.ts`
 *
 * Every function in `projects.ts` takes a `ProjectScope`, and a scope names a
 * project that already exists. Creation is the one moment there is no project
 * to scope to - so it is "for this person", scoped by the `UserId` that becomes
 * `created_by` and the first member, which is the rule for this file.
 *
 * ## One transaction
 *
 * A project with no membership is a project nobody can see; a project with no
 * episode is a shape the rest of the schema does not admit. Neither may exist
 * for even a moment, so all three inserts commit together or not at all. The
 * episode is inserted directly rather than through `appendEpisode`, because
 * that function takes a scope and a scope cannot be opened over a transaction
 * handle; the slug still comes from `mintEpisodeSlug` - formatted in the one place the
 * padding is written (ADR 0002) and checked against the router's validator.
 *
 * **No document is created.** A new project has no script, and the card says
 * so - that is the designed state. Creating an empty screenplay document here
 * would turn it into a script of zero scenes instead.
 */
export const createProjectFor = async (
  db: FolioDatabase,
  userId: UserId,
  input: CreateProjectInput,
): Promise<{ readonly project: Project; readonly episode: Episode }> =>
  db.transaction(async (tx) => {
    const insertedProjects = await tx
      .insert(projects)
      .values({
        title: input.title,
        kind: input.kind,
        projectType: input.projectType,
        format: input.format,
        createdBy: userId,
      })
      .returning()
    const projectRow = insertedProjects[0]
    if (projectRow === undefined) {
      throw new Error('Folio: inserting a project returned no row. This is a bug in the repository.')
    }

    await tx.insert(memberships).values({
      projectId: projectRow.id,
      userId,
      role: 'owner',
      invitedVia: 'created',
    })

    /*
     * The episode's title. A film is one document, so its episode is the film
     * and carries the film's title; a series' first episode is called what the
     * episode board will call it until it is renamed. An assumption - the
     * brief specifies the row, not its title.
     */
    const insertedEpisodes = await tx
      .insert(episodes)
      .values({
        projectId: projectRow.id,
        slug: mintEpisodeSlug(1),
        ordinal: 1,
        title: input.projectType === 'film' ? input.title : 'Episode 1',
      })
      .returning()
    const episodeRow = insertedEpisodes[0]
    if (episodeRow === undefined) {
      throw new Error('Folio: inserting an episode returned no row. This is a bug in the repository.')
    }

    return { project: toProject(projectRow), episode: toEpisode(episodeRow) }
  })
