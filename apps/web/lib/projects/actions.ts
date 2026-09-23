'use server'

import { CreateProjectInputSchema, LoglineSchema, ProjectIdSchema, TitleSchema, userId as brandUserId } from '@folio/contracts'
import type { MembershipRole, ProjectId, UserId } from '@folio/contracts'
import {
  createProjectFor,
  listProjectsFor,
  openProjectForRequest,
  readMembershipFor,
  renameProject as renameProjectRow,
  restoreProject as restoreProjectRow,
  setProjectArchived,
  setProjectLogline,
  transactionDatabase,
  trashProject as trashProjectRow,
} from '@folio/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { ROLE, ROLE_REFUSED, meetsRole } from '../auth/roles'
import { currentIdentity, requireUser } from '../auth/session'
import { importScript } from '../script/actions'
import { IMPORT_IDLE } from '../script/result'
import { DONE, failure, IDLE } from './result'
import type { ProjectActionResult, ProjectField } from './result'
import { kindLine, statsLine } from './view'
import { workspaceHref } from './workspace'

/**
 * The three mutations the shell routes make, and the gate each one enforces.
 *
 * AGENTS.md, Feature workflow 7: "Server action or route handler. Every gate
 * is enforced here - scope, allowlist, cost, research readability, tenancy."
 * For these three the gates are identity and
 * membership: `requireUser()` establishes who is acting, `readMembershipFor()`
 * establishes that they may act on this project, and only then is a
 * `ProjectScope` opened. `repositories/index.ts` is explicit that opening a
 * scope checks nothing about the actor - this file is where that check lives.
 *
 * Every function returns a `ProjectActionResult` or redirects. Nothing throws
 * across the boundary.
 */

const field = (form: FormData, name: string): string => {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

const CREATE_FIELDS: readonly ProjectField[] = ['title', 'kind', 'projectType', 'format']

const isCreateField = (value: unknown): value is ProjectField =>
  typeof value === 'string' && (CREATE_FIELDS as readonly string[]).includes(value)

/**
 * Create a project from the three axes and a title, and open it.
 *
 * The parse is `CreateProjectInputSchema` from `@folio/contracts`, so what the
 * form may submit and what the worker may one day submit are the same shape.
 * A missing radio arrives as an empty string and Zod refuses it with the
 * field's own name, which is how the message lands beside the right control.
 *
 * Creation writes exactly one episode row whatever the project type; that is
 * `createProjectFor`'s contract, and it is asserted against the database in
 * the phase report rather than trusted.
 */
export const createProject = async (
  _previous: ProjectActionResult,
  formData: FormData,
): Promise<ProjectActionResult> => {
  const user = await requireUser('/app/new')

  const logline = field(formData, 'logline').trim()
  const parsed = CreateProjectInputSchema.safeParse({
    title: field(formData, 'title'),
    kind: field(formData, 'kind'),
    projectType: field(formData, 'projectType'),
    format: field(formData, 'format'),
    logline: logline.length === 0 ? null : logline,
  })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const at = issue?.path[0]
    if (at === 'title') return failure('title', 'Give the project a title.')
    if (at === 'logline') return failure('logline', 'That description is too long for a logline.')
    if (isCreateField(at)) return failure(at, 'Choose one.')
    return failure('form', issue?.message ?? 'Check the form.')
  }

  /*
   * The dialog's optional import. The file is checked here only for being a
   * file; what it may be, how big it may be and what it parses to is
   * `importScript`'s, which is the one import path and stays the one import
   * path - this calls it rather than repeating it.
   */
  const attached = formData.get('file')
  const file = attached instanceof File && attached.size > 0 ? attached : null

  const db = await transactionDatabase()
  const { project, episode } = await createProjectFor(db, user.id, parsed.data)

  if (file !== null) {
    const importing = new FormData()
    importing.set('projectId', project.id)
    importing.set('episode', episode.slug)
    importing.set('file', file)
    const imported = await importScript(IMPORT_IDLE, importing)
    if (imported.status === 'error' || imported.status === 'refused') {
      /*
       * The project exists - it was written before the file was read, because
       * an import needs an episode to import into. Saying so is the honest
       * report: the writer's next move is to open it and use Import from the
       * script's actions menu, not to create it again.
       */
      revalidatePath('/app', 'layout')
      return failure(
        'file',
        `${project.title} was created, but that file was not imported: ${imported.message} Open the project and try Import from the script's ⋯ menu.`,
      )
    }
  }

  // The lists are dynamic, but the client router keeps a copy of the last
  // render; this is what makes the new card appear without a hard reload.
  revalidatePath('/app', 'layout')
  redirect(workspaceHref(project, episode.slug))
}

// ---------------------------------------------------------------------------
// The Projects route's writes - rename, archive, trash
// ---------------------------------------------------------------------------

