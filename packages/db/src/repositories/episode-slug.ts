import type { EpisodeSlug } from '@folio/contracts'
import { formatEpisodeSlug, parseEpisodeSegment } from '@folio/contracts'

/**
 * The gate every episode insert passes through.
 *
 * AGENTS.md, Routing: an episode id shares a path position with the
 * project-scoped names, so a slug that *could* be `characters` is a slug that
 * could shadow a route. Two things stop that here, and this file is the first:
 *
 *   1. `assertCreatableEpisodeSlug` runs `parseEpisodeSegment` - the same
 *      function the router runs on a URL - and throws on anything it would
 *      refuse. Both insert paths (`appendEpisode` in `projects.ts`,
 *      `createProjectFor` in `users.ts`) call it before writing.
 *   2. `episodes_slug_shape` in `schema/tenancy.ts` is a check constraint on
 *      the column, so a row written by hand or by a future path that forgot
 *      this file is refused by Postgres itself.
 *
 * Today every slug is minted from an ordinal by `formatEpisodeSlug`, so the
 * assertion cannot fire on a well-formed call - which is exactly why it is
 * here. The day a path accepts a slug from a caller, this is the check that
 * is already in its way, and the test in `apps/web/tests/episode-segment.test.ts`
 * shows what it does with `characters`.
 *
 * It throws rather than returning a result because a bad slug at creation is
 * a **bug**, not data: nothing upstream can have asked for it legitimately.
 */
export const assertCreatableEpisodeSlug = (slug: string): EpisodeSlug => {
  const checked = parseEpisodeSegment(slug)
  if (checked.ok) return checked.slug
  const why =
    checked.reason === 'reserved'
      ? `"${checked.segment}" is a project-scoped route name`
      : `"${checked.segment}" is not of the ep_NNN shape`
  throw new Error(
    `Folio: refused to create an episode with slug "${slug}": ${why}. An episode id shares a path position with the project routes (AGENTS.md, Routing).`,
  )
}

/** `1` becomes `ep_001`, checked. The only way an insert gets a slug. */
export const mintEpisodeSlug = (ordinal: number): EpisodeSlug =>
  assertCreatableEpisodeSlug(formatEpisodeSlug(ordinal))
