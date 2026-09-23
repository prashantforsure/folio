import type { NewCharacter } from '@folio/contracts'
import { bindCue, createCharacterRecord } from '@folio/db'
import type { ProjectScope } from '@folio/db'
import type { CharacterId } from '@folio/script'
import { cueSpelling } from '@folio/script'

import { requestRederive } from '../script/derive-batch'

/**
 * Making a character record - the body `createCharacter` (the drawer's
 * action) and the agent's `create_character` share, so there is one path.
 *
 * The one thing the two differ in is `origin`: `hand` for a person, `agent`
 * for the copilot (ADR 0003 **D11**, "agent-created characters carry
 * `origin = 'agent'`"; `CHARACTER_ORIGINS` is write-once). Not a server
 * action - an origin a browser could claim for itself would be no record of
 * anything - so the gate is the caller's: the action's `openProject`, or the
 * proposal apply's role check.
 *
 * A repeat with the same key returns the record the first call made, and
 * everything after the insert is idempotent in its own right: binding a
 * spelling the record already holds writes nothing, and a derivation pass is
 * a pass. The name's spelling binds to the new record, so a cue typed later
 * resolves to it rather than proposing; a spelling somebody else already
 * holds is left with them.
 */
export const createCharacterIn = async (scope: ProjectScope, input: NewCharacter, key: string | null, origin: 'hand' | 'agent'): Promise<CharacterId> => {
  const { name, ...profile } = input
  const id = await createCharacterRecord(scope, name, profile, origin, key)
  await bindCue(scope, id, cueSpelling(name))
  await requestRederive(scope)
  return id
}
