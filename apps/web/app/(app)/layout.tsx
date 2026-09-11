import type { ReactNode } from 'react'

import { requireUser } from '../../lib/auth/session'
import { EphemeralProvider } from '../../lib/state/ephemeral'

/**
 * Never prerendered.
 *
 * Every route under this layout depends on a session cookie, so there is no
 * correct static output for any of them. Next cannot always work that out on
 * its own: `requireUser()` reads the environment before it reads `cookies()`,
 * so on a machine with no Supabase project the build fails on a missing
 * variable rather than bailing out to dynamic. That failure is real - the page
 * genuinely cannot be rendered without a request - but it is reported as an
 * environment problem, which sends the reader somewhere unhelpful.
 *
 * Declaring it here says the true thing directly, and keeps `next build`
 * working on a checkout with no credentials at all, which the rest of this
 * repository already guarantees.
 */
export const dynamic = 'force-dynamic'

/**
 * The signed-in boundary and frame. The chrome is one level down.
 *
 * AGENTS.md, Architecture: "`app/(app)/` Signed-in shell: sidebar, theme,
 * avatar. Everything user-facing lives under /app."
 *
 * ## This is the security boundary, not `proxy.ts`
 *
 * `requireUser()` runs here, in a Server Component, on every render of every
 * route inside this group. The proxy redirects earlier and is nicer, but it
 * matches on a path pattern, and a path pattern is a list somebody edits. A
 * route added to this tree is protected **by being in this tree**.
 *
 * AGENTS.md, Development philosophy 5: "The server enforces; the client
 * discloses." Nothing below this line has to check anything: by the time a page
 * renders, there is a user.
 *
 * The `returnTo` is `/app` rather than the exact path, because a layout cannot
 * see its own URL and Next does not put one in the request. That only matters
 * when the proxy has been bypassed - the normal deep-link case is handled
 * there, with the full path and query preserved.
 *
 * ## Two shells under one boundary
 *
 * Everything under `/app` shares this layout and nothing else visual. The
 * chrome is drawn one level down, by a layout that knows which shell it is:
 * `app/(home)/layout.tsx` draws the four-item sidebar for the project lists,
 * and `app/project/[projectId]/layout.tsx` draws the 66px rail for the
 * workspace. Both are layouts, not pages, for the same reason the sidebar was
 * here before there were two of them: "Panel show/hide and theme live HERE and
 * persist across route changes." A layout is not re-mounted when a route
 * below it changes, so chrome state survives navigation. Rendering it inside
 * each page would remount it every time, and the visible symptom is an avatar
 * menu that closes itself when you click a link in it.
 *
 * `EphemeralProvider` sits here for the same reason - and only here, not in the
 * root layout, because a command palette and an agent scope belong to the
 * signed-in product. The sign-in page has no use for either.
 *
 * ## `overflow-hidden` on the frame
 *
 * The bundles scroll panels, never the document: `height: 100vh` with
 * `overflow: hidden` on the frame, and each column owning its own scroll. That
 * is what keeps the rail and the header fixed while a script scrolls, without
 * anything being `position: fixed`.
 */
const AppLayout = async ({ children }: { readonly children: ReactNode }) => {
  await requireUser('/app')

  return (
    <EphemeralProvider>
      <div className="flex h-screen overflow-hidden bg-desk text-ink">{children}</div>
    </EphemeralProvider>
  )
}

export default AppLayout
