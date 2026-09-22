'use client'

import { Avatar } from '@folio/ui'
import { useActionState, useId } from 'react'
import { useFormStatus } from 'react-dom'

import type { ShellUser } from '../../../../../lib/auth/session'
import { updateProfile } from '../../../../../lib/settings/actions'
import { SETTINGS_IDLE } from '../../../../../lib/settings/result'
import { Group, Note } from './settings-workspace'

/**
 * Profile: the avatar, the name, the address, and the save bar under them.
 *
 * ## The name is editable, and that took two writes
 *
 * `users.display_name` is rewritten from the auth claims by the trigger in
 * migration `0001` every time Supabase touches `auth.users` - which is every
 * sign-in. The previous version of this page said so and left the field read
 * only, which was the honest answer for a page that wrote one row. This one
 * writes the claim first and our row second (`lib/settings/actions.ts`), so
 * the trigger copies back the value that is already there and the setting
 * survives the next sign-in.
 *
 * ## What is not editable, and why
 *
 *   the address   it is the sign-in identity. Changing it is an auth flow with
 *                 a confirmation mail behind it, and Folio has no mail.
 *   the picture   it comes from the identity provider. One of our own is an
 *                 upload, a bucket and a signed URL - storage, and a decision.
 *   credited as   the title page already carries a credit, per project
 *                 (`title_pages.credit`), because that is where a credit is
 *                 printed. An account-level default would be a second place
 *                 for the same fact with nothing reading it.
 *   guild number  the same: it belongs on a registered draft's title page.
 *
 * The save bar appears when something has been typed, which is the only time
 * it has anything to do.
 */
export const ProfileForm = ({ user }: { readonly user: ShellUser }) => {
  const [result, action] = useActionState(updateProfile, SETTINGS_IDLE)
  const nameId = useId()

  return (
    <form action={action} className="flex flex-col gap-[20px]">
      <div className="flex items-center gap-[15px] rounded-card border border-line2 bg-s1 p-[15px]">
        <Avatar initials={user.initials} name={user.displayName} imageUrl={user.avatarUrl} size={54} />
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="truncate text-14">{user.displayName}</span>
          <span className="text-12 text-ink3">
            Your picture comes from the account you sign in with.
          </span>
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[15px]">
        <label className="flex flex-col gap-[6px]" htmlFor={nameId}>
          <span className="folio-eyebrow text-10-5">Name</span>
          <input
            id={nameId}
            name="name"
            type="text"
            required
            maxLength={120}
            defaultValue={user.displayName}
            autoComplete="name"
            aria-invalid={result.status === 'error' && result.field === 'name'}
            className="folio-field h-[35px] rounded-[10px] border-line bg-s1 text-13"
          />
          <span className="text-11-5 leading-[1.5] text-ink3">
            Shown on notes, revision marks and shared drafts.
          </span>
          {result.status === 'error' && result.field === 'name' ? (
            <span role="alert" className="text-10-5 text-live">
              {result.message}
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-[6px]">
          <span className="folio-eyebrow text-10-5">Email</span>
          <input
            type="email"
            value={user.email ?? ''}
            readOnly
            className="folio-field h-[35px] cursor-default rounded-[10px] border-line bg-s1 text-13 text-ink2"
          />
          <span className="text-11-5 leading-[1.5] text-ink3">
            Your sign-in address. Changing it is an auth flow with a confirmation mail behind it,
            and Folio has no mail provider.
          </span>
        </label>
      </div>

      <Group label="On a title page">
        <Note>
          A credit and a guild number are printed on a draft, and they are already per project -
          the title page carries both, where they are read. An account-level copy would be a second
          home for the same fact with nothing reading it.
        </Note>
      </Group>

      <div className="flex items-center gap-[10px] border-t border-line2 pt-[13px]">
        <span className="flex-1 text-12 text-ink3">
          {result.status === 'saved' ? result.message : 'Applies everywhere you appear.'}
        </span>
        {result.status === 'error' && result.field === 'form' ? (
          <span role="alert" className="text-11-5 text-live">
            {result.message}
          </span>
        ) : null}
        <Save />
      </div>
    </form>
  )
}

const Save = () => {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="folio-solid-button h-[31px] rounded-pill px-[15px] text-12-5 font-medium">
      {pending ? 'Saving…' : 'Save changes'}
    </button>
  )
}
