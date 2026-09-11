import { count, eq } from 'drizzle-orm'

import { characterDerivations, characterRelationships, locationDerivations } from '../schema'
import { dbOf, scoped } from '../scope'
import type { ProjectScope } from '../scope'

/**
 * Three project-wide counts the Outline's Info panel prints under
 * "Statistics" - "Counts come from the script and beats, not from this
 * page", as the bundle's own line says.
 *
 *   `characters`  `character_derivations` in state `present`
 *   `locations`   `location_derivations` in state `present`
 *   `relations`   `character_relationships` rows
 *
 * Three count queries rather than `readDerivationInput`, which reads nine
 * tables whole so `derive` can reconcile against them. A page that prints
 * three numbers does not need the rows behind them.
 */
export type EntityCounts = {
  readonly characters: number
  readonly locations: number
  readonly relations: number
}

export const readEntityCounts = async (scope: ProjectScope): Promise<EntityCounts> => {
  const db = dbOf(scope)
  const [characters, locations, relations] = await Promise.all([
    db
      .select({ n: count() })
      .from(characterDerivations)
      .where(scoped(scope, characterDerivations, eq(characterDerivations.presence, 'present'))),
    db
      .select({ n: count() })
      .from(locationDerivations)
      .where(scoped(scope, locationDerivations, eq(locationDerivations.presence, 'present'))),
    db.select({ n: count() }).from(characterRelationships).where(scoped(scope, characterRelationships)),
  ])
  return {
    characters: characters[0]?.n ?? 0,
    locations: locations[0]?.n ?? 0,
    relations: relations[0]?.n ?? 0,
  }
}
