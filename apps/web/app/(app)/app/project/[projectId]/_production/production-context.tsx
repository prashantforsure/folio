'use client'

import type {
  ArtStyle,
  Assignee,
  CreditBalance,
  EpisodeSettings,
  FieldId,
  Generation,
  ProductionScene,
  Reel,
  ReelId,
  ReelShot,
  ReelShotId,
  SettingsInput,
  ViewPreferences,
  ViewPreferencesPatch,
} from '@folio/contracts'
import type { LocationId, NodeId, PropId } from '@folio/script'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { createContext, useContext } from 'react'

import type { MenuField } from '../../../../../../lib/production/menus'

/**
 * What every piece of the Production body reads: the rows, the view
 * preferences, the selection, the overlays' state and the handlers. One
 * context rather than a bag of props down five levels - the shot card,
 * the table row and the drawer all open the same menus over the same
 * shot, and the bulk bar acts on the same picks.
 */

export type Selection = {
  readonly sceneNodeId: NodeId
  readonly reelId: ReelId | null
}

/** What a menu is over: one shot, the scene-setup row, or every picked shot. */
export type MenuTarget = { readonly kind: 'shot'; readonly id: ReelShotId } | { readonly kind: 'scene'; readonly id: NodeId } | { readonly kind: 'bulk' }

export type MenuState = {
  readonly field: MenuField
  readonly target: MenuTarget
  readonly x: number
  readonly y: number
}

export type ProductionHandlers = {
  readonly selectScene: (sceneNodeId: NodeId) => void
  readonly selectReel: (sceneNodeId: NodeId, reelId: ReelId | null) => void
  readonly openDetail: (shotId: ReelShotId) => void
  readonly closeDetail: () => void
  readonly togglePick: (shotId: ReelShotId) => void
  readonly clearPicked: () => void
  readonly openMenu: (field: MenuField, target: MenuTarget, event: ReactMouseEvent) => void
  readonly closeMenu: () => void
  /** A single-select menu's pick, or a special menu's value (a date, a note). `null` clears. */
  readonly pickValue: (field: MenuField, target: MenuTarget, value: string | null) => void
  /** The Character menu's checkbox. */
  readonly toggleCharacter: (target: MenuTarget, characterId: string) => void
  readonly setPrefs: (patch: ViewPreferencesPatch) => void
  readonly addReel: (sceneNodeId: NodeId) => void
  readonly renameReel: (reelId: ReelId, name: string) => void
  readonly deleteReel: (reelId: ReelId) => void
  readonly setClipLength: (reelId: ReelId, seconds: Reel['clipLengthS']) => void
  readonly addShot: (reelId: ReelId) => void
  readonly deleteShot: (shotId: ReelShotId) => void
  readonly moveShot: (shotId: ReelShotId, reelId: ReelId, beforeId: ReelShotId | null) => void
  /** Live while a handle is dragged (local only), then committed on release. */
  readonly previewRetime: (reelId: ReelId, shotId: ReelShotId, seconds: number) => void
  readonly commitRetime: (shotId: ReelShotId, seconds: number) => void
  readonly saveDescription: (shotId: ReelShotId, text: string) => void
  readonly proposeShots: (sceneNodeId: NodeId) => void
  readonly aiShotlist: (reelId: ReelId) => void
  readonly generateSheet: (reelId: ReelId) => void
  readonly generateSceneImage: (sceneNodeId: NodeId) => void
  readonly uploadSceneImage: (sceneNodeId: NodeId, file: File) => void
  readonly uploadReference: (shotId: ReelShotId, file: File) => void
  readonly generateFrames: (shotIds: readonly ReelShotId[]) => void
  readonly shoot: (reelId: ReelId) => void
  readonly cancelGeneration: (generationId: Generation['id']) => void
  readonly saveSettings: (input: SettingsInput) => Promise<boolean>
  readonly suggestRewrite: (shot: ReelShot) => void
  readonly setDragging: (shotId: ReelShotId | null) => void
}

export type ProductionValue = {
  readonly projectId: string
  readonly episode: string
  readonly scenes: readonly ProductionScene[]
  readonly prefs: ViewPreferences
  readonly settings: EpisodeSettings | null
  readonly defaults: EpisodeSettings
  readonly artStyles: readonly ArtStyle[]
  readonly locations: readonly { readonly id: LocationId; readonly name: string }[]
  /** The project's props, for the `Prop` menu and every surface that prints one's name. */
  readonly props: readonly { readonly id: PropId; readonly name: string }[]
  readonly members: readonly Assignee[]
  readonly balance: CreditBalance
  readonly live: readonly Generation[]
  readonly storage: boolean
  readonly model: boolean
  readonly selection: Selection | null
  readonly picked: ReadonlySet<ReelShotId>
  readonly detail: ReelShotId | null
  readonly menu: MenuState | null
  readonly dragging: ReelShotId | null
  readonly resizing: ReelShotId | null
  /** The last failure, for the toast. */
  readonly notice: string | null
  readonly fields: readonly FieldId[]
  readonly shown: (id: FieldId) => boolean
  readonly act: ProductionHandlers
}

const ProductionContext = createContext<ProductionValue | null>(null)

export const ProductionProvider = ProductionContext.Provider

export const useProduction = (): ProductionValue => {
  const value = useContext(ProductionContext)
  if (value === null) throw new Error('useProduction outside the Production workspace')
  return value
}
