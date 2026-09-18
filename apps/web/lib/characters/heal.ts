import type { CharacterId, DerivedEntities } from '@folio/script'
import { canonicalKey, cueSpelling } from '@folio/script'

/**
 * Hand a record with no bound spelling its name's - before a pass runs.
 *
 * A character record is meant to carry its name's spelling as its first
 * alias from the moment it exists: a pass's mint writes one, `createCharacter`
 * binds one, and since 2026-09-17 so does `createMentionTarget`. Records made
 * through the `@` combobox before that day have none, and `resolveSubject`
 * matches exact keys against bound cues only - so their own cue reached the
 * queue *proposing* the record the writer had already made, and a rushed
 * `New character` minted a duplicate beside it.
 *
 * This is the backfill, and it is a read-side heal rather than a script or a
 * data migration: there is no script runner in the repo, a cross-project
 * listing is an unscoped read the contract forbids, and a migration that
 * writes rows is a decision. Instead `rederiveProject` applies it to the
 * derivation input it has already read, so the pass resolves `HALE` exactly
 * on its first run after deploy, and hands `healed` to `persistMintedRecords`
 * so the binding lands in the statement that pass already issues. Once every
 * record has a spelling, `healed` is empty and nothing more is written.
 *
 * A record whose name key another record already claims - by name or by a
 * bound spelling - is left alone: that is the ambiguous case the queue
 * exists for, and binding by resemblance is what AGENTS.md forbids.
 */
export type Healed = { readonly id: CharacterId; readonly cue: string }

export const healNameCues = (
  entities: DerivedEntities,
): { readonly entities: DerivedEntities; readonly healed: readonly Healed[] } => {
  // How many records claim each key, by name or by a bound spelling. A
  // record with no spelling claims its own name key once; it heals only when
  // nobody else does - a name two records share heals neither.
  const owners = new Map<string, number>()
  for (const record of entities.characters) {
    const name = canonicalKey(record.authored.name)
    if (name !== '') owners.set(name, (owners.get(name) ?? 0) + 1)
    for (const cue of record.authored.boundCues) {
      const key = canonicalKey(cue)
      if (key !== '' && key !== name) owners.set(key, (owners.get(key) ?? 0) + 1)
    }
  }

  const healed: Healed[] = []
  const characters = entities.characters.map((record) => {
    if (record.authored.boundCues.length > 0) return record
    const cue = cueSpelling(record.authored.name)
    const key = canonicalKey(cue)
    if (key === '' || (owners.get(key) ?? 0) !== 1) return record
    healed.push({ id: record.id, cue })
    return { ...record, authored: { ...record.authored, boundCues: [cue] } }
  })
  return healed.length === 0 ? { entities, healed } : { entities: { ...entities, characters }, healed }
}
