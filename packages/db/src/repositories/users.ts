import type {
  CreateProjectInput,
  CreditBalance,
  Episode,
  LedgerEntryKind,
  Membership,
  MembershipRole,
  PreviewLine,
  Project,
  ProjectCard,
  ProjectId,
  ProjectKind,
  ProjectMember,
  User,
  UserId,
} from '@folio/contracts'
import {
  PREVIEW_LINES,
  episodeSlug,
  projectId as brandProjectId,
  toTimestamp,
  userId as brandUserId,
} from '@folio/contracts'
import type { InlineContent, ScreenplayNodeType } from '@folio/script'
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'

import type { FolioDatabase } from '../client'
import {
  characters,
  creditLedger,
  documents,
  episodes,
  generations,
  locations,
  measurements,
  memberships,
  nodes,
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
 * How `/app/projects` and `/app/trash` differ from one another. That is the
 * whole of the difference: one query, one card, one empty state, and this
 * filter. (`/app/recents`, `/app/screenwriting` and `/app/filmmaking` were
 * three views over the same query until the account routes pass, 2026-09-22;
 * the kind is a filter chip on the Projects route now, applied on the client
 * over the `'all'` read.)
 */
export type ProjectListFilter = {
  /** `'all'` is every project. A kind narrows the list to one. */
  readonly kind: ProjectKind | 'all'
  /** Trash is the same list with the predicate inverted. */
  readonly trashed: boolean
  /**
   * `true` only archived, `false` only unarchived, omitted both. The route
   * reads both and filters on the client, so its chips and their counts come
   * from one query; the sidebar's badge asks for `false`, because it prints
   * the same number the `All` chip does.
   */
  readonly archived?: boolean
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
 *   members    `memberships` joined to `users`, one JSON list per project in
 *              the order people joined - the Team column and the `Shared` mark.
 *   preview    the first `PREVIEW_LINES` blocks of the opening episode's
 *              screenplay (`nodes`, in `order_key` order, `COLLATE "C"` like
 *              every other read of that column - `../order.ts` says why), type and content -
 *              the card's page thumbnail. Empty when there is no script. A
 *              mention run carries a record id, not text, so the names are
 *              read afterwards in one statement per entity kind and printed in
 *              place (`previewText`); a placeholder never is.
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
      generating: sql<number>`(select count(*)::int from ${generations} where ${generations.projectId} = ${projects.id} and ${generations.state} in ('queued', 'running'))`,
      pages: sql<
        number | null
      >`(select sum(${measurements.totalPages})::int from ${measurements} where ${measurements.projectId} = ${projects.id} and ${measurements.format} = ${projects.format} and ${measurements.pageMode} = 'paged')`,
      lastEditedAt,
      // Ordered by `ordinal`, never by `slug` - ADR 0002. The slug is what the
      // URL shows; the ordinal is the running order.
      openingEpisode: sql<string>`(select ${episodes.slug} from ${episodes} where ${episodes.projectId} = ${projects.id} order by ${episodes.ordinal} asc limit 1)`,
      members: sql<
        readonly MemberJson[]
      >`(select coalesce(json_agg(json_build_object('id', m.user_id, 'displayName', u.display_name, 'avatarUrl', u.avatar_url, 'role', m.role) order by m.created_at asc), '[]'::json) from memberships m join users u on u.id = m.user_id where m.project_id = ${projects.id})`,
      preview: sql<
        readonly PreviewJson[]
      >`(select coalesce(json_agg(json_build_object('type', n.type, 'content', n.content) order by n.order_key COLLATE "C" asc), '[]'::json) from (select ${nodes.type}, ${nodes.content}, ${nodes.orderKey} from ${nodes} join ${documents} on ${documents.id} = ${nodes.documentId} where ${documents.projectId} = ${projects.id} and ${documents.kind} = 'screenplay' and ${documents.episodeId} = (select ${episodes.id} from ${episodes} where ${episodes.projectId} = ${projects.id} order by ${episodes.ordinal} asc limit 1) order by ${nodes.orderKey} COLLATE "C" asc limit ${PREVIEW_LINES}) n)`,
    })
    .from(memberships)
    .innerJoin(projects, eq(projects.id, memberships.projectId))
    .where(
      and(
        eq(memberships.userId, userId),
        filter.trashed ? isNotNull(projects.trashedAt) : isNull(projects.trashedAt),
        filter.kind === 'all' ? undefined : eq(projects.kind, filter.kind),
        filter.archived === undefined
          ? undefined
          : filter.archived
            ? isNotNull(projects.archivedAt)
            : isNull(projects.archivedAt),
      ),
    )
    .orderBy(desc(lastEditedAt), desc(projects.createdAt))

  const names = await mentionNames(
    db,
    rows.map((row) => row.project.id),
    rows.flatMap((row) => row.preview),
  )

  return rows.map((row) => ({
    project: toProject(row.project),
    episodes: row.episodes,
    script: row.screenplays > 0 ? 'present' : 'absent',
    scenes: row.scenes,
    pages: row.pages,
    lastEditedAt: stamp(row.lastEditedAt),
    openingEpisode: episodeSlug(row.openingEpisode),
    generating: row.generating,
    members: row.members.map(
      (member): ProjectMember => ({
        id: brandUserId(member.id),
        displayName: member.displayName,
        avatarUrl: member.avatarUrl,
        role: member.role,
      }),
    ),
    preview: row.preview.map((line): PreviewLine => ({ type: line.type, text: previewText(line.content, names) })),
  }))
}

