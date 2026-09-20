'use client'

import type { CharacterProfile, ProjectId, Relationship } from '@folio/contracts'
import type { CharacterId } from '@folio/script'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import type { CastFigure } from '../../../../../../lib/characters/cast'
import { publishModalToast } from '../../../../../../lib/characters/modal-toast'
import { pairKey } from '../../../../../../lib/characters/relationships'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import type { StatusToast } from '../_chrome/status-bar'
import { useRun } from '../_chrome/use-run'
import { CharacterDrawer } from './character-drawer'
import { RelationshipModal } from './relationship-modal'

/** Which pair the relationship modal is open on, `a` first - always this record's side. */
type RelationshipDialog = { readonly a: CharacterId; readonly b: CharacterId }

/**
 * The intercepted `/characters/:characterId` - the same `CharacterDrawer`
 * form the full page draws (`character-drawer.tsx`, unchanged), mounted as
 * a floating sheet (`overlay`) instead of docked in `#characters-drawer`,
 * so the canvas already on screen at `/characters` is never remounted to
 * show it (`characters/@modal/(.)[characterId]/page.tsx`).
 *
 * Closing goes through `router.back()` - the navigation that opened this
 * modal pushed one entry, so leaving it un-pushes that entry rather than
 * pushing a further one; a modal reached with no history of its own (a
 * pasted `/characters/:id` link that then soft-navigated once) falls back
 * to `baseHref`. A save, a delete and Escape all take the same door
 * (`CharacterDrawer`'s `onDone`).
 *
 * `＋ Add relationship` and a relationship row still open the same
 * `RelationshipModal` the workspace does - it already floats over
 * everything on its own scrim, canvas or no canvas - so this component
 * only needs the one pair of dialog state the workspace also carries.
 * A toast a save raises (the rename's `Undo`, a merge, `Create instead`)
 * is published for the persisted workspace's status bar to pick up once
 * this modal is gone (`lib/characters/modal-toast.ts`) - this tree has no
 * status bar of its own to show it in.
 */
export const CharacterEditModal = ({
  projectId,
  figure,
  profile,
  cast,
  storage,
  baseHref,
}: {
  readonly projectId: ProjectId
  readonly figure: CastFigure
  readonly profile: CharacterProfile
  readonly cast: readonly CastFigure[]
  readonly storage: boolean
  readonly baseHref: ProjectRoutePath
}) => {
  const router = useRouter()
  const { run } = useRun('saved')
  const [dialog, setDialog] = useState<RelationshipDialog | null>(null)

  const done = (): void => {
    if (window.history.length > 1) router.back()
    else router.push(baseHref)
  }

  const toast = (message: string, action?: StatusToast['action']): void => {
    publishModalToast(action === undefined ? { message } : { message, action })
  }

  const dialogSides =
    dialog === null
      ? null
      : (() => {
          const a = cast.find((entry) => entry.id === dialog.a)
          const b = cast.find((entry) => entry.id === dialog.b)
          if (a === undefined || b === undefined) return null
          const key = pairKey(a.id, b.id)
          return { a: { id: a.id, name: a.name }, b: { id: b.id, name: b.name }, existing: profile.relationships.find((row) => pairKey(row.aId, row.bId) === key) ?? null }
        })()

  return (
    <>
      <CharacterDrawer
        key={profile.id}
        overlay
        projectId={projectId}
        figure={figure}
        profile={profile}
        cast={cast}
        storage={storage}
        baseHref={baseHref}
        onDone={done}
        run={run}
        toast={toast}
        onAddRelationship={(other) => {
          setDialog({ a: profile.id, b: other })
        }}
        onEditRelationship={(row: Relationship) => {
          setDialog({ a: profile.id, b: row.aId === profile.id ? row.bId : row.aId })
        }}
      />
      {dialogSides === null ? null : (
        <RelationshipModal
          key={pairKey(dialogSides.a.id, dialogSides.b.id)}
          projectId={projectId}
          a={dialogSides.a}
          b={dialogSides.b}
          existing={dialogSides.existing}
          run={run}
          onClose={() => {
            setDialog(null)
          }}
        />
      )}
    </>
  )
}