/**
 * The membership **and role** gate, once, for the actions that take a project
 * id from a form. Returns the scope or the refusal a caller hands straight
 * back.
 *
 * The not-found message is the same whether the project does not exist or is
 * somebody else's, and deliberately so: a different message for each would
 * answer the question "does this id exist" for anybody who asks. A member
 * whose role is too low gets a different message, because they can already see
 * the project and telling them it is gone would be a lie - the same split
 * `lib/script/gate.ts` makes.
 *
 * Every caller here is `ROLE.projectAdmin`: renaming, archiving, trashing,
 * restoring and purging are what ADR 0003 **D2** puts behind `owner`, being
 * changes to the container rather than to the work.
 */
const openForActor = async (
  raw: string,
  returnTo: string,
  minimum: MembershipRole,
): Promise<
  | { readonly ok: true; readonly projectId: ProjectId; readonly actor: UserId; readonly role: MembershipRole }
  | { readonly ok: false; readonly result: ProjectActionResult }
> => {
  const user = await requireUser(returnTo)
  const parsed = ProjectIdSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, result: failure('form', 'That project could not be found.') }
  const db = await transactionDatabase()
  const membership = await readMembershipFor(db, user.id, parsed.data)
  if (membership === null) return { ok: false, result: failure('form', 'That project could not be found.') }
  if (!meetsRole(membership.role, minimum)) return { ok: false, result: failure('form', ROLE_REFUSED) }
  return { ok: true, projectId: parsed.data, actor: user.id, role: membership.role }
}

/**
 * Rename a project and set its logline, from the dialog the card's `⋯` menu
 * opens. Two columns, one form, one gate, two statements.
 *
 * The logline is written only when the form carries the field at all, so a
 * caller that renames and nothing else cannot blank a sentence it never
 * showed. An empty box *does* clear it: the column is nullable and the card
 * leaves the line out rather than printing an empty paragraph.
 *
 * **Owner only**, with every other write on this route: renaming a project
 * and setting its logline are changes to the container rather than to the
 * work, which is the line ADR 0003 **D2** draws between writer and owner.
 */
export const editProject = async (
  _previous: ProjectActionResult,
  formData: FormData,
): Promise<ProjectActionResult> => {
  const title = TitleSchema.safeParse(field(formData, 'title'))
  if (!title.success) return failure('title', 'Give the project a title.')

  const raw = formData.get('logline')
  const wanted = typeof raw === 'string' ? raw.trim() : null
  const logline = wanted === null || wanted.length === 0 ? null : LoglineSchema.safeParse(wanted)
  if (logline !== null && !logline.success) {
    return failure('logline', 'That is longer than a logline. Keep it to a sentence or two.')
  }

  const gate = await openForActor(field(formData, 'projectId'), '/app/projects', ROLE.projectAdmin)
  if (!gate.ok) return gate.result

  const scope = await openProjectForRequest(gate.projectId, gate.actor)
  await renameProjectRow(scope, title.data)
  if (wanted !== null) await setProjectLogline(scope, logline === null ? null : logline.data)

  revalidatePath('/app', 'layout')
  return DONE
}

/**
 * Archive, or bring back. One or many - the bulk bar posts every selected id
 * under the same name, and `getAll` reads them.
 *
 * Archiving is not deleting and writes no tombstone: it sets `archived_at`,
 * the project leaves the `All` chip and appears under `Archived`, and every
 * link to it still works. Which is why this is not behind the question that
 * `Delete forever` is.
 */
export const archiveProjects = async (
  _previous: ProjectActionResult,
  formData: FormData,
): Promise<ProjectActionResult> => {
  const archived = field(formData, 'archived') !== '0'
  const ids = formData.getAll('projectId').filter((value): value is string => typeof value === 'string')
  if (ids.length === 0) return failure('form', 'Nothing was selected.')

  for (const id of ids) {
    const gate = await openForActor(id, '/app/projects', ROLE.projectAdmin)
    if (!gate.ok) return gate.result
    const scope = await openProjectForRequest(gate.projectId, gate.actor)
    await setProjectArchived(scope, archived)
  }

  revalidatePath('/app', 'layout')
  return DONE
}

/**
 * Move to the trash. The card menu's red `Delete`, and the bulk bar's.
 *
 * **This is the soft delete and it is the only delete this route has.** The
 * handoff's `Delete` reads as final; in Folio it is `trashed_at`, the project
 * moves to `/app/trash`, and deleting it for good is that route's refusal
 * (`purgeProject` below), which is where the question AGENTS.md asks for is
 * waiting. The menu item says `Move to trash` for that reason - a label that
 * promised finality would be the lie.
 */
export const trashProjects = async (
  _previous: ProjectActionResult,
  formData: FormData,
): Promise<ProjectActionResult> => {
  const ids = formData.getAll('projectId').filter((value): value is string => typeof value === 'string')
  if (ids.length === 0) return failure('form', 'Nothing was selected.')

  for (const id of ids) {
    const gate = await openForActor(id, '/app/projects', ROLE.projectAdmin)
    if (!gate.ok) return gate.result
    const scope = await openProjectForRequest(gate.projectId, gate.actor)
    await trashProjectRow(scope)
  }

  revalidatePath('/app', 'layout')
  return DONE
}