type MemberJson = {
  readonly id: string
  readonly displayName: string
  readonly avatarUrl: string | null
  readonly role: MembershipRole
}

type PreviewJson = {
  readonly type: ScreenplayNodeType
  readonly content: InlineContent
}

/** Record names keyed by id, for the mention runs a preview carries. */
type MentionNames = ReadonlyMap<string, string>

/**
 * The names behind every mention run in the previews: one statement per
 * entity kind, and none when there is no mention, which is the common case.
 * Scoped to the listed projects - an id from a project this person is on
 * resolves; nothing else is looked at.
 */
const mentionNames = async (
  db: FolioDatabase,
  projectIds: readonly string[],
  lines: readonly PreviewJson[],
): Promise<MentionNames> => {
  const characterIds = new Set<string>()
  const locationIds = new Set<string>()
  for (const line of lines) {
    for (const run of line.content) {
      if (run.kind !== 'mention') continue
      if (run.target.entity === 'character') characterIds.add(run.target.id)
      else locationIds.add(run.target.id)
    }
  }
  const names = new Map<string, string>()
  if (projectIds.length === 0) return names
  if (characterIds.size > 0) {
    const rows = await db
      .select({ id: characters.id, name: characters.name })
      .from(characters)
      .where(and(inArray(characters.projectId, [...projectIds]), inArray(characters.id, [...characterIds])))
    for (const row of rows) names.set(row.id, row.name)
  }
  if (locationIds.size > 0) {
    const rows = await db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(and(inArray(locations.projectId, [...projectIds]), inArray(locations.id, [...locationIds])))
    for (const row of rows) names.set(row.id, row.name)
  }
  return names
}

/** A block's text for the thumbnail: text runs as written, a mention as its record's name. */
const previewText = (content: InlineContent, names: MentionNames): string =>
  content.map((run) => (run.kind === 'text' ? run.text : (names.get(run.target.id) ?? ''))).join('')

/**
 * How many projects this person has, live or in the trash.
 *
 * Three callers: the home sidebar's `Projects` badge (live and unarchived),
 * the Projects route's `Trash` link, and `/app/new`, which reads differently
 * for someone starting their first project than for someone starting their
 * sixth - and counts an archived project, because owning one means you are
 * not starting your first.
 */
export const countProjectsFor = async (
  db: FolioDatabase,
  userId: UserId,
  filter: Pick<ProjectListFilter, 'trashed' | 'archived'>,
): Promise<number> => {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memberships)
    .innerJoin(projects, eq(projects.id, memberships.projectId))
    .where(
      and(
        eq(memberships.userId, userId),
        filter.trashed ? isNotNull(projects.trashedAt) : isNull(projects.trashedAt),
        filter.archived === undefined
          ? undefined
          : filter.archived
            ? isNotNull(projects.archivedAt)
            : isNull(projects.archivedAt),
      ),
    )
  return rows[0]?.count ?? 0
}

// ---------------------------------------------------------------------------
// Credits, for this person rather than for one project
// ---------------------------------------------------------------------------

/**
 * Every credit this person can spend, summed over the ledgers of the projects
 * they belong to.
 *
 * **There is still no account-level ledger and this does not invent one.**
 * `credit_ledger` carries `project_id` like every other table, and a credit is
 * bought for and spent by a project (AGENTS.md, Jobs, credits and cost). What
 * this answers is the only question the account chrome can honestly ask: how
 * much, across everything you are a member of. It is the same arithmetic
 * `readBalance` does - `settled` excludes the provisional pair, `reserved` is
 * the reservations no `spend` or `release` has closed - written once over a
 * join through `memberships` instead of once per project, so the sidebar costs
 * one statement rather than one per card.
 *
 * Trashed projects are included: their ledgers are still money, and leaving
 * them out would make the sum wrong.
 *
 * `projectId` on the returned balance is not meaningful for a sum across
 * projects, so this returns the three numbers and the stamp rather than a
 * `CreditBalance` - naming a project that is not one project would be a lie in
 * a type.
 */
