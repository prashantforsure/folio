'use client'

import { useId } from 'react'
import { useFormStatus } from 'react-dom'

import type { AuthField, AuthResult } from '../../../lib/auth/result'

/**
 * The four controls every auth form is made of.
 *
 * Written here rather than in `packages/ui` on purpose. AGENTS.md, Conventions
 * > Files: "Anything used by two routes moves to `packages/ui`" - and these are
 * used by four *pages* inside one route group, which is not the same thing. A
 * text input styled for a sign-in card is not yet a design-system primitive;
 * promoting it before a second surface needs it is how a shared package fills
 * with components that have exactly one caller and one opinion.
 *
 * There is also no `Input` in any design bundle. Every field in the fourteen
 * route files is a find box or an inline editor. So the styling below is
 * assembled from the tokens and the geometry the bundles do specify - `--sheet`
 * ground, 1px `--line`, 3px radius, 11.5-12.5px type - rather than transcribed.
 * That is a guess, and it is flagged here rather than left to look official.
 */

type FieldProps = {
  readonly name: string
  readonly label: string
  readonly type: 'email' | 'password'
  readonly autoComplete: string
  readonly result: AuthResult
  readonly owns: AuthField
  readonly defaultValue?: string
  readonly hint?: string
  readonly autoFocus?: boolean
}

export const Field = ({
  name,
  label,
  type,
  autoComplete,
  result,
  owns,
  defaultValue,
  hint,
  autoFocus,
}: FieldProps) => {
  const id = useId()
  const hintId = `${id}-hint`
  const invalid = result.status === 'error' && result.field === owns

  return (
    <div className="flex flex-col gap-[5px]">
      <label htmlFor={id} className="text-10-5 font-semibold uppercase tracking-label text-ink3">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        required
        aria-invalid={invalid}
        aria-describedby={hint === undefined ? undefined : hintId}
        className="rounded-chrome border border-line bg-sheet px-[9px] py-[7px] text-12-5 text-sheet-ink aria-[invalid=true]:border-del"
      />
      {hint === undefined ? null : (
        <p id={hintId} className="m-0 text-10-5 text-ink3">
          {hint}
        </p>
      )}
      {invalid ? (
        <p className="m-0 text-10-5 text-del" role="alert">
          {result.message}
        </p>
      ) : null}
    </div>
  )
}

/**
 * A message about the attempt rather than about a value.
 *
 * `role="status"` for the success case and `role="alert"` for the failure, so a
 * screen reader interrupts for a refusal and does not for a confirmation. Both
 * are rendered in the flow, not as a toast: a sentence about a rate limit needs
 * to still be on screen thirty seconds later.
 */
export const FormMessage = ({ result }: { readonly result: AuthResult }) => {
  if (result.status === 'sent') {
    return (
      <p
        role="status"
        className="m-0 rounded-chrome border border-add-bg bg-add-bg px-[9px] py-[7px] text-11-5 leading-[1.5] text-ink"
      >
        {result.message}
      </p>
    )
  }

  if (result.status === 'error' && result.field === 'form') {
    return (
      <p
        role="alert"
        className="m-0 rounded-chrome border border-del-bg bg-del-bg px-[9px] py-[7px] text-11-5 leading-[1.5] text-ink"
      >
        {result.message}
      </p>
    )
  }

  return null
}

/**
 * The submit button, disabled while the action is in flight.
 *
 * `useFormStatus` has to be read by a component *inside* the form, which is the
 * only reason this is its own component rather than a prop on the page.
 */
export const Submit = ({ children }: { readonly children: string }) => {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="cursor-pointer rounded-chrome border-none bg-accent px-[12px] py-[8px] text-12 font-medium text-accent-ink disabled:cursor-default disabled:opacity-60"
    >
      {pending ? 'Working…' : children}
    </button>
  )
}

/**
 * The Google button.
 *
 * Its own form, because it posts to a different action than the page's. Styled
 * as a secondary control - AGENTS.md's original constraint made Google the only
 * way in, and it is still the one that needs no email to be delivered, but the
 * page is a password form and the primary button belongs to the primary act.
 */
export const GoogleButton = () => {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full cursor-pointer rounded-chrome border border-line bg-transparent px-[12px] py-[8px] text-12 text-ink hover:bg-hover disabled:cursor-default disabled:opacity-60"
    >
      {pending ? 'Working…' : 'Continue with Google'}
    </button>
  )
}
