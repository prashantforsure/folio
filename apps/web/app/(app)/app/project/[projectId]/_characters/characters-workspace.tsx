'use client'

import type { CastRow, CharacterProfile, EpisodeSlug, PairItem, ProjectId, Relationship, ResolveItem } from '@folio/contracts'
import type { CharacterId } from '@folio/script'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import { uploadPortrait } from '../../../../../../lib/characters/actions'
import { figuresOf, routeIdOf } from '../../../../../../lib/characters/cast'
import { setQueueIntent, useNewCharacterOpen, useQueueIntent } from '../../../../../../lib/characters/compose'
import { noDescriptionOf, unrelatedOf } from '../../../../../../lib/characters/facts'
import { publishCharacterFacts } from '../../../../../../lib/characters/facts-cell'
import { useModalToast } from '../../../../../../lib/characters/modal-toast'
import { pairKey } from '../../../../../../lib/characters/relationships'
import type { Derivable, SceneIndexRef } from '../../../../../../lib/characters/server'
import { offerUndo } from '../../../../../../lib/characters/undo'
import type { ProjectRoutePath, WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import { StatusBar } from '../_chrome/status-bar'
import { useRun } from '../_chrome/use-run'
import { useToast } from '../_chrome/use-toast'
import { CharacterCanvas } from './canvas/character-canvas'
import { CharacterDrawer } from './character-drawer'
import { CharactersToolbar } from './characters-toolbar'
import { EmptyCharacters } from './empty-characters'
import { ListView } from './list/list-view'
import { NewCharacterDrawer } from './new-character-drawer'
import { QueuePanel } from './queue-panel'
import { RelationshipModal } from './relationship-modal'
import { useCharactersView } from './view-state'

/**
 * The Characters route's body inside the main-surface card (the fourth
 * pass, 2026-09-20; the Relationships graph removed again 2026-09-21 - the
 * canvas's threads already carry a relationship between two cards): the
 * toolbar row (`characters-toolbar.tsx`), one of the two views - the
 * Canvas, the List - or the empty card, the 28px status bar, and **one
 * thing in the drawer slot**: the `New character` drawer, the `Needs a
 * decision` panel, or the record the URL names. The relationship modal
 * floats over all of it.
 *
 * ## `:characterId` is the URL; everything else is state
 *
 * The selected record is the path, and the drawer is what the path renders
 * over the view. The two views are state the layout holds
 * (`view-state.tsx`, ruled 2026-09-16 - the URL stays `/characters`), so
 * the pill's tabs are buttons; `data-sub-view` keeps its name for the
 * smoke test that reads it. Whether the queue panel is open (the pill, or
 * `setQueueIntent` from the Scenes modal), which pair the modal is
 * editing, a save in flight, the toast, the rename's undo offer:
 * component state, none of it worth a link.
 *
 * ## Every write returns a result, and the page re-reads
 *
 * The actions revalidate the workspace path, so the router refreshes the
 * server-rendered read after each write; the canvas holds a dropped
 * position optimistically until the read agrees. Nothing here computes a
 * count the loader or `lib/characters/cast.ts` does not.
 *
 * ## What the assistant panel is told
 *
 * The workspace publishes `lib/characters/facts.ts` after every render of
 * its figures - the open record, the records with no relationship, the
 * records with no description, the scene index - so the panel's report
 * chips can answer without a model and its `Scene N` chips can link.
 * Cleared on unmount, as is the rename's undo offer.
 */
export type { Run } from '../_chrome/use-run'

export type EpisodeRow = { readonly slug: EpisodeSlug; readonly ordinal: number; readonly title: string }

/** Which pair the relationship modal is open on, `a` first; `existing` when it edits a row. */
type RelationshipDialog = { readonly a: CharacterId; readonly b: CharacterId }

export const CharactersWorkspace = ({
  projectId,
  projectTitle,
  shape,
  baseHref,
  cast,
  index,
  episodes,
  resolve,
  pairs,
  walkOns,
  relationships,
  derivable,
  storage,
  profile,
}: {
  readonly projectId: ProjectId
  readonly projectTitle: string
  readonly shape: WorkspaceShape
  readonly baseHref: ProjectRoutePath
  readonly cast: readonly CastRow[]
  readonly index: readonly SceneIndexRef[]
  readonly episodes: readonly EpisodeRow[]
  readonly resolve: readonly ResolveItem[]
  readonly pairs: readonly PairItem[]
  readonly walkOns: readonly ResolveItem[]
  readonly relationships: readonly Relationship[]
  readonly derivable: Derivable | null
  readonly storage: boolean
  /** The record the drawer shows, when the path names one. */
  readonly profile: CharacterProfile | null
}) => {
  const router = useRouter()
  const { view } = useCharactersView()
  const { save, run } = useRun('saved')
  const { toast, show } = useToast()
  const modalToast = useModalToast()
  const newOpen = useNewCharacterOpen()
  const queueIntent = useQueueIntent()
  const [queueOpen, setQueueOpen] = useState(false)
  const [dialog, setDialog] = useState<RelationshipDialog | null>(null)

  const episodeOrdinals = useMemo(() => episodes.map((episode) => episode.ordinal), [episodes])
  const figures = useMemo(() => figuresOf(cast, index, episodeOrdinals, relationships), [cast, episodeOrdinals, index, relationships])
  const selected = profile === null ? null : (figures.find((figure) => figure.id === profile.id) ?? null)
  const decisions = resolve.length + pairs.length

  // The Scenes modal's link: open the panel on the part it names.
  useEffect(() => {
    if (queueIntent !== null) setQueueOpen(true)
  }, [queueIntent])
  // A panel with nothing left to decide closes itself; the pill is gone too.
  useEffect(() => {
    if (decisions === 0 && walkOns.length === 0) setQueueOpen(false)
  }, [decisions, walkOns.length])

  const empty = figures.length === 0 && decisions === 0
  const episodeCount = episodes.length
  const left = empty
    ? `${projectTitle} · ${String(episodeCount)} ${episodeCount === 1 ? 'episode' : 'episodes'} · no characters`
    : `${String(figures.length)} ${figures.length === 1 ? 'character' : 'characters'} · ${String(relationships.length)} ${relationships.length === 1 ? 'relationship' : 'relationships'}${selected === null ? '' : ` · ${selected.name}`}`

  useEffect(() => {
    publishCharacterFacts({
      projectId,
      shape,
      episodes,
      index,
      open: selected === null ? null : { id: selected.id, name: selected.name },
      noDescription: noDescriptionOf(figures),
      unrelated: unrelatedOf(figures, relationships),
    })
  }, [episodes, figures, index, projectId, relationships, selected, shape])
  useEffect(
    () => () => {
      publishCharacterFacts(null)
      offerUndo(null)
    },
    [],
  )

  const open = (id: CharacterId): void => {
    router.push(characterHref(projectId, id))
  }
  const editPair = (a: CharacterId, b: CharacterId): void => {
    setDialog({ a, b })
  }
  const upload = (id: CharacterId, file: File): void => {
    run(async () => {
      const form = new FormData()
      form.set('portrait', file)
      const result = await uploadPortrait(projectId, id, form)
      return result.status === 'saved' ? null : result.message
    })
  }

  const dialogSides =
    dialog === null
      ? null
      : (() => {
          const a = figures.find((figure) => figure.id === dialog.a)
          const b = figures.find((figure) => figure.id === dialog.b)
          if (a === undefined || b === undefined) return null
          const key = pairKey(a.id, b.id)
          return { a: { id: a.id, name: a.name }, b: { id: b.id, name: b.name }, existing: relationships.find((row) => pairKey(row.aId, row.bId) === key) ?? null }
        })()

  // One thing in the slot: the new drawer wins (it was asked for last), then the panel, then the record.
  const slot = newOpen ? 'new' : queueOpen ? 'queue' : profile !== null && selected !== null ? 'edit' : null

  return (
    <main data-route="characters" data-sub-view={view} data-characters-state={empty ? 'empty' : view} data-drawer-open={slot ?? undefined} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {empty ? null : (
        <CharactersToolbar
          count={figures.length}
          decisions={decisions}
          queueOpen={queueOpen}
          onQueue={() => {
            setQueueOpen((current) => !current)
          }}
        />
      )}

      {empty ? (
        <EmptyCharacters projectId={projectId} derivable={derivable ?? { count: 0, top: [] }} run={run} />
      ) : view === 'list' ? (
        <ListView projectId={projectId} figures={figures} episodeOrdinals={episodeOrdinals} selectedId={selected?.id ?? null} />
      ) : (
        <CharacterCanvas
          projectId={projectId}
          figures={figures}
          relationships={relationships}
          selected={selected?.id ?? null}
          storage={storage}
          run={run}
          onOpen={open}
          onConnect={editPair}
          onEditRelationship={(edge) => {
            editPair(edge.a, edge.b)
          }}
          onUpload={upload}
        />
      )}

      <StatusBar left={left} save={save} routeId={routeIdOf(selected)} toast={toast ?? modalToast} />

      {slot === 'new' ? (
        <NewCharacterDrawer projectId={projectId} usedHues={cast.map((row) => row.hue)} run={run} />
      ) : slot === 'queue' ? (
        <QueuePanel
          projectId={projectId}
          shape={shape}
          figures={figures}
          resolve={resolve}
          pairs={pairs}
          walkOns={walkOns}
          run={run}
          toast={show}
          onClose={() => {
            setQueueOpen(false)
            setQueueIntent(null)
          }}
        />
      ) : slot === 'edit' && profile !== null && selected !== null ? (
        <CharacterDrawer
          key={profile.id}
          projectId={projectId}
          figure={selected}
          profile={profile}
          cast={figures}
          storage={storage}
          baseHref={baseHref}
          run={run}
          toast={show}
          onAddRelationship={(other) => {
            editPair(profile.id, other)
          }}
          onEditRelationship={(row) => {
            editPair(profile.id, row.aId === profile.id ? row.bId : row.aId)
          }}
        />
      ) : null}

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
    </main>
  )
}
