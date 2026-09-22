import Link from 'next/link'

/**
 * The credits card at the foot of the home sidebar.
 *
 * Every number on it is the ledger's. `readCreditsFor` (`@folio/db`) sums the
 * append-only `credit_ledger` across the projects this person belongs to, in
 * one statement, exactly as `readBalance` sums one project's - AGENTS.md, Jobs,
 * credits and cost: "the balance is **computed, never stored**". A person with
 * no projects has an empty sum, which is `0` because summing nothing is zero
 * and not because a zero is written here.
 *
 * ## What the handoff draws that this does not
 *
 * `95/500` over a bar, "Free plan · resets 1 Oct", and an `Upgrade` button.
 * There is no plan table, no allowance and nothing wired to Dodo, so there is
 * no `500` to divide by and no reset date to name - printing either would be
 * the placeholder the design system bans. The bar is `available / settled`,
 * the same fill the workspace sidebar's credits widget draws, which is a real
 * proportion: how much of what has ever been granted is still unspent.
 *
 * `Upgrade` is drawn and disabled, with the reason in its `title`. AGENTS.md,
 * When to ask first: "Touch credits, the ledger, refunds, or anything Dodo."
 * A button that starts a purchase is exactly that, and it is not this pass's
 * to build.
 */
export const CreditsCard = ({
  available,
  share,
}: {
  readonly available: number
  /** `available / settled`, clamped. The bar's fill. */
  readonly share: number
}) => (
  <div
    data-credits-card
    className="mx-[2px] mb-[10px] flex flex-col gap-[9px] rounded-[13px] border border-line2 bg-s1 p-[13px]"
  >
    <div className="flex items-baseline gap-[8px]">
      <span className="flex-1 text-11-5 text-ink2">Credits</span>
      <span className="tabular font-mono text-15 tracking-title">{available.toLocaleString('en-US')}</span>
    </div>
    <div className="h-[3px] overflow-hidden rounded-[2px] bg-s3">
      <div className="h-full bg-accent" style={{ width: `${String(Math.round(share * 100))}%` }} />
    </div>
    <span className="text-11 leading-[1.5] text-ink3">
      Summed across your projects. Writing never costs credits; generation does.{' '}
      <Link href="/app/settings" className="text-ink2 underline-offset-2 hover:text-ink">
        See where
      </Link>
      .
    </span>
    <button
      type="button"
      disabled
      title="Plans and payments are not wired up yet. There is no plan on record to upgrade from."
      className="folio-solid-button h-[28px] rounded-[8px] text-12 font-medium"
    >
      Upgrade
    </button>
  </div>
)
