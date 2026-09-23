'use client'

import type { FieldId, ProductionScene, Reel, ReelShot, ReelShotId, SettingsInput, ViewPreferences, ViewPreferencesPatch } from '@folio/contracts'
import { useRouter } from 'next/navigation'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import * as authoring from '../../../../../../lib/production/actions'
import { firstSelection, shotStatusOf } from '../../../../../../lib/production/derive'
import { isShown } from '../../../../../../lib/production/fields'
import * as generate from '../../../../../../lib/production/generate'
import type { MenuField } from '../../../../../../lib/production/menus'
import type { ProductionLoad } from '../../../../../../lib/production/server'
import { useEphemeral } from '../../../../../../lib/state/ephemeral'
import { useSession } from '../../../../../../lib/state/session'
import { BulkBar } from './bulk-bar'
import { ColumnsView } from './columns-view'
import { ContextMenu } from './context-menu'
import { Polling } from './polling'
import type { MenuTarget, ProductionHandlers, ProductionValue, Selection } from './production-context'
import { ProductionProvider } from './production-context'
import { ReelStrip } from './reel-strip'
import { SceneBoard } from './scene-board'
import { SceneTabs } from './scene-tabs'
import { SettingsModal } from './settings-modal'
import { ShotDrawer } from './shot-drawer'
import { artStyleNameCell, resetProductionState, setupOpenCell } from './view-state'

/**
 * The Production body - `docs/production/production.md` §2, the panel
 * under the header: scene tabs, the reel strip, the board (Cards or
 * Columns), and the four overlays. Client state lives here: the selected
 * scene and reel (§1: "client-side, no reload"), the picks, the open
 * shot, the menu, the drag and the resize. The rows come from the page's
 * server read and are patched in place from what an action returns;
 * `router.refresh()` after a write that changes more than it returns, and
 * every few seconds while a generation is live (`polling.tsx`).
 *
 * The settings modal opens on mount for a fresh episode (no saved
 * settings - the spec's `setupOpen: true`), and from the header chip
 * (`view-state.tsx`).
 */

export type ProductionWorkspaceProps = {
  readonly projectId: string
  readonly episode: string
  readonly load: ProductionLoad
}

/** Replace one reel wherever it sits. */
const withReel = (scenes: readonly ProductionScene[], reel: Reel): readonly ProductionScene[] =>
  scenes.map((scene) => (scene.reels.some((candidate) => candidate.id === reel.id) ? { ...scene, reels: scene.reels.map((candidate) => (candidate.id === reel.id ? reel : candidate)) } : scene))

const withShot = (scenes: readonly ProductionScene[], shot: ReelShot): readonly ProductionScene[] =>
  scenes.map((scene) => ({
    ...scene,
    reels: scene.reels.map((reel) => (reel.id === shot.reelId ? { ...reel, shots: reel.shots.map((candidate) => (candidate.id === shot.id ? shot : candidate)) } : reel)),
  }))

const patchShotIn = (scenes: readonly ProductionScene[], shotId: ReelShotId, patch: Partial<ReelShot>): readonly ProductionScene[] =>
  scenes.map((scene) => ({
    ...scene,
    reels: scene.reels.map((reel) => ({ ...reel, shots: reel.shots.map((shot) => (shot.id === shotId ? { ...shot, ...patch } : shot)) })),
  }))

const findShot = (scenes: readonly ProductionScene[], shotId: ReelShotId): { readonly scene: ProductionScene; readonly reel: Reel; readonly shot: ReelShot } | null => {
  for (const scene of scenes) for (const reel of scene.reels) for (const shot of reel.shots) if (shot.id === shotId) return { scene, reel, shot }
  return null
}