/**
 * Duplicate. **Refuses, in words, and copies nothing.**
 *
 * The control is in the handoff's menu and in its bulk bar, so it is drawn -
 * but what a copy of a project *is* has not been decided, and three of the
 * open questions are not this pass's to answer (AGENTS.md, Development
 * philosophy 10; When to ask first):
 *
 *   - **`@mention`s are references to record ids, not text.** Copying a node
 *     list copies mentions that point at the original project's characters
 *     and locations - a cross-tenant reference the whole node model is built
 *     to prevent. A copy either remints every record and remaps every mention,
 *     or it drops them, and those are different products.
 *   - **Comment threads, revisions and locked pages** hang off node ids. Do
 *     they come across? A copy with somebody else's notes on it is not
 *     obviously wanted, and a copy without them loses the reason a draft was
 *     worth copying.
 *   - **The ledger.** `credit_ledger` is append-only and per project. A copy
 *     starts at zero, which is a decision about money.
 *
 * So the shape is built and the answer is refused where the writer asked,
 * the same treatment `purgeProject` gets.
 */
export const duplicateProjects = async (
  _previous: ProjectActionResult,
  formData: FormData,
): Promise<ProjectActionResult> => {
  const ids = formData.getAll('projectId').filter((value): value is string => typeof value === 'string')
  if (ids.length === 0) return failure('form', 'Nothing was selected.')

  return failure(
    'form',
    'Duplicating is not switched on yet. What a copy does with @mentions bound to characters and ' +
      'locations, with notes and revisions, and with the credit ledger is still being decided. ' +
      'Nothing was copied.',
  )
}

/**
 * Bring a project back from the trash. **Owner only** since ADR 0003 **D2** -
 * taking a project out of the trash is a change to the container, and the row
 * that was "one condition away from `owner` if that is ruled" is now that
 * condition, through the same gate as the rest of the route.
 */
export const restoreProject = async (
  _previous: ProjectActionResult,
  formData: FormData,
): Promise<ProjectActionResult> => {
  const gate = await openForActor(field(formData, 'projectId'), '/app/trash', ROLE.projectAdmin)
  if (!gate.ok) return gate.result

  const scope = await openProjectForRequest(gate.projectId, gate.actor)
  await restoreProjectRow(scope)

  revalidatePath('/app', 'layout')
  return IDLE
}

/**
 * Delete a project forever. **The destructive statement is deliberately absent.**
 *
 * AGENTS.md, When to ask first: "Delete or purge user data" needs a human. The
 * gate, the confirmation and the wire shape are built so that the answer, when
 * it comes, is one repository call; until then this action refuses, in words
 * the writer can read, and deletes nothing.
 *
 * The proposed semantics are in the phase report. In short: owner only; delete
 * the project row and let `ON DELETE CASCADE` take every content table with
 * it; `credit_ledger` is `ON DELETE RESTRICT`, so a project with billing
 * history cannot be hard-deleted and would need a tombstone instead; not
 * recoverable. Every one of those is a decision, which is why none is here.
 *
 * The role check is the route's own gate now (ADR 0003 **D2**): purge is
 * `ROLE.projectAdmin`, like everything else here, rather than the one
 * hand-written `role !== 'owner'` it used to be.
 */
export const purgeProject = async (
  _previous: ProjectActionResult,
  formData: FormData,
): Promise<ProjectActionResult> => {
  const gate = await openForActor(field(formData, 'projectId'), '/app/trash', ROLE.projectAdmin)
  if (!gate.ok) return gate.result

  return failure(
    'form',
    'Deleting forever is not switched on yet. What it removes, and whether a project with ' +
      'billing history can be removed at all, is waiting on a decision. The project stays in the trash.',
  )
}

/** A row of the assistant launcher's recent list (ADR 0003 **D15**). */
export type RecentProject = {
  readonly id: ProjectId
  readonly title: string
  readonly kind: string
  readonly stats: string
}

export type RecentProjectsResult =
  | { readonly status: 'ok'; readonly projects: readonly RecentProject[] }
  | { readonly status: 'refused'; readonly message: string }

/** How many projects the launcher lists. Enough to find this week's work, few enough to read. */
const RECENT_PROJECTS = 6

/**
 * The assistant launcher's list: the signed-in person's live, unarchived
 * screenwriting projects, most recently edited first (roadmap task 2.2).
 *
 * A read of the same repository the Projects route reads, cut to a few rows
 * and to the fields a row prints. Filmmaking projects are left out because
 * they have no workspace to open (AGENTS.md, open decision 9). Identity only -
 * there is no project yet to have a role in, and the query reads nothing but
 * the caller's own memberships. Refuses rather than redirects, because the
 * caller is a panel, not a page.
 */
export const listRecentProjects = async (): Promise<RecentProjectsResult> => {
  const identity = await currentIdentity()
  if (identity === null) return { status: 'refused', message: 'Sign in to see your projects.' }
  const db = await transactionDatabase()
  const cards = await listProjectsFor(db, brandUserId(identity.id), { kind: 'screenwriting', trashed: false, archived: false })
  return {
    status: 'ok',
    projects: cards.slice(0, RECENT_PROJECTS).map((card) => ({
      id: card.project.id,
      title: card.project.title,
      kind: kindLine(card),
      stats: statsLine(card),
    })),
  }
}
