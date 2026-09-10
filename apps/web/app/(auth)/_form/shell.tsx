import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Route } from 'next'

/**
 * The card every auth page is drawn in, and the pieces they share.
 *
 * A Server Component: nothing here is interactive, so nothing here ships to the
 * browser. Only the forms themselves are Client Components.
 *
 * Copy is set in Newsreader at 21px, matching the route title in the page
 * header the bundles specify - it is the one serif moment in the chrome, and
 * repeating it here is what makes a sign-in page look like this product rather
 * than like a sign-in page.
 */

export const AuthCard = ({
  title,
  blurb,
  children,
  footer,
}: {
  readonly title: string
  readonly blurb?: string
  readonly children: ReactNode
  readonly footer?: ReactNode
}) => (
  <div className="flex flex-col gap-[18px]">
    <div className="flex flex-col gap-[6px]">
      <span
        aria-hidden="true"
        className="mb-[6px] grid h-[28px] w-[28px] place-items-center rounded-chrome bg-ink text-10-5 font-semibold tracking-[.02em] text-desk"
      >
        Fo
      </span>
      <h1 className="m-0 font-serif text-21 font-medium tracking-title">{title}</h1>
      {blurb === undefined ? null : (
        <p className="m-0 text-11-5 leading-[1.5] text-ink2">{blurb}</p>
      )}
    </div>

    {children}

    {footer === undefined ? null : (
      <div className="border-t border-line2 pt-[12px] text-10-5 text-ink3">{footer}</div>
    )}
  </div>
)

/**
 * The rule between the Google button and the password form.
 *
 * `aria-hidden` on the whole thing: "or" between two forms is a visual
 * separator, and announcing it adds nothing a screen reader user can act on -
 * both forms are already labelled.
 */
export const OrRule = () => (
  <div aria-hidden="true" className="flex items-center gap-[8px] text-10 text-ink3">
    <span className="h-px flex-1 bg-line2" />
    or
    <span className="h-px flex-1 bg-line2" />
  </div>
)

export const AuthLink = ({
  href,
  children,
}: {
  readonly href: Route
  readonly children: ReactNode
}) => (
  <Link href={href} className="text-accent hover:underline">
    {children}
  </Link>
)

/**
 * A problem the callback bounced back here.
 *
 * `app/auth/callback/route.ts` redirects to `/sign-in?problem=…` when a link is
 * expired, reused or refused by the provider. Those are the common cases, not
 * edge cases - reset links are single-use and mail clients pre-fetch them - so
 * the message lands on the page the person can act on rather than on an error
 * screen with no next step.
 *
 * The text comes from Supabase, so it is rendered as content and never as
 * markup. React escapes it; this note is here so nobody later reaches for
 * `dangerouslySetInnerHTML` to make it prettier.
 */
export const CallbackProblem = ({ problem }: { readonly problem: string | undefined }) => {
  if (problem === undefined || problem.length === 0) return null
  return (
    <p
      role="alert"
      className="m-0 rounded-chrome border border-note-bg bg-note-bg px-[9px] py-[7px] text-11-5 leading-[1.5] text-ink"
    >
      {problem}
    </p>
  )
}
