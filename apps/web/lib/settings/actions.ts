'use server'

import { AgentAutonomySchema } from '@folio/contracts'
import { setAgentAutonomy, transactionDatabase, upsertUser } from '@folio/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { SIGN_IN } from '../routes'
import { supabaseServer } from '../auth/server'
import { currentIdentity, requireUser } from '../auth/session'
import { avatarUrlFrom } from '../auth/identity'
import { failure, saved } from './result'
import type { AutonomyResult, SettingsResult } from './result'

/**
 * What account settings may write.
 *
 * Three writes and one refusal, each with the same shape as every other
 * server action in this app: a discriminated result, never a throw across the
 * boundary (AGENTS.md, Conventions > Errors).
 *
 * ## Why the name is written twice
 *
 * `users.display_name` is ours, and the trigger in migration `0001`
 * (`folio_sync_auth_user`) rewrites it from the auth claims every time
 * Supabase touches `auth.users` - which is every sign-in. So writing only our
 * row would produce a setting that works until the next sign-in and then
 * silently reverts, which is worse than one that refuses. The name therefore
 * goes to **the claims first** (`auth.updateUser`, which is the source the
 * trigger copies from) and then to our row, so the two agree and the trigger
 * rewrites the value that is already there. That is what makes this editable
 * at all; the previous settings page said it was not, and it was right about
 * the version of itself that only wrote one of them.
 *
 * The avatar is not editable here. It comes from the identity provider, and a
 * picture of one's own would be an upload, a bucket and a signed URL - which
 * is storage, and a decision.
 *
 * **Nothing but async functions may be exported from this file.** The result
 * type and its constructors are `./result.ts`; a constant here builds fine and
 * then fails at the first post (`lib/settings/result.ts` says why).
 */

const field = (form: FormData, name: string): string => {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

const NameSchema = z.string().trim().min(1, 'Give a name.').max(120, 'That is longer than a name.')

/** Supabase's own minimum is 6; eight is this app's, and the form says so. */
const PasswordSchema = z.string().min(8, 'Use at least 8 characters.')

export const updateProfile = async (
  _previous: SettingsResult,
  formData: FormData,
): Promise<SettingsResult> => {
  const user = await requireUser('/app/settings')
  const name = NameSchema.safeParse(field(formData, 'name'))
  if (!name.success) return failure('name', name.error.issues[0]?.message ?? 'Give a name.')
  if (user.email === null) {
    return failure('form', 'This account has no address on record, so its profile cannot be written.')
  }

  const supabase = await supabaseServer()
  // `full_name` first: it is the claim `displayNameFrom` reads and the one the
  // signup trigger copies into our row.
  const updated = await supabase.auth.updateUser({ data: { full_name: name.data, name: name.data } })
  if (updated.error !== null) {
    return failure('form', 'That could not be saved. Try again in a moment.')
  }

  const identity = await currentIdentity()
  const db = await transactionDatabase()
  await upsertUser(db, {
    id: user.id,
    email: user.email,
    displayName: name.data,
    avatarUrl: identity === null ? null : avatarUrlFrom(identity.user_metadata),
  })

  revalidatePath('/app', 'layout')
  return saved('Saved. It is the name on your notes and revision marks.')
}

/**
 * Change the password from inside the app.
 *
 * There is no "current password" box. Supabase's `updateUser` authorises on
 * the session, and this app cannot verify a current password without
 * attempting a second sign-in - which would be a second rate-limited call and
 * a worse answer than the session it already trusts. Whether a project
 * requires a recent login for this is a Supabase Auth setting, and its refusal
 * comes back here as an error rather than as a silent no-op.
 *
 * An account that signed in with Google and has never set a password can set
 * one here; that is Supabase's behaviour and it is the useful one.
 */
export const changePassword = async (
  _previous: SettingsResult,
  formData: FormData,
): Promise<SettingsResult> => {
  await requireUser('/app/settings')
  const password = PasswordSchema.safeParse(field(formData, 'password'))
  if (!password.success) {
    return failure('password', password.error.issues[0]?.message ?? 'Choose a longer password.')
  }
  if (field(formData, 'confirm') !== password.data) {
    return failure('confirm', 'The two passwords do not match.')
  }

  const supabase = await supabaseServer()
  const updated = await supabase.auth.updateUser({ password: password.data })
  if (updated.error !== null) {
    return failure('form', updated.error.message)
  }

  return saved('Password changed. Other devices stay signed in until you end them.')
}

/**
 * End every session, everywhere.
 *
 * `scope: 'global'` - the deliberate act the sign-out button is not
 * (`lib/auth/actions.ts`: "`scope: 'local'` clears this browser and leaves
 * other devices signed in... Ending every session is a different, deliberate
 * act and belongs in account settings"). This is that place. It redirects,
 * because the session this request is holding is one of the ones it ended.
 */
export const signOutEverywhere = async (): Promise<void> => {
  await requireUser('/app/settings')
  const supabase = await supabaseServer()
  await supabase.auth.signOut({ scope: 'global' })
  redirect(SIGN_IN)
}

/**
 * Delete the account. **Refuses, and deletes nothing.**
 *
 * AGENTS.md, When to ask first: "Delete or purge user data." Deleting an
 * account is every project it owns, every collaborator's access to them, and
 * a `credit_ledger` that references projects `ON DELETE restrict` - so a
 * person who has ever spent a credit cannot be removed by cascade at all, and
 * what happens instead is a decision nobody has made. The same treatment
 * `purgeProject` gets: the control is real, the confirmation is real, and the
 * answer is a refusal in words the person can read.
 */
export const deleteAccount = async (
  _previous: SettingsResult,
  _formData: FormData,
): Promise<SettingsResult> => {
  await requireUser('/app/settings')
  return failure(
    'form',
    'Deleting an account is not switched on yet. It would take every project you own, and your ' +
      'collaborators’ access to them, with it - and a project with billing history cannot be ' +
      'removed at all while the ledger references it. Nothing was deleted. Sign out everywhere ' +
      'if you want the sessions ended.',
  )
}

/**
 * The assistant's autonomy - ADR 0003 **D1**, roadmap task 3.7. `review` (the
 * default) leaves every proposal for the writer to apply; `auto` applies one
 * as soon as it is made. Neither lets a rename, a merge, a delete, a format
 * change, an undo or anything that spends credits through without a click -
 * `applyProposalWith` refuses those without a confirmation, whatever this says.
 * The person's own row only: the id is the signed-in one, never an argument.
 */
export const setAssistantAutonomy = async (raw: unknown): Promise<AutonomyResult> => {
  const user = await requireUser('/app/settings')
  const parsed = AgentAutonomySchema.safeParse(raw)
  if (!parsed.success) return { status: 'error', message: 'Choose review or automatic.' }
  await setAgentAutonomy(await transactionDatabase(), user.id, parsed.data)
  revalidatePath('/app/settings')
  return { status: 'saved', autonomy: parsed.data }
}