export const ProductionWorkspace = ({ projectId, episode, load }: ProductionWorkspaceProps) => {
  const router = useRouter()
  const session = useSession()
  const { setAssistantPrompt } = useEphemeral()
  const [scenes, setScenes] = useState<readonly ProductionScene[]>(load.scenes)
  const [prefs, setPrefsState] = useState<ViewPreferences>(load.preferences)
  const [selection, setSelection] = useState<Selection | null>(() => firstSelection(load.scenes))
  const [picked, setPicked] = useState<ReadonlySet<ReelShotId>>(new Set())
  const [detail, setDetail] = useState<ReelShotId | null>(null)
  const [menu, setMenu] = useState<ProductionValue['menu']>(null)
  const [dragging, setDragging] = useState<ReelShotId | null>(null)
  const [resizing, setResizing] = useState<ReelShotId | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<number | null>(null)
  const setupOpen = setupOpenCell.use()

  // The server's rows win when they arrive (a refresh, a poll); local patches are for the round trip.
  useEffect(() => {
    setScenes(load.scenes)
  }, [load.scenes])
  useEffect(() => {
    setPrefsState(load.preferences)
  }, [load.preferences])

  // The header chip's name, and the first-run modal.
  useEffect(() => {
    const current = load.settings ?? load.defaults
    artStyleNameCell.set(load.artStyles.find((style) => style.id === current.artStyleId)?.name ?? null)
  }, [load.settings, load.defaults, load.artStyles])
  useEffect(() => {
    if (load.settings === null) setupOpenCell.set(true)
  }, [load.settings])
  useEffect(() => resetProductionState, [])

  // A selection that the rows no longer hold falls back to the first.
  useEffect(() => {
    if (selection === null) {
      setSelection(firstSelection(scenes))
      return
    }
    const scene = scenes.find((candidate) => candidate.sceneNodeId === selection.sceneNodeId)
    if (scene === undefined) {
      setSelection(firstSelection(scenes))
      return
    }
    if (selection.reelId !== null && !scene.reels.some((reel) => reel.id === selection.reelId)) {
      setSelection({ sceneNodeId: scene.sceneNodeId, reelId: scene.reels[0]?.id ?? null })
    } else if (selection.reelId === null && scene.reels.length > 0) {
      setSelection({ sceneNodeId: scene.sceneNodeId, reelId: scene.reels[0]?.id ?? null })
    }
  }, [scenes, selection])

  // Escape closes menu, drawer, options and filter popovers (§8).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setMenu(null)
      setDetail(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const tell = useCallback((message: string) => {
    setNotice(message)
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => {
      setNotice(null)
    }, 8000)
  }, [])

  const failed = useCallback(
    (result: { readonly status: string; readonly message?: string }): boolean => {
      // `rate-limited` is here rather than in `spent` because it is a refusal
      // like the others - and because a status this helper does not name is a
      // click that does nothing at all, which is worse than any message.
      if (
        result.status === 'refused' ||
        result.status === 'error' ||
        result.status === 'busy' ||
        result.status === 'rate-limited'
      ) {
        tell(result.message ?? 'That did not save.')
        return true
      }
      return false
    },
    [tell],
  )

  const spent = useCallback(
    (result: { readonly status: string; readonly message?: string; readonly available?: number; readonly cost?: number }): boolean => {
      if (result.status === 'insufficient') {
        tell(`Not enough credits: ${String(result.available ?? 0)} available, ${String(result.cost ?? 0)} needed.`)
        return true
      }
      if (result.status === 'disconnected') {
        tell(result.message ?? 'The model is not connected.')
        return true
      }
      return failed(result)
    },
    [failed, tell],
  )

  const setPrefs = useCallback(
    (patch: ViewPreferencesPatch) => {
      setPrefsState((current) => ({
        view: patch.view ?? current.view,
        fieldVisibility: { ...current.fieldVisibility, ...(patch.fieldVisibility ?? {}) } as ViewPreferences['fieldVisibility'],
        fieldOrder: patch.fieldOrder ?? current.fieldOrder,
        statusFilter: patch.statusFilter ?? current.statusFilter,
        unassignedOnly: patch.unassignedOnly ?? current.unassignedOnly,
        sort: patch.sort ?? current.sort,
      }))
      void authoring.saveViewPreferences(projectId, episode, patch).then((result) => {
        failed(result)
      })
    },
    [episode, failed, projectId],
  )

  const patchShot = useCallback(
    (shotId: ReelShotId, patch: Parameters<typeof authoring.patchShot>[3] & object, optimistic: Partial<ReelShot>) => {
      setScenes((current) => patchShotIn(current, shotId, optimistic))
      void authoring.patchShot(projectId, episode, shotId, patch).then((result) => {
        if (failed(result)) return router.refresh()
        if (result.status === 'saved') setScenes((current) => withShot(current, result.shot))
        return undefined
      })
    },
    [episode, failed, projectId, router],
  )

  const bulk = useCallback(
    (patch: { readonly status?: ReelShot['status']; readonly assigneeId?: ReelShot['assigneeId']; readonly priority?: ReelShot['priority'] }) => {
      const ids = [...picked]
      if (ids.length === 0) return
      setScenes((current) => ids.reduce((acc, id) => patchShotIn(acc, id, patch), current))
      void authoring.bulkPatchShots(projectId, episode, { ids, patch }).then((result) => {
        failed(result)
        router.refresh()
      })
    },
    [episode, failed, picked, projectId, router],
  )

  const act = useMemo<ProductionHandlers>(
    () => ({
      selectScene: (sceneNodeId) => {
        const scene = scenes.find((candidate) => candidate.sceneNodeId === sceneNodeId)
        setSelection({ sceneNodeId, reelId: scene?.reels[0]?.id ?? null })
        setDetail(null)
      },
      selectReel: (sceneNodeId, reelId) => {
        setSelection({ sceneNodeId, reelId })
        setDetail(null)
      },
      openDetail: (shotId) => {
        setDetail(shotId)
      },
      closeDetail: () => {
        setDetail(null)
      },
      togglePick: (shotId) => {
        setPicked((current) => {
          const next = new Set(current)
          if (next.has(shotId)) next.delete(shotId)
          else next.add(shotId)
          return next
        })
      },
      clearPicked: () => {
        setPicked(new Set())
      },
      openMenu: (field: MenuField, target: MenuTarget, event: ReactMouseEvent) => {
        event.stopPropagation()
        event.preventDefault()
        setMenu({ field, target, x: event.clientX, y: event.clientY })
      },
      closeMenu: () => {
        setMenu(null)
      },
      pickValue: (field, target, value) => {
        setMenu(null)
        if (target.kind === 'bulk') {
          if (field === 'status') bulk({ status: value as ReelShot['status'] })
          else if (field === 'assignee') bulk({ assigneeId: value as ReelShot['assigneeId'] })
          else if (field === 'priority') bulk({ priority: (value ?? 'none') as ReelShot['priority'] })
          return
        }
        if (target.kind === 'scene') {
          if (field === 'notes') {
            void authoring.saveNote(projectId, episode, { targetType: 'scene', targetId: target.id, body: value ?? '' }).then((result) => {
              failed(result)
              router.refresh()
            })
            return
          }
          const key = field === 'loc' ? 'locationId' : field === 'intext' ? 'intExt' : field === 'date' ? 'shootDate' : field === 'lens' ? 'lens' : field === 'prop' ? 'propId' : 'priority'
          const patch = { sceneNodeId: target.id, [key]: value } as Parameters<typeof authoring.setSceneSetup>[2]
          setScenes((current) => current.map((scene) => (scene.sceneNodeId === target.id ? { ...scene, setup: { ...scene.setup, [key]: value } } : scene)))
          void authoring.setSceneSetup(projectId, episode, patch).then((result) => {
            failed(result)
            router.refresh()
          })
          return
        }
        const shotId = target.id
        switch (field) {
          case 'status':
            return patchShot(shotId, { status: value as ReelShot['status'] }, { status: value as ReelShot['status'] })
          case 'type':
            return patchShot(shotId, { shotType: value as ReelShot['shotType'] }, { shotType: value as ReelShot['shotType'] })
          case 'motion':
            return patchShot(shotId, { cameraMotion: value as ReelShot['cameraMotion'] }, { cameraMotion: value as ReelShot['cameraMotion'] })
          case 'duration': {
            const seconds = value === null ? null : Number(value)
            return patchShot(shotId, { durationS: seconds }, { durationS: seconds })
          }
          case 'prop':
            return patchShot(shotId, { propId: value as ReelShot['propId'] }, { propId: value as ReelShot['propId'] })
          case 'lens':
            return patchShot(shotId, { lens: value ?? '' }, { lens: value ?? '' })
          case 'date':
            return patchShot(shotId, { shootDate: value }, { shootDate: value })
          case 'loc':
            return patchShot(shotId, { locationId: value as ReelShot['locationId'] }, { locationId: value as ReelShot['locationId'] })
          case 'intext':
            return patchShot(shotId, { intExt: value as ReelShot['intExt'] }, { intExt: value as ReelShot['intExt'] })
          case 'notes':
            return patchShot(shotId, { notes: value }, { notes: value })
          case 'assignee':
            return patchShot(shotId, { assigneeId: value as ReelShot['assigneeId'] }, { assigneeId: value as ReelShot['assigneeId'] })
          case 'priority':
            return patchShot(shotId, { priority: (value ?? 'none') as ReelShot['priority'] }, { priority: (value ?? 'none') as ReelShot['priority'] })
          default:
            return undefined
        }
      },
      toggleCharacter: (target, characterId) => {
        if (target.kind !== 'shot') return
        const found = findShot(scenes, target.id)
        if (found === null) return
        const current = found.shot.characters.map((entry) => entry.characterId as string)
        const next = characterId === '' ? [] : current.includes(characterId) ? current.filter((id) => id !== characterId) : [...current, characterId]
        const optimistic = next.map((id) => ({ characterId: id as ReelShot['characters'][number]['characterId'], source: 'manual' as const }))
        patchShot(target.id, { characters: next as never }, { characters: optimistic })
      },
      setPrefs,
      addReel: (sceneNodeId) => {
        void authoring.addReel(projectId, episode, sceneNodeId).then((result) => {
          if (failed(result) || result.status !== 'saved') return
          setScenes((current) => current.map((scene) => (scene.sceneNodeId === sceneNodeId ? { ...scene, reels: [...scene.reels, result.reel] } : scene)))
          setSelection({ sceneNodeId, reelId: result.reel.id })
        })
      },
      renameReel: (reelId, name) => {
        setScenes((current) => current.map((scene) => ({ ...scene, reels: scene.reels.map((reel) => (reel.id === reelId ? { ...reel, name } : reel)) })))
        void authoring.patchReel(projectId, episode, reelId, { name }).then((result) => {
          if (failed(result)) return router.refresh()
          if (result.status === 'saved') setScenes((current) => withReel(current, result.reel))
          return undefined
        })
      },
      deleteReel: (reelId) => {
        void authoring.deleteReel(projectId, episode, reelId).then((result) => {
          if (failed(result) || result.status !== 'deleted') return
          setScenes((current) => current.map((scene) => ({ ...scene, reels: scene.reels.filter((reel) => reel.id !== reelId) })))
        })
      },
      setClipLength: (reelId, seconds) => {
        setScenes((current) => current.map((scene) => ({ ...scene, reels: scene.reels.map((reel) => (reel.id === reelId ? { ...reel, clipLengthS: seconds } : reel)) })))
        void authoring.patchReel(projectId, episode, reelId, { clipLengthS: seconds }).then((result) => {
          if (failed(result)) return router.refresh()
          if (result.status === 'saved') setScenes((current) => withReel(current, result.reel))
          return undefined
        })
      },
      addShot: (reelId) => {
        void authoring.addShot(projectId, episode, { reelId }).then((result) => {
          if (failed(result) || result.status !== 'saved') return
          setScenes((current) => current.map((scene) => ({ ...scene, reels: scene.reels.map((reel) => (reel.id === reelId ? { ...reel, shots: [...reel.shots, result.shot] } : reel)) })))
          setDetail(result.shot.id)
        })
      },
      deleteShot: (shotId) => {
        setScenes((current) => current.map((scene) => ({ ...scene, reels: scene.reels.map((reel) => ({ ...reel, shots: reel.shots.filter((shot) => shot.id !== shotId) })) })))
        setPicked((current) => {
          const next = new Set(current)
          next.delete(shotId)
          return next
        })
        setDetail((current) => (current === shotId ? null : current))
        void authoring.deleteShot(projectId, episode, shotId).then((result) => {
          if (failed(result)) return router.refresh()
          if (result.status === 'saved') setScenes((current) => withReel(current, result.reel))
          return undefined
        })
      },
      moveShot: (shotId, reelId, beforeId) => {
        if (shotId === beforeId) return
        // Optimistic: the card is already where the pointer left it.
        setScenes((current) => {
          const found = findShot(current, shotId)
          if (found === null) return current
          const removed = current.map((scene) => ({ ...scene, reels: scene.reels.map((reel) => ({ ...reel, shots: reel.shots.filter((shot) => shot.id !== shotId) })) }))
          return removed.map((scene) => ({
            ...scene,
            reels: scene.reels.map((reel) => {
              if (reel.id !== reelId) return reel
              const at = beforeId === null ? reel.shots.length : reel.shots.findIndex((shot) => shot.id === beforeId)
              const index = at < 0 ? reel.shots.length : at
              const shots = [...reel.shots.slice(0, index), { ...found.shot, reelId }, ...reel.shots.slice(index)]
              return { ...reel, shots: shots.map((shot, i) => ({ ...shot, number: i + 1 })) }
            }),
          }))
        })
        void authoring.moveShot(projectId, episode, { shotId, reelId, beforeId }).then((result) => {
          if (failed(result)) router.refresh()
        })
      },
      previewRetime: (reelId, shotId, seconds) => {
        setResizing(shotId)
        setScenes((current) => patchShotIn(current, shotId, { durationS: seconds }))
        void reelId
      },
      commitRetime: (shotId, seconds) => {
        setResizing(null)
        void authoring.retimeShot(projectId, episode, { shotId, durationS: seconds }).then((result) => {
          if (failed(result)) return router.refresh()
          if (result.status === 'saved') setScenes((current) => withReel(current, result.reel))
          return undefined
        })
      },
      saveDescription: (shotId, text) => {
        const found = findShot(scenes, shotId)
        if (found === null || found.shot.description === text) return
        patchShot(shotId, { description: text }, { description: text, parts: [{ kind: 'text', text, characterId: null }] })
      },
      proposeShots: (sceneNodeId) => {
        void authoring.proposeShots(projectId, episode, sceneNodeId, null).then((result) => {
          if (failed(result) || result.status !== 'saved') return
          setScenes((current) => current.map((scene) => (scene.sceneNodeId === sceneNodeId ? { ...scene, reels: [...scene.reels.filter((reel) => reel.id !== result.reel.id), result.reel] } : scene)))
          setSelection({ sceneNodeId, reelId: result.reel.id })
        })
      },
      aiShotlist: (reelId) => {
        void generate.aiShotlist(projectId, episode, reelId).then((result) => {
          if (result.status === 'disconnected') tell(result.message)
          else spent(result)
          router.refresh()
        })
      },
      generateSheet: (reelId) => {
        void generate.generateSheet(projectId, episode, reelId).then((result) => {
          if (!spent(result)) router.refresh()
        })
      },
      generateSceneImage: (sceneNodeId) => {
        void generate.generateSceneImage(projectId, episode, sceneNodeId).then((result) => {
          if (!spent(result)) router.refresh()
        })
      },
      uploadSceneImage: (sceneNodeId, file) => {
        const form = new FormData()
        form.set('image', file)
        void authoring.uploadSceneImage(projectId, episode, sceneNodeId, form).then((result) => {
          if (failed(result)) return
          router.refresh()
        })
      },
      uploadReference: (shotId, file) => {
        const form = new FormData()
        form.set('image', file)
        void authoring.uploadReference(projectId, episode, shotId, form).then((result) => {
          if (failed(result)) return
          router.refresh()
        })
      },
      generateFrames: (shotIds) => {
        void generate.generateFrames(projectId, episode, shotIds).then((result) => {
          if (!spent(result)) {
            setPicked(new Set())
            router.refresh()
          }
        })
      },
      shoot: (reelId) => {
        void generate.shootReel(projectId, episode, reelId).then((result) => {
          if (result.status === 'not_ready') {
            tell(`Not ready to shoot: ${result.failed.join(', ').replace(/_/g, ' ')}.`)
            return
          }
          if (!spent(result)) router.refresh()
        })
      },
      cancelGeneration: (generationId) => {
        void generate.cancelGeneration(projectId, episode, generationId).then((result) => {
          failed(result)
          router.refresh()
        })
      },
      saveSettings: async (input: SettingsInput) => {
        const result = await authoring.saveSettings(projectId, episode, input)
        if (failed(result)) return false
        if (result.status === 'locked') {
          tell('Production settings are locked for this episode - shooting has started.')
          return false
        }
        router.refresh()
        return true
      },
      suggestRewrite: (shot) => {
        setAssistantPrompt(`Shot ${String(shot.number)} was refused: "${shot.blockReason ?? ''}". Suggest a rewrite of: ${shot.description}`)
        session.setAssistantOpen(true)
      },
      setDragging,
    }),
    [bulk, episode, failed, patchShot, projectId, router, scenes, session, setAssistantPrompt, setPrefs, spent, tell],
  )

  const fields = prefs.fieldOrder
  const shown = useCallback((id: FieldId) => isShown(prefs, id), [prefs])

  const value = useMemo<ProductionValue>(
    () => ({
      projectId,
      episode,
      scenes,
      prefs,
      settings: load.settings,
      defaults: load.defaults,
      artStyles: load.artStyles,
      locations: load.locations,
      props: load.props,
      members: load.members,
      balance: load.balance,
      live: load.live,
      storage: load.storage,
      model: load.model,
      selection,
      picked,
      detail,
      menu,
      dragging,
      resizing,
      notice,
      fields,
      shown,
      act,
    }),
    [act, detail, dragging, episode, fields, load, menu, notice, picked, prefs, projectId, resizing, scenes, selection, shown],
  )

  const selectedScene = selection === null ? null : (scenes.find((scene) => scene.sceneNodeId === selection.sceneNodeId) ?? null)
  const openShot = detail === null ? null : findShot(scenes, detail)
  const state = scenes.length === 0 ? 'empty' : selectedScene !== null && selectedScene.reels.length === 0 ? 'scene-empty' : 'ready'
  const drawn = scenes.reduce((total, scene) => total + scene.reels.reduce((t, reel) => t + reel.shots.filter((shot) => shotStatusOf(shot) === 'drawn').length, 0), 0)

  return (
    <ProductionProvider value={value}>
      <main
        data-route="production"
        data-sub-view={prefs.view}
        data-production-state={state}
        data-production-root
        data-production-drawn={drawn}
        className="folio-prod-main"
      >
        <div className="folio-prod-glow" aria-hidden="true" />
        {scenes.length === 0 ? (
          <EmptyProduction />
        ) : (
          <>
            <SceneTabs />
            {selectedScene === null ? null : <ReelStrip scene={selectedScene} />}
            <div className="folio-prod-board" data-production-board>
              {prefs.view === 'grid' ? (selectedScene === null ? null : <SceneBoard scene={selectedScene} />) : <ColumnsView />}
            </div>
          </>
        )}
        {picked.size > 0 ? <BulkBar /> : null}
        {openShot === null ? null : <ShotDrawer scene={openShot.scene} reel={openShot.reel} shot={openShot.shot} />}
        {menu === null ? null : <ContextMenu key={`${menu.field}:${menu.target.kind}:${menu.target.kind === 'bulk' ? '' : menu.target.id}:${String(menu.x)}:${String(menu.y)}`} />}
        {setupOpen ? <SettingsModal /> : null}
        {notice === null ? null : (
          <div role="status" data-production-notice className="folio-prod-notice">
            {notice}
          </div>
        )}
        <Polling live={load.live.length > 0} />
      </main>
    </ProductionProvider>
  )
}

/** No script yet: nothing to shoot. The route's empty state, in the panel. */
const EmptyProduction = () => (
  <div className="flex flex-1 flex-col items-center justify-center gap-[6px] p-[24px] text-center" data-production-empty>
    <span className="text-13 text-ink">No scenes to shoot yet</span>
    <span className="font-mono text-10-5 text-ink3">Write or import a script - every scene heading becomes a tab here.</span>
  </div>
)
