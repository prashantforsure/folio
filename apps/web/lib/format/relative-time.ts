/**
 * "31 minutes ago", for the `Edited …` line on a project card.
 *
 * Pure: it takes `now` rather than reading the clock, so a Server Component can
 * pass one `Date` to every card in a list and a test can pin it. It is not in
 * `packages/script`, which has no clock at all, and not in `packages/ui`, which
 * is presentational - "how old is this" is glue, and `apps/web/lib` is where
 * AGENTS.md puts glue.
 *
 * The steps are the ones the design bundles write out: minutes, hours,
 * `yesterday`, days, then a date. Past a month the exact day matters more than
 * a count, so it becomes a date rather than "6 weeks ago".
 *
 * A stamp in the future - clock skew between the database and this process -
 * reads as `just now` rather than as a negative number of minutes.
 */
export const relativeTime = (iso: string, now: Date): string => {
  const then = new Date(iso)
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000)

  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${String(minutes)} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${String(hours)} hours ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 31) return `${String(days)} days ago`

  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
