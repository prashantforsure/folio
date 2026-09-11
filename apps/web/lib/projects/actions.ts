'use server'

import { CreateProjectInputSchema, ProjectIdSchema } from '@folio/contracts'
import {
  createProjectFor,
  openProjectForRequest,
  readMembershipFor,
  restoreProject as restoreProjectRow,
  transactionDatabase,
} from '@folio/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireUser } from '../auth/session'
import { failure, IDLE } from './result'
import type { ProjectActionResult, ProjectField } from './result'
import { workspaceHref } from './workspace'

/**
 * The three mutations the shell routes make, and the gate each one enforces.
 *
 * AGENTS.md, Feature workflow 7: "Server action or route handler. Every gate
 * is enforced here - scope, allowlist, cost, bible status, research
 * readability, tenancy." For these three the gates are identity and
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

  const parsed = CreateProjectInputSchema.safeParse({
    title: field(formData, 'title'),
    kind: field(formData, 'kind'),
    projectType: field(formData, 'projectType'),
    format: field(formData, 'format'),
  })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const at = issue?.path[0]
    if (at === 'title') return failure('title', 'Give the project a title.')
    if (isCreateField(at)) return failure(at, 'Choose one.')
    return failure('form', issue?.message ?? 'Check the form.')
  }

  const db = await transactionDatabase()
  const { project, episode } = await createProjectFor(db, user.id, parsed.data)

  // The lists are dynamic, but the client router keeps a copy of the last
  // render; this is what makes the new card appear without a hard reload.
  revalidatePath('/app', 'layout')
  redirect(workspaceHref(project, episode.slug))
}

/**
 * Bring a project back from the trash.
 *
 * Membership, not role, is the gate. `memberships.role` is stored and read by
 * nothing (`docs/build-decisions.md`, "Membership roles are stored and
 * enforced nowhere"), and deciding here that only an owner may restore would
 * be the first line of a capability model nobody has specified. Flagged in the
 * phase report; the row is one condition away from `owner` if that is ruled.
 */
export const restoreProject = async (
  _previous: ProjectActionResult,
  formData: FormData,
): Promise<ProjectActionResult> => {
  const user = await requireUser('/app/trash')

  const projectId = ProjectIdSchema.safeParse(field(formData, 'projectId'))
  if (!projectId.success) return failure('form', 'That project could not be found.')

  const db = await transactionDatabase()
  const membership = await readMembershipFor(db, user.id, projectId.data)
  if (membership === null) return failure('form', 'That project could not be found.')

  const scope = await openProjectForRequest(projectId.data, user.id)
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
 * The role check *is* here, because it is part of what is being proposed and
 * a reviewer should see the shape of the gate rather than imagine it.
 */
export const purgeProject = async (
  _previous: ProjectActionResult,
  formData: FormData,
): Promise<ProjectActionResult> => {
  const user = await requireUser('/app/trash')

  const projectId = ProjectIdSchema.safeParse(field(formData, 'projectId'))
  if (!projectId.success) return failure('form', 'That project could not be found.')

  const db = await transactionDatabase()
  const membership = await readMembershipFor(db, user.id, projectId.data)
  if (membership === null) return failure('form', 'That project could not be found.')
  if (membership.role !== 'owner') {
    return failure('form', 'Only the project’s owner can delete it forever.')
  }

  return failure(
    'form',
    'Deleting forever is not switched on yet. What it removes, and whether a project with ' +
      'billing history can be removed at all, is waiting on a decision. The project stays in the trash.',
  )
}
