import type { Asset, EpisodeSettings, Generation, ReadinessFlag, Reel, ReelShot, ViewPreferences } from '@folio/contracts'

/**
 * What the Production actions return. Discriminated, never thrown across
 * the boundary (AGENTS.md, Conventions > Errors). `refused` is the gate's
 * word; `error` a bad input or a missing row; the rest are the route's own.
 */

export type Failure = { readonly status: 'refused'; readonly message: string } | { readonly status: 'error'; readonly message: string }

export type SavedResult = { readonly status: 'saved' } | Failure

export type SettingsResult =
  | { readonly status: 'saved'; readonly settings: EpisodeSettings }
  /** The spec's rule 4: locked once production starts. The current settings come back so the modal can show them. */
  | { readonly status: 'locked'; readonly settings: EpisodeSettings }
  | Failure

export type ReelResult = { readonly status: 'saved'; readonly reel: Reel } | Failure

/** A move: the reels it touched, by id. The client keeps the order it drew and the next read confirms it. */
export type MovedResult = { readonly status: 'saved'; readonly reelIds: readonly Reel['id'][] } | Failure

export type DeleteReelResult = { readonly status: 'deleted' } | { readonly status: 'busy'; readonly message: string } | Failure

export type ShotResult = { readonly status: 'saved'; readonly shot: ReelShot } | Failure

export type ShotsResult = { readonly status: 'saved'; readonly shots: readonly ReelShot[] } | Failure

export type BulkResult = { readonly status: 'saved'; readonly changed: number } | Failure

export type PreferencesResult = { readonly status: 'saved'; readonly preferences: ViewPreferences } | Failure

export type UploadResult = { readonly status: 'saved'; readonly asset: Asset } | Failure

/**
 * A generate button's answer: the row is created and running, the balance was
 * short, the model / storage is not connected, or this caller has made as many
 * generations this hour as ADR 0003 **D14** allows.
 *
 * `rate-limited` carries the seconds rather than only a sentence, so a caller
 * that retries by itself has a number to wait for and a person is told when to
 * come back. It is the only refusal here that will stop being true on its own.
 */
export type GenerationResult =
  | { readonly status: 'queued'; readonly generation: Generation }
  | { readonly status: 'insufficient'; readonly available: number; readonly cost: number }
  | { readonly status: 'disconnected'; readonly message: string }
  | { readonly status: 'rate-limited'; readonly message: string; readonly retryAfterSeconds: number }
  | Failure

/** `Start shooting`: the spec's 422 - the failing readiness flags, in step order. */
export type ShootResult = GenerationResult | { readonly status: 'not_ready'; readonly failed: readonly ReadinessFlag[] }

export type CancelResult = { readonly status: 'cancelled' } | { readonly status: 'already-over' } | Failure
