import type { ReactNode } from 'react'

/**
 * The signed-out frame. One centred card on the desk ground.
 *
 * No sidebar, no avatar, no theme toggle. The theme still applies - `<html>`
 * carries `data-theme` and the inline script has already corrected it - but
 * there is nothing here to change it with, because a preference set before
 * anyone knows who you are has nowhere to be stored against.
 *
 * Deliberately outside `(app)`: nothing in this group calls `requireUser()`,
 * and `proxy.ts` sends a signed-in visitor away from `/sign-in`,
 * `/sign-up` and `/forgot-password`. `/reset-password` is **not** in that list
 * and must not be: arriving there means the person has just followed a recovery
 * link and therefore already has a session, so bouncing signed-in visitors
 * would make the reset page unreachable by exactly the people it is for.
 */
const AuthLayout = ({ children }: { readonly children: ReactNode }) => (
  <main className="flex min-h-screen items-center justify-center bg-desk px-[16px] py-[48px] text-ink">
    <div className="w-full max-w-[340px]">{children}</div>
  </main>
)

export default AuthLayout
