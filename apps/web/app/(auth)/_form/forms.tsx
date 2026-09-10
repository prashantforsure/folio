'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import {
  requestPasswordReset,
  signInWithGoogle,
  signInWithPassword,
  signUpWithPassword,
  updatePassword,
} from '../../../lib/auth/actions'
import { IDLE } from '../../../lib/auth/result'
import { Field, FormMessage, GoogleButton, Submit } from './controls'

/**
 * The four forms, and the Google button.
 *
 * All five are Client Components for one reason: `useActionState`, which is how
 * a Server Action's discriminated result gets back into the page without a
 * throw crossing the boundary. AGENTS.md, Conventions > Errors: "Server actions
 * return a discriminated result, never a bare throw across the boundary."
 *
 * The *pages* that render these stay Server Components, so `searchParams` is
 * read on the server and only the form itself ships to the browser.
 *
 * Every form carries `next` as a hidden input. It arrives from the URL, having
 * been put there by `proxy.ts` when it bounced a deep link, and it is
 * validated in `app/auth/callback/route.ts` before any redirect uses it - a
 * `next` from a query string is attacker-supplied and an unchecked one is an
 * open redirect.
 */

export const GoogleForm = ({ next }: { readonly next: string }) => {
  const [result, action] = useActionState(signInWithGoogle, IDLE)
  return (
    <form action={action} className="flex flex-col gap-[8px]">
      <input type="hidden" name="next" value={next} />
      <FormMessage result={result} />
      <GoogleButton />
    </form>
  )
}

export const SignInForm = ({ next }: { readonly next: string }) => {
  const [result, action] = useActionState(signInWithPassword, IDLE)
  return (
    <form action={action} className="flex flex-col gap-[12px]">
      <input type="hidden" name="next" value={next} />
      <Field
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        result={result}
        owns="email"
        autoFocus
      />
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        result={result}
        owns="password"
      />
      <FormMessage result={result} />
      <Submit>Sign in</Submit>
      <Link href="/forgot-password" className="text-10-5 text-ink3 hover:text-ink2">
        Forgotten your password?
      </Link>
    </form>
  )
}

export const SignUpForm = ({ next }: { readonly next: string }) => {
  const [result, action] = useActionState(signUpWithPassword, IDLE)
  return (
    <form action={action} className="flex flex-col gap-[12px]">
      <input type="hidden" name="next" value={next} />
      <Field
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        result={result}
        owns="email"
        autoFocus
      />
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        result={result}
        owns="password"
        hint="At least 8 characters."
      />
      <FormMessage result={result} />
      <Submit>Create account</Submit>
    </form>
  )
}

export const ForgotPasswordForm = () => {
  const [result, action] = useActionState(requestPasswordReset, IDLE)
  return (
    <form action={action} className="flex flex-col gap-[12px]">
      <Field
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        result={result}
        owns="email"
        autoFocus
      />
      <FormMessage result={result} />
      <Submit>Send a reset link</Submit>
    </form>
  )
}

export const ResetPasswordForm = () => {
  const [result, action] = useActionState(updatePassword, IDLE)
  return (
    <form action={action} className="flex flex-col gap-[12px]">
      <Field
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        result={result}
        owns="password"
        hint="At least 8 characters."
        autoFocus
      />
      <Field
        name="confirm"
        label="Repeat it"
        type="password"
        autoComplete="new-password"
        result={result}
        owns="confirm"
      />
      <FormMessage result={result} />
      <Submit>Set the password</Submit>
    </form>
  )
}