export type AccountCredits = Pick<CreditBalance, 'settled' | 'reserved' | 'available' | 'asOf'>

export const readCreditsFor = async (db: FolioDatabase, userId: UserId): Promise<AccountCredits> => {
  const mine = db
    .select({ projectId: memberships.projectId })
    .from(memberships)
    .where(eq(memberships.userId, userId))

  const rows = await db
    .select({
      settled: sql<number>`coalesce(sum(${creditLedger.delta}) filter (where ${creditLedger.kind} not in ('reserve', 'release')), 0)::int`,
      reserved: sql<number>`coalesce(sum(${creditLedger.delta}) filter (where ${creditLedger.kind} = 'reserve' and not exists (
        select 1 from ${creditLedger} as closing
        where closing.project_id = ${creditLedger.projectId}
          and closing.job_id is not distinct from ${creditLedger.jobId}
          and closing.kind in ('release', 'spend')
      )), 0)::int`,
    })
    .from(creditLedger)
    .where(inArray(creditLedger.projectId, mine))

  const settled = rows[0]?.settled ?? 0
  const reserved = rows[0]?.reserved ?? 0
  // `reserved` is already negative, so held work is subtracted by adding it -
  // the same sign discipline as `readBalance`.
  return { settled, reserved, available: settled + reserved, asOf: toTimestamp(new Date()) }
}

/** One line of the settings page's `Recent usage` list: what it was for, and what it cost. */
export type LedgerLine = {
  readonly id: string
  readonly projectId: ProjectId
  readonly projectTitle: string
  readonly kind: LedgerEntryKind
  readonly delta: number
  readonly reason: string | null
  readonly occurredAt: ReturnType<typeof stamp>
}

/**
 * The most recent ledger entries across this person's projects, newest first.
 *
 * A read of the append-only table, joined to the project so a line can say
 * which one it belongs to. No balance is computed here and none is stored;
 * `readCreditsFor` is the sum, this is the trail.
 */
export const listLedgerFor = async (
  db: FolioDatabase,
  userId: UserId,
  limit = 8,
): Promise<readonly LedgerLine[]> => {
  const rows = await db
    .select({
      id: creditLedger.id,
      projectId: creditLedger.projectId,
      projectTitle: projects.title,
      kind: creditLedger.kind,
      delta: creditLedger.delta,
      reason: creditLedger.reason,
      occurredAt: creditLedger.occurredAt,
    })
    .from(creditLedger)
    .innerJoin(projects, eq(projects.id, creditLedger.projectId))
    .innerJoin(memberships, eq(memberships.projectId, creditLedger.projectId))
    .where(eq(memberships.userId, userId))
    .orderBy(desc(creditLedger.occurredAt))
    .limit(limit)

  return rows.map((row) => ({
    id: row.id,
    projectId: brandProjectId(row.projectId),
    projectTitle: row.projectTitle,
    kind: row.kind,
    delta: row.delta,
    reason: row.reason,
    occurredAt: stamp(row.occurredAt),
  }))
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

/**
 * Everyone this person shares a project with, once each, with the project
 * count beside them.
 *
 * The Collaborators section of account settings. Scoped to the actor by the
 * inner select - the only people it can reach are the members of projects the
 * actor is also a member of, which is the same rule the project list follows
 * and the test for belonging in this file.
 */
export type Collaborator = {
  readonly id: UserId
  readonly displayName: string
  readonly email: string
  readonly avatarUrl: string | null
  readonly projects: number
  /** Whether this is the person asking. */
  readonly you: boolean
}

export const listCollaboratorsFor = async (
  db: FolioDatabase,
  userId: UserId,
): Promise<readonly Collaborator[]> => {
  const mine = db
    .select({ projectId: memberships.projectId })
    .from(memberships)
    .where(eq(memberships.userId, userId))

  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      avatarUrl: users.avatarUrl,
      projects: sql<number>`count(distinct ${memberships.projectId})::int`,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(inArray(memberships.projectId, mine))
    .groupBy(users.id, users.displayName, users.email, users.avatarUrl)
    .orderBy(desc(sql`count(distinct ${memberships.projectId})`), asc(users.displayName))

  return rows.map((row) => ({
    id: brandUserId(row.id),
    displayName: row.displayName,
    email: row.email,
    avatarUrl: row.avatarUrl,
    projects: row.projects,
    you: row.id === userId,
  }))
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
        logline: input.logline ?? null,
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
