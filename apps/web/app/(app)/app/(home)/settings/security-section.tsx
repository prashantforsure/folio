'use client'

import { useActionState, useId, useRef } from 'react'
import { useFormStatus } from 'react-dom'

import { changePassword, deleteAccount, signOutEverywhere } from '../../../../../lib/settings/actions'
import { SETTINGS_IDLE } from '../../../../../lib/settings/result'
import { Group, Note } from './settings-workspace'

/**
 * Security: the password, the sessions, and the danger zone.
 *
 * ## What this page can and cannot know about devices
 *
 * The handoff lists active sessions with a `Revoke` beside each. Supabase does
 * not expose one user's sessions to the app - listing or ending a named device
 * is an admin-API call against every user, which is not a capability this app
 * gives itself over its own customers. So there is no list, and the one thing
 * that genuinely ends every other device is here instead: a global sign-out,
 * which is the deliberate act the sidebar's `Sign out` deliberately is not
 * (that one is `scope: 'local'` and leaves other devices alone).
 *
 * Two-factor is drawn and disabled: it is a Supabase Auth feature this project
 * has not enrolled, and switching it on is a decision about how people get
 * back in when they lose the device.
 *
 * Deleting the account is a real confirmation with a refusal behind it - the
 * same treatment `purgeProject` gets on the Trash route, and for the same
 * reason (AGENTS.md, When to ask first).
 */
export const AccountSecurity = () => {
  const [password, changeAction] = useActionState(changePassword, SETTINGS_IDLE)
  const [deletion, deleteAction] = useActionState(deleteAccount, SETTINGS_IDLE)
  const dialog = useRef<HTMLDialogElement>(null)
  const passwordId = useId()
  const confirmId = useId()

  return (
    <div className="flex flex-col gap-[20px]">
      <Group label="Password">
        <form action={changeAction} className="flex flex-col gap-[12px] rounded-card border border-line2 bg-s1 p-[15px]">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-[12px]">
            <label className="flex flex-col gap-[6px]" htmlFor={passwordId}>
              <span className="folio-eyebrow text-10-5">New password</span>
              <input
                id={passwordId}
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="folio-field h-[35px] rounded-[10px] border-line bg-sunk text-13"
              />
              {password.status === 'error' && password.field === 'password' ? (
                <span role="alert" className="text-10-5 text-live">
                  {password.message}
                </span>
              ) : null}
            </label>
            <label className="flex flex-col gap-[6px]" htmlFor={confirmId}>
              <span className="folio-eyebrow text-10-5">Again</span>
              <input
                id={confirmId}
                name="confirm"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="folio-field h-[35px] rounded-[10px] border-line bg-sunk text-13"
              />
              {password.status === 'error' && password.field === 'confirm' ? (
                <span role="alert" className="text-10-5 text-live">
                  {password.message}
                </span>
              ) : null}
            </label>
          </div>
          <div className="flex items-center gap-[10px]">
            <span className="flex-1 text-11-5 leading-[1.5] text-ink3">
              {password.status === 'saved'
                ? password.message
                : 'At least 8 characters. There is no current-password box: your session is the authorisation.'}
            </span>
            <Submit label="Change password" pendingLabel="Changing…" />
          </div>
          {password.status === 'error' && password.field === 'form' ? (
            <p role="alert" className="m-0 text-11-5 text-live">
              {password.message}
            </p>
          ) : null}
        </form>
      </Group>

      <Group label="Two-factor">
        <div className="flex items-center gap-[14px] rounded-card border border-line2 bg-s1 px-[15px] py-[13px]">
          <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="text-13">Authenticator app</span>
            <span className="text-12 leading-[1.5] text-ink3">
              Not enrolled. Turning it on is a decision about how somebody gets back in when they
              lose the device, and there is no recovery flow behind it yet.
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={false}
            aria-label="Two-factor authentication"
            disabled
            title="Not enrolled for this project."
            className="folio-switch"
          >
            <span className="folio-switch-knob" />
          </button>
        </div>
      </Group>

      <Group label="Devices">
        <Note>
          Folio cannot list your devices: one user&rsquo;s sessions are not readable by the app,
          and reading them would mean giving this server an admin capability over every account.
          What it can do is end them all at once.
        </Note>
      </Group>

      <div className="flex flex-col gap-[11px] rounded-card border border-live p-[15px]">
        <span className="text-13 text-live">Danger zone</span>
        <span className="text-12-5 leading-[1.55] text-ink2">
          Signing out everywhere ends every session, including this one, and keeps your work.
          Deleting the account would take every project you own - and your collaborators&rsquo;
          access to them - with it.
        </span>
        <div className="flex flex-wrap items-center gap-[8px]">
          <form action={signOutEverywhere}>
            <button type="submit" className="folio-pill-button h-[30px] rounded-[9px] border-line px-[12px] text-12">
              Sign out everywhere
            </button>
          </form>
          <button
            type="button"
            disabled
            title="Exporting every project at once needs an archive format Folio does not build. A script exports to Final Draft from its own ⋯ menu."
            className="folio-pill-button h-[30px] rounded-[9px] border-line px-[12px] text-12"
          >
            Export all projects
          </button>
          <button
            type="button"
            onClick={() => {
              dialog.current?.showModal()
            }}
            className="h-[30px] rounded-[9px] border border-live bg-transparent px-[12px] text-12 text-live hover:bg-live-bg"
          >
            Delete account
          </button>
        </div>
      </div>

      <dialog
        ref={dialog}
        aria-label="Delete account"
        className="m-auto w-[min(440px,92vw)] rounded-panel border border-line bg-bg p-0 text-ink backdrop:bg-scrim"
      >
        <form action={deleteAction} className="flex flex-col">
          <div className="flex flex-col gap-[10px] px-[18px] pb-[14px] pt-[16px]">
            <h2 className="m-0 text-15 font-medium tracking-title">Delete your account?</h2>
            <p className="m-0 text-11-5 leading-[1.55] text-ink2">
              This would remove every project you own, every episode, script, note and revision in
              them, and your collaborators&rsquo; access. It cannot be undone.
            </p>
            {deletion.status === 'error' ? (
              <p role="alert" className="m-0 rounded-[9px] border border-warn-bg bg-warn-bg px-[9px] py-[7px] text-11 leading-[1.5] text-ink">
                {deletion.message}
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-end gap-[8px] border-t border-line2 bg-s1 px-[18px] py-[12px]">
            <button
              type="button"
              onClick={() => {
                dialog.current?.close()
              }}
              className="folio-pill-button h-[31px] rounded-pill px-[13px] text-12-5"
            >
              Keep it
            </button>
            <button
              type="submit"
              className="h-[31px] rounded-pill border border-live bg-transparent px-[15px] text-12-5 text-live hover:bg-live-bg"
            >
              Delete account
            </button>
          </div>
        </form>
      </dialog>
    </div>
  )
}

const Submit = ({ label, pendingLabel }: { readonly label: string; readonly pendingLabel: string }) => {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="folio-solid-button h-[31px] rounded-pill px-[15px] text-12-5 font-medium">
      {pending ? pendingLabel : label}
    </button>
  )
}
