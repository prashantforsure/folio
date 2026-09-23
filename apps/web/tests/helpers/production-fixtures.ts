import type { ProductionCastMember, ProductionScene, Reel, ReelShot, Sheet } from '@folio/contracts'

/**
 * Production's read model in miniature, for the production pipeline and the
 * paid tools (roadmap task 5.1). Every id is a real uuid, because the stored
 * operations parse their ids as uuids; `uid(kind, n)` makes the same one for
 * the same pair, so a test can name a reel or a shot by its number.
 */

const KINDS: Readonly<Record<string, string>> = { scene: 'a', reel: 'b', shot: 'c', location: 'd', character: 'e', sheet: 'f', clip: '1', gen: '2' }

export const uid = (kind: keyof typeof KINDS | string, n: number): string => `${KINDS[kind] ?? '9'}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export const shot = (n: number, over: Partial<ReelShot> = {}): ReelShot => ({
  id: uid('shot', n) as ReelShot['id'],
  reelId: uid('reel', 1) as ReelShot['reelId'],
  number: n,
  position: String(n * 1000),
  title: null,
  durationS: 5,
  status: null,
  shotType: 'Wide angle',
  cameraAngle: 'Eye level',
  cameraMotion: 'Still',
  cameraBody: 'ARRI Alexa Mini LF',
  lens: '24mm T2.8',
  description: 'The ferry pulls away from the jetty.',
  parts: [],
  dialogue: null,
  proposed: false,
  blocked: false,
  blockReason: null,
  propId: null,
  locationId: null,
  intExt: null,
  shootDate: null,
  notes: null,
  assigneeId: null,
  priority: 'none',
  frameState: 'empty',
  frame: null,
  frameProgress: null,
  frameKept: false,
  takeIndex: null,
  characters: [],
  references: [],
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
  ...over,
})

export const sheetDone = (reel: number): Sheet => ({
  id: uid('sheet', reel) as Sheet['id'],
  reelId: uid('reel', reel) as Sheet['reelId'],
  state: 'done',
  asset: null,
  progress: null,
  generatedAt: null,
  creditsSpent: 40,
  artStyleId: null,
  generationId: null,
  frames: [],
})

/** A reel: three five-second shots fill its fifteen seconds unless told otherwise. */
export const reel = (n: number, scene: number, over: Partial<Reel> = {}): Reel => ({
  id: uid('reel', n) as Reel['id'],
  sceneNodeId: uid('scene', scene) as Reel['sceneNodeId'],
  name: `Reel ${String(n)}`,
  clipLengthS: 15,
  continuity: 'natural',
  status: 'writing',
  finalized: false,
  position: String(n * 1000),
  shots: [shot(n * 10 + 1, { reelId: uid('reel', n) as ReelShot['reelId'] }), shot(n * 10 + 2, { reelId: uid('reel', n) as ReelShot['reelId'] }), shot(n * 10 + 3, { reelId: uid('reel', n) as ReelShot['reelId'] })],
  sheet: null,
  clip: null,
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
  ...over,
})

export const member = (n: number, name: string, ready = true): ProductionCastMember => ({
  id: uid('character', n) as ProductionCastMember['id'],
  name,
  initials: name.slice(0, 2).toUpperCase(),
  hue: 200,
  portraitUrl: ready ? `https://cdn.example/${name}.png` : null,
  appearanceReady: ready,
})

export const scene = (n: number, reels: readonly Reel[], over: Partial<ProductionScene> = {}): ProductionScene => ({
  sceneNodeId: uid('scene', n) as ProductionScene['sceneNodeId'],
  number: n,
  heading: 'EXT. JETTY - DAWN',
  set: 'JETTY',
  locationId: uid('location', 1) as ProductionScene['locationId'],
  locationName: 'Jetty',
  intExt: 'EXT',
  timeOfDay: 'DAWN',
  logline: 'The ferry pulls away from the jetty.',
  cast: [member(1, 'MEERA')],
  plateReady: true,
  still: null,
  stillState: 'drawn',
  setup: { cameraBody: null, lens: null, propId: null, locationId: null, intExt: null, shootDate: null, priority: null, note: null },
  reels,
  ...over,
})
