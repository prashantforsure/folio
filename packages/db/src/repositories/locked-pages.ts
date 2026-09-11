import type { EpisodeId } from '@folio/contracts'
import type { LockedPage as EngineLockedPage } from '@folio/script'
import { and, asc, desc, eq } from 'drizzle-orm'

import { lockedPages, revisions } from '../schema'
import { dbOf, scoped } from '../scope'
import type { ProjectScope } from '../scope'

/**
 * The pages the paginator must not renumber, in one query.
 *
 * AGENTS.md, Pagination and the sheet: "Locked pages must not renumber."
 * Every measurement therefore starts by asking which pages are locked - the
 * ones locked by the episode's *latest* locked revision - and the Script
 * route asks on every save. Listing the revisions and then the pages was two
 * round trips in sequence, and on the request path each one is two
 * (`client.ts`); this is the same answer as a join with the latest locked
 * revision picked in a subquery, in the shape `paginate` takes.
 *
 * Kept beside `history.ts` rather than in it: that file owns cutting and
 * locking, this is a read the sheet makes.
 */
export const readLatestLockedPages = async (
  scope: ProjectScope,
  episodeId: EpisodeId,
): Promise<readonly EngineLockedPage[]> => {
  const db = dbOf(scope)
  const latest = db
    .select({ id: revisions.id })
    .from(revisions)
    .where(scoped(scope, revisions, eq(revisions.episodeId, episodeId), eq(revisions.locked, true)))
    .orderBy(desc(revisions.ordinal))
    .limit(1)
  const rows = await db
    .select({
      revisionId: lockedPages.revisionId,
      label: lockedPages.label,
      anchorNodeId: lockedPages.anchorNodeId,
      colour: lockedPages.colour,
    })
    .from(lockedPages)
    .where(and(scoped(scope, lockedPages), eq(lockedPages.revisionId, latest)))
    .orderBy(asc(lockedPages.label))
  return rows.map((row) => ({
    label: row.label,
    anchor: (row.anchorNodeId ?? '') as EngineLockedPage['anchor'],
    revision: row.colour,
  }))
}

