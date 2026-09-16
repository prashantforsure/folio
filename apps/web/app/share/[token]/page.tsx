import { ShareTokenSchema } from '@folio/contracts'
import {
  addMembership,
  openProjectForRequest,
  readMembershipFor,
  readProject,
  readShareLinkByToken,
  transactionDatabase,
} from '@folio/db'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { requireUser } from '../../../lib/auth/session'
import { projectHref } from '../../../lib/workspace/hrefs'

/**
 * `/share/:token` - what a copied share link opens.
 *
 * AGENTS.md, Constraints: "Team invites are share links generated in-app and
 * copied by the inviter." This is the other end. Outside `(app)` on purpose:
 * that layout's gate sends a stranger to sign-in with `next=/app`, and the
 * token would be lost on the way. Here the gate is called with this very
 * path, so signing in (or up) brings the person straight back and the
 * membership is written then.
 *
 * ## What it writes, and what it refuses
 *
 *   a live token       `memberships` row for the visitor, with the link's role
 *                      and `invited_via: 'share_link'`; then the project.
 *                      `addMembership` is `ON CONFLICT DO NOTHING`, so a member
 *                      who opens the link again keeps the role they had.
 *   a revoked token    a page saying so. The row is kept for exactly this.
 *   an unknown token   the same page - a token nobody issued and a token
 *                      somebody revoked are not distinguished for a stranger.
 *
 * The one unscoped read (`readShareLinkByToken`) returns a single row by a
 * 192-bit secret; the scope is opened for that row's project only after the
 * identity gate, and nothing is written that the scope does not tenant.
 */
const Page = async ({ params }: { readonly params: Promise<{ readonly token: string }> }) => {
  const { token } = await params
  const parsed = ShareTokenSchema.safeParse(token)
  const user = await requireUser(`/share/${token}`)

  if (!parsed.success) return <Refused reason="unknown" />

  const db = await transactionDatabase()
  const link = await readShareLinkByToken(db, parsed.data)
  if (link === null) return <Refused reason="unknown" />
  if (link.revokedAt !== null) return <Refused reason="revoked" />

  const existing = await readMembershipFor(db, user.id, link.projectId)
  if (existing === null) {
    const scope = await openProjectForRequest(link.projectId, user.id)
    const project = await readProject(scope)
    if (project === null || project.trashedAt !== null) return <Refused reason="unknown" />
    await addMembership(scope, user.id, link.role, 'share_link')
  }
  redirect(projectHref(link.projectId))
}

const Refused = ({ reason }: { readonly reason: 'unknown' | 'revoked' }) => (
  <main className="grid min-h-screen place-items-center bg-bg px-[16px] text-ink">
    <div className="flex w-full max-w-[440px] flex-col gap-[10px] rounded-panel border border-line2 bg-s1 p-[24px]">
      <h1 className="m-0 text-17 font-medium tracking-title">
        {reason === 'revoked' ? 'This link was revoked' : 'This link does not open anything'}
      </h1>
      <p className="m-0 text-13-5 leading-[1.55] text-ink2">
        {reason === 'revoked'
          ? 'Whoever shared it has since replaced or withdrawn it. Ask them for the current link.'
          : 'It may have been copied incompletely, or it was never issued. Ask whoever sent it for a fresh one.'}
      </p>
      <Link href="/app" className="mt-[6px] self-start text-13 text-accent">
        Go to your projects
      </Link>
    </div>
  </main>
)

export default Page
