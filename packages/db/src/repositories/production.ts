import type {
  ArtStyle,
  ArtStyleId,
  Asset,
  AssetId,
  AssetKind,
  BulkPatch,
  Clip,
  ClipId,
  EpisodeId,
  EpisodeSettings,
  FieldId,
  Generation,
  GenerationJob,
  GenerationTarget,
  NoteTarget,
  ProductionGenerationId,
  Reel,
  ReelId,
  ReelPatch,
  ReelShot,
  ReelShotId,
  ReelStatus,
  SceneSetup,
  SceneSetupPatch,
  SettingsInput,
  Sheet,
  SheetId,
  ShotPatch,
  ShotStatus,
  UserId,
  ViewPreferences,
  ViewPreferencesPatch,
} from '@folio/contracts'
import { ART_STYLE_PRESET_KEYS, DEFAULT_VIEW_PREFERENCES, FIELD_IDS } from '@folio/contracts'
import type { CharacterId, DescriptionPart, LocationId, NodeId, SluglineReading } from '@folio/script'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { FolioDatabase } from '../client'
import {
  activityLog,
  artStyles,
  assets,
  clips,
  creditLedger,
  documents,
  episodeSettings,
  generations,
  nodes,
  notes,
  reelShots,
  reels,
  sceneDerivations,
  scenes,
  shotCharacters,
  shotDescriptionParts,
  storyboardFrames,
  storyboardSheets,
  viewPreferences,
} from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { jsonb } from '../sql-json'
import { stamp, stampOrNull } from './mapping'

/**
 * The Production route's rows - `docs/production/production.md` §7 on the
 * tables `schema/production.ts` declares. Every function takes a scope;
 * every statement is tenanted through it.
 *
 * ## The read is one shape
 *
 * `readProductionEpisode` returns everything the page draws for one
 * episode in nine statements, whatever its size: the present scenes with
 * their authored row, the reels of those scenes, the shots of those reels,
 * their parts and characters, the sheets and their frames, the latest clip
 * per reel, every asset any of them points at, and the generations still
 * going. The web layer folds in the other routes' rows (cast, locations,
 * members) and computes what the spec says to compute.
 *
 * ## Reserve then execute, in one statement
 *
 * `createGeneration` is the route's one money write, and it is one
 * statement on the Storyboard's pattern: the balance check is the `WHERE`
 * on the generation insert, the reservation is inserted from the returned
 * id, and nothing is written when the balance is short. Settling is a
 * transaction: the row's state, the ledger row that closes the reservation
 * (`spend` on success, `release` otherwise - the release *is* the refund),
 * and whatever the job produced.
 *
 * ## Order is `position`, number is the count
 *
 * A shot's `position` is a numeric key; a move writes one row's position
 * to the midpoint of its neighbours. `number` is the spec's column and the
 * card's badge, and it must agree with the order, so every write that can
 * change an order renumbers the reel it touched in two statements (a bump
 * past the live numbers, then `row_number()` - the partial unique index is
 * checked per row, and a single swap would collide).
 */

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

type Db = FolioDatabase | Parameters<Parameters<FolioDatabase['transaction']>[0]>[0]

type AssetRow = typeof assets.$inferSelect

/** The asset row with its key; the web layer composes the URL. */
export type AssetRecord = Omit<Asset, 'url'> & { readonly storageKey: string }

export const assetFromRow = (row: AssetRow): AssetRecord => ({
  id: row.id as AssetId,
  kind: row.kind,
  storageKey: row.storageKey,
  mime: row.mime,
  width: row.width,
  height: row.height,
  source: row.source,
})

const artStyleFromRow = (row: typeof artStyles.$inferSelect): ArtStyle => ({
  id: row.id as ArtStyleId,
  key: row.key,
  name: row.name,
  era: row.era,
  referenceFilms: row.referenceFilms,
  description: row.description,
  plateGradient: row.plateGradient,
  isPreset: row.isPreset,
})

const settingsFromRow = (row: typeof episodeSettings.$inferSelect): EpisodeSettings => ({
  episodeId: row.episodeId as EpisodeId,
  aspectRatio: row.aspectRatio,
  productionType: row.productionType,
  cameraStyle: row.cameraStyle,
  pacing: row.pacing,
  lighting: row.lighting,
  artStyleId: row.artStyleId as ArtStyleId,
  lockedAt: stampOrNull(row.lockedAt),
})

const generationFromRow = (row: typeof generations.$inferSelect): Generation => ({
  id: row.id as ProductionGenerationId,
  episodeId: row.episodeId as EpisodeId,
  targetType: row.targetType,
  targetId: row.targetId,
  job: row.job,
  state: row.state,
  progress: row.progress,
  refusalReason: row.refusalReason,
  creditsReserved: row.creditsReserved,
  creditsCharged: row.creditsCharged,
  route: row.route,
  startedAt: stampOrNull(row.startedAt),
  finishedAt: stampOrNull(row.finishedAt),
  createdAt: stamp(row.createdAt),
})

/** A reel shot with asset ids rather than assets; the read resolves them. */
export type ReelShotRecord = Omit<ReelShot, 'frame' | 'references'> & {
  readonly frameAssetId: AssetId | null
  readonly referenceAssetIds: readonly AssetId[]
}

const shotFromRow = (
  row: typeof reelShots.$inferSelect,
  parts: readonly DescriptionPart[],
  characters: ReelShot['characters'],
): ReelShotRecord => ({
  id: row.id as ReelShotId,
  reelId: row.reelId as ReelId,
  number: row.number,
  position: String(row.position),
  title: row.title,
  durationS: row.durationS,
  status: row.status,
  shotType: row.shotType,
  cameraAngle: row.cameraAngle,
  cameraMotion: row.cameraMotion,
  cameraBody: row.cameraBody,
  lens: row.lens,
  description: row.description,
  parts,
  dialogue: row.dialogue,
  proposed: row.proposed,
  blocked: row.blocked,
  blockReason: row.blockReason,
  prop: row.prop,
  locationId: row.locationId === null ? null : (row.locationId as LocationId),
  intExt: row.intExt,
  shootDate: row.shootDate,
  notes: row.notes,
  assigneeId: row.assigneeId === null ? null : (row.assigneeId as UserId),
  priority: row.priority,
  frameState: row.frameState,
  frameAssetId: row.frameAssetId === null ? null : (row.frameAssetId as AssetId),
  frameProgress: row.frameProgress,
  frameKept: row.frameKept,
  takeIndex: row.takeIndex,
  characters,
  referenceAssetIds: row.referenceAssetIds.map((id) => id as AssetId),
  createdAt: stamp(row.createdAt),
  updatedAt: stamp(row.updatedAt),
})

export type SheetRecord = Omit<Sheet, 'asset' | 'frames'> & {
  readonly assetId: AssetId | null
  readonly frames: readonly (Omit<Sheet['frames'][number], 'asset'> & { readonly assetId: AssetId | null })[]
}

export type ClipRecord = Omit<Clip, 'poster' | 'video'> & {
  readonly posterAssetId: AssetId | null
  readonly videoAssetId: AssetId | null
}

export type ReelRecord = Omit<Reel, 'shots' | 'sheet' | 'clip'> & {
  readonly shots: readonly ReelShotRecord[]
  readonly sheet: SheetRecord | null
  readonly clip: ClipRecord | null
}

const reelFromRow = (
  row: typeof reels.$inferSelect,
  shots: readonly ReelShotRecord[],
  sheet: SheetRecord | null,
  clip: ClipRecord | null,
): ReelRecord => ({
  id: row.id as ReelId,
  sceneNodeId: row.sceneNodeId as NodeId,
  name: row.name,
  clipLengthS: row.clipLengthS as Reel['clipLengthS'],
  continuity: row.continuity,
  status: row.status,
  finalized: row.finalized,
  position: String(row.position),
  shots,
  sheet,
  clip,
  createdAt: stamp(row.createdAt),
  updatedAt: stamp(row.updatedAt),
})

// ---------------------------------------------------------------------------
// The episode read
// ---------------------------------------------------------------------------

/** One present scene of the episode, with what the authored row and the script add. */
export type ProductionSceneRecord = {
  readonly sceneNodeId: NodeId
  readonly number: number
  readonly heading: string
  readonly reading: SluglineReading | null
  readonly locationId: LocationId | null
  readonly cast: readonly CharacterId[]
  /** The first action line after the heading, or the heading. */
  readonly logline: string
  readonly stillAssetId: AssetId | null
  readonly stillState: ReelShot['frameState']
  readonly setup: Omit<SceneSetup, 'note'>
}

export type ProductionEpisodeRecord = {
  readonly scenes: readonly ProductionSceneRecord[]
  readonly reels: readonly ReelRecord[]
  readonly assets: ReadonlyMap<AssetId, AssetRecord>
  readonly settings: EpisodeSettings | null
  readonly artStyles: readonly ArtStyle[]
  /** The latest note per target. */
  readonly notes: ReadonlyMap<string, string>
  readonly live: readonly Generation[]
  readonly preferences: ViewPreferences
}

const readingOf = (raw: unknown): SluglineReading | null =>
  typeof raw === 'object' && raw !== null && 'set' in raw ? (raw as SluglineReading) : null

/** The text of an inline content value, for the logline. Tolerant: an unreadable node is an empty line. */
const inlineText = (raw: unknown): string => {
  if (!Array.isArray(raw)) return ''
  return raw
    .map((run: unknown) => {
      if (typeof run !== 'object' || run === null) return ''
      const r = run as { readonly kind?: unknown; readonly text?: unknown }
      return r.kind === 'text' && typeof r.text === 'string' ? r.text : r.kind === 'mention' ? '' : ''
    })
    .join('')
    .trim()
}

const listScenes = async (scope: ProjectScope, episodeId: EpisodeId): Promise<readonly ProductionSceneRecord[]> => {
  const db = dbOf(scope)
  const rows = await db
    .select({
      sceneNodeId: sceneDerivations.sceneNodeId,
      number: sceneDerivations.number,
      heading: sceneDerivations.heading,
      reading: sceneDerivations.reading,
      locationId: sceneDerivations.locationId,
      cast: sceneDerivations.cast,
      authored: scenes,
    })
    .from(sceneDerivations)
    .innerJoin(nodes, eq(nodes.id, sceneDerivations.sceneNodeId))
    .innerJoin(
      documents,
      and(eq(documents.id, nodes.documentId), eq(documents.episodeId, episodeId), eq(documents.kind, 'screenplay')),
    )
    .leftJoin(scenes, eq(scenes.sceneNodeId, sceneDerivations.sceneNodeId))
    .where(scoped(scope, sceneDerivations, eq(sceneDerivations.presence, 'present')))
    .orderBy(asc(sceneDerivations.number))

  // The logline: the first action node after each heading, in document order.
  const lines = await db
    .select({ id: nodes.id, type: nodes.type, content: nodes.content })
    .from(nodes)
    .innerJoin(documents, and(eq(documents.id, nodes.documentId), eq(documents.episodeId, episodeId), eq(documents.kind, 'screenplay')))
    .where(scoped(scope, nodes, inArray(nodes.type, ['scene', 'action'])))
    .orderBy(sql`${nodes.orderKey} COLLATE "C" ASC`)
  const loglines = new Map<string, string>()
  let current: string | null = null
  for (const line of lines) {
    if (line.type === 'scene') {
      current = line.id
      continue
    }
    if (current !== null && !loglines.has(current)) {
      const text = inlineText(line.content)
      if (text.length > 0) loglines.set(current, text)
    }
  }

  return rows.map((row) => ({
    sceneNodeId: row.sceneNodeId as NodeId,
    number: row.number,
    heading: row.heading,
    reading: readingOf(row.reading),
    locationId: row.locationId === null ? null : (row.locationId as LocationId),
    cast: row.cast.map((id) => id as CharacterId),
    logline: loglines.get(row.sceneNodeId) ?? row.heading,
    stillAssetId: row.authored?.stillAssetId === null || row.authored === null ? null : (row.authored.stillAssetId as AssetId),
    stillState: row.authored?.stillState ?? 'empty',
    setup: {
      cameraBody: row.authored?.cameraBody ?? null,
      lens: row.authored?.lens ?? null,
      prop: row.authored?.prop ?? null,
      locationId: row.authored?.locationId === null || row.authored === null ? null : (row.authored.locationId as LocationId),
      intExt: row.authored?.intExt ?? null,
      shootDate: row.authored?.shootDate ?? null,
      priority: row.authored?.priority ?? null,
    },
  }))
}

const listReelsOf = async (db: Db, scope: ProjectScope, sceneIds: readonly NodeId[]): Promise<readonly ReelRecord[]> => {
  if (sceneIds.length === 0) return []
  const reelRows = await db
    .select()
    .from(reels)
    .where(scoped(scope, reels, inArray(reels.sceneNodeId, [...sceneIds]), isNull(reels.deletedAt)))
    .orderBy(asc(reels.position), asc(reels.createdAt))
  if (reelRows.length === 0) return []
  const reelIds = reelRows.map((row) => row.id)

  const [shotRows, sheetRows, clipRows] = await Promise.all([
    db
      .select()
      .from(reelShots)
      .where(scoped(scope, reelShots, inArray(reelShots.reelId, reelIds), isNull(reelShots.deletedAt)))
      .orderBy(asc(reelShots.position), asc(reelShots.createdAt)),
    db.select().from(storyboardSheets).where(scoped(scope, storyboardSheets, inArray(storyboardSheets.reelId, reelIds))),
    db
      .select()
      .from(clips)
      .where(scoped(scope, clips, inArray(clips.reelId, reelIds)))
      .orderBy(desc(clips.createdAt)),
  ])
  const shotIds = shotRows.map((row) => row.id)
  const sheetIds = sheetRows.map((row) => row.id)
  const [partRows, characterRows, frameRows] = await Promise.all([
    shotIds.length === 0
      ? []
      : db
          .select()
          .from(shotDescriptionParts)
          .where(scoped(scope, shotDescriptionParts, inArray(shotDescriptionParts.shotId, shotIds)))
          .orderBy(asc(shotDescriptionParts.position)),
    shotIds.length === 0
      ? []
      : db.select().from(shotCharacters).where(scoped(scope, shotCharacters, inArray(shotCharacters.shotId, shotIds))),
    sheetIds.length === 0
      ? []
      : db
          .select()
          .from(storyboardFrames)
          .where(scoped(scope, storyboardFrames, inArray(storyboardFrames.sheetId, sheetIds)))
          .orderBy(asc(storyboardFrames.position)),
  ])

  const partsOf = new Map<string, DescriptionPart[]>()
  for (const part of partRows) {
    const list = partsOf.get(part.shotId) ?? []
    list.push({ kind: part.kind, text: part.text, characterId: part.characterId === null ? null : (part.characterId as CharacterId) })
    partsOf.set(part.shotId, list)
  }
  const charactersOf = new Map<string, { readonly characterId: CharacterId; readonly source: 'auto' | 'manual' }[]>()
  for (const row of characterRows) {
    const list = charactersOf.get(row.shotId) ?? []
    list.push({ characterId: row.characterId as CharacterId, source: row.source })
    charactersOf.set(row.shotId, list)
  }
  const shotsOf = new Map<string, ReelShotRecord[]>()
  for (const row of shotRows) {
    const own = charactersOf.get(row.id) ?? []
    // Manual rows win; with none, the auto rows stand.
    const manual = own.filter((c) => c.source === 'manual')
    const list = shotsOf.get(row.reelId) ?? []
    list.push(shotFromRow(row, partsOf.get(row.id) ?? [], manual.length > 0 ? manual : own))
    shotsOf.set(row.reelId, list)
  }
  const framesOf = new Map<string, SheetRecord['frames'][number][]>()
  for (const row of frameRows) {
    const list = framesOf.get(row.sheetId) ?? []
    list.push({
      shotId: row.shotId as ReelShotId,
      position: row.position,
      heading: row.heading,
      cameraNote: row.cameraNote,
      timeFromS: row.timeFromS,
      timeToS: row.timeToS,
      assetId: row.assetId === null ? null : (row.assetId as AssetId),
    })
    framesOf.set(row.sheetId, list)
  }
  const sheetOf = new Map<string, SheetRecord>()
  for (const row of sheetRows) {
    sheetOf.set(row.reelId, {
      id: row.id as SheetId,
      reelId: row.reelId as ReelId,
      state: row.state,
      assetId: row.assetId === null ? null : (row.assetId as AssetId),
      progress: row.progress,
      generatedAt: stampOrNull(row.generatedAt),
      creditsSpent: row.creditsSpent,
      artStyleId: row.artStyleId === null ? null : (row.artStyleId as ArtStyleId),
      generationId: row.generationId === null ? null : (row.generationId as ProductionGenerationId),
      frames: framesOf.get(row.id) ?? [],
    })
  }
  const clipOf = new Map<string, ClipRecord>()
  for (const row of clipRows) {
    // Newest first, so the first row seen for a reel is its clip.
    if (clipOf.has(row.reelId)) continue
    clipOf.set(row.reelId, {
      id: row.id as ClipId,
      reelId: row.reelId as ReelId,
      state: row.state,
      version: row.version,
      posterAssetId: row.posterAssetId === null ? null : (row.posterAssetId as AssetId),
      videoAssetId: row.videoAssetId === null ? null : (row.videoAssetId as AssetId),
      creditsSpent: row.creditsSpent,
      generationId: row.generationId === null ? null : (row.generationId as ProductionGenerationId),
      createdAt: stamp(row.createdAt),
    })
  }
  return reelRows.map((row) => reelFromRow(row, shotsOf.get(row.id) ?? [], sheetOf.get(row.id) ?? null, clipOf.get(row.id) ?? null))
}

/** The asset rows behind a list of ids - what an action needs to resolve one shot or reel it just wrote. */
export const readAssetRecords = async (scope: ProjectScope, ids: readonly AssetId[]): Promise<ReadonlyMap<AssetId, AssetRecord>> => {
  const wanted = [...new Set(ids)]
  if (wanted.length === 0) return new Map()
  const rows = await dbOf(scope)
    .select()
    .from(assets)
    .where(scoped(scope, assets, inArray(assets.id, wanted.map((id) => id as string))))
  return new Map(rows.map((row) => [row.id as AssetId, assetFromRow(row)]))
}

export const listArtStyles = async (scope: ProjectScope): Promise<readonly ArtStyle[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(artStyles)
    .where(sql`${artStyles.projectId} IS NULL OR ${artStyles.projectId} = ${scope.projectId}`)
    .orderBy(asc(artStyles.createdAt), asc(artStyles.id))
  // The presets in the spec's order, then a project's own by age.
  const rank = (key: string): number => {
    const at = (ART_STYLE_PRESET_KEYS as readonly string[]).indexOf(key)
    return at < 0 ? ART_STYLE_PRESET_KEYS.length : at
  }
  return rows
    .map(artStyleFromRow)
    .sort((a, b) => (a.isPreset === b.isPreset ? (a.isPreset ? rank(a.key) - rank(b.key) : 0) : a.isPreset ? -1 : 1))
}

export const readArtStyleByKey = async (scope: ProjectScope, key: string): Promise<ArtStyle | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(artStyles)
    .where(and(eq(artStyles.key, key), sql`${artStyles.projectId} IS NULL OR ${artStyles.projectId} = ${scope.projectId}`))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : artStyleFromRow(row)
}

export const readEpisodeSettings = async (scope: ProjectScope, episodeId: EpisodeId): Promise<EpisodeSettings | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(episodeSettings)
    .where(scoped(scope, episodeSettings, eq(episodeSettings.episodeId, episodeId)))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : settingsFromRow(row)
}

const readPreferences = async (scope: ProjectScope, episodeId: EpisodeId): Promise<ViewPreferences> => {
  if (scope.actor === null) return DEFAULT_VIEW_PREFERENCES
  const rows = await dbOf(scope)
    .select()
    .from(viewPreferences)
    .where(scoped(scope, viewPreferences, eq(viewPreferences.userId, scope.actor), eq(viewPreferences.episodeId, episodeId)))
    .limit(1)
  const row = rows[0]
  if (row === undefined) return DEFAULT_VIEW_PREFERENCES
  const visibility = { ...DEFAULT_VIEW_PREFERENCES.fieldVisibility }
  const stored = row.fieldVisibility as Record<string, unknown>
  for (const id of FIELD_IDS) if (typeof stored[id] === 'boolean') visibility[id] = stored[id]
  const known = new Set<string>(FIELD_IDS)
  const order = row.fieldOrder.filter((id): id is FieldId => known.has(id))
  const fieldOrder = order.length === FIELD_IDS.length ? order : [...order, ...FIELD_IDS.filter((id) => !order.includes(id))]
  return {
    view: row.view,
    fieldVisibility: visibility,
    fieldOrder,
    statusFilter: row.statusFilter,
    unassignedOnly: row.unassignedOnly,
    sort: row.sort,
  }
}

const readLatestNotes = async (scope: ProjectScope, targetIds: readonly string[]): Promise<ReadonlyMap<string, string>> => {
  if (targetIds.length === 0) return new Map()
  const rows = await dbOf(scope)
    .select({ targetType: notes.targetType, targetId: notes.targetId, body: notes.body })
    .from(notes)
    .where(scoped(scope, notes, inArray(notes.targetId, [...targetIds])))
    .orderBy(desc(notes.createdAt))
  const out = new Map<string, string>()
  for (const row of rows) {
    const key = `${row.targetType}:${row.targetId}`
    if (!out.has(key)) out.set(key, row.body)
  }
  return out
}

export const listLiveGenerations = async (scope: ProjectScope, episodeId: EpisodeId): Promise<readonly Generation[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(generations)
    .where(scoped(scope, generations, eq(generations.episodeId, episodeId), inArray(generations.state, ['queued', 'running'])))
    .orderBy(asc(generations.createdAt))
  return rows.map(generationFromRow)
}

/** Everything the page draws for one episode. See the header. */
export const readProductionEpisode = async (scope: ProjectScope, episodeId: EpisodeId): Promise<ProductionEpisodeRecord> => {
  const [sceneRows, settings, styles, live, preferences] = await Promise.all([
    listScenes(scope, episodeId),
    readEpisodeSettings(scope, episodeId),
    listArtStyles(scope),
    listLiveGenerations(scope, episodeId),
    readPreferences(scope, episodeId),
  ])
  const reelRows = await listReelsOf(
    dbOf(scope),
    scope,
    sceneRows.map((scene) => scene.sceneNodeId),
  )
  const assetIds: AssetId[] = []
  const noteTargets: string[] = []
  for (const scene of sceneRows) {
    if (scene.stillAssetId !== null) assetIds.push(scene.stillAssetId)
    noteTargets.push(scene.sceneNodeId as string)
  }
  for (const reel of reelRows) {
    noteTargets.push(reel.id as string)
    if (reel.sheet?.assetId) assetIds.push(reel.sheet.assetId)
    for (const frame of reel.sheet?.frames ?? []) if (frame.assetId !== null) assetIds.push(frame.assetId)
    if (reel.clip?.posterAssetId) assetIds.push(reel.clip.posterAssetId)
    if (reel.clip?.videoAssetId) assetIds.push(reel.clip.videoAssetId)
    for (const shot of reel.shots) {
      noteTargets.push(shot.id as string)
      if (shot.frameAssetId !== null) assetIds.push(shot.frameAssetId)
      assetIds.push(...shot.referenceAssetIds)
    }
  }
  const [assetMap, noteMap] = await Promise.all([readAssetRecords(scope, assetIds), readLatestNotes(scope, noteTargets)])
  return { scenes: sceneRows, reels: reelRows, assets: assetMap, settings, artStyles: styles, notes: noteMap, live, preferences }
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

const logActivity = async (
  db: Db,
  scope: ProjectScope,
  verb: string,
  targetType: string,
  targetId: string | null,
  diff: unknown,
): Promise<void> => {
  await db.insert(activityLog).values({
    ...tenant(scope),
    actorId: scope.actor,
    verb,
    targetType,
    targetId,
    diff: jsonb(diff),
  })
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type SettingsWriteResult =
  | { readonly status: 'saved'; readonly settings: EpisodeSettings }
  /** `locked_at` is set: the spec's rule 4. Nothing written. */
  | { readonly status: 'locked'; readonly settings: EpisodeSettings }

/** Write the modal's six choices, unless the first shoot has locked them. */
export const upsertEpisodeSettings = async (
  scope: ProjectScope,
  episodeId: EpisodeId,
  input: SettingsInput,
): Promise<SettingsWriteResult> => {
  return dbOf(scope).transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(episodeSettings)
      .where(scoped(scope, episodeSettings, eq(episodeSettings.episodeId, episodeId)))
      .limit(1)
    const current = existing[0]
    if (current !== undefined && current.lockedAt !== null) return { status: 'locked', settings: settingsFromRow(current) }
    const rows = await tx
      .insert(episodeSettings)
      .values({
        ...tenant(scope),
        episodeId: episodeId as string,
        aspectRatio: input.aspectRatio,
        productionType: input.productionType,
        cameraStyle: input.cameraStyle,
        pacing: input.pacing,
        lighting: input.lighting,
        artStyleId: input.artStyleId as string,
        updatedBy: scope.actor,
      })
      .onConflictDoUpdate({
        target: episodeSettings.episodeId,
        set: {
          aspectRatio: input.aspectRatio,
          productionType: input.productionType,
          cameraStyle: input.cameraStyle,
          pacing: input.pacing,
          lighting: input.lighting,
          artStyleId: input.artStyleId as string,
          updatedBy: scope.actor,
          updatedAt: new Date(),
        },
        setWhere: isNull(episodeSettings.lockedAt),
      })
      .returning()
    const row = rows[0]
    if (row === undefined) throw new Error('Folio: writing episode settings returned no row.')
    await logActivity(tx, scope, 'settings.save', 'episode', episodeId as string, input)
    return { status: 'saved', settings: settingsFromRow(row) }
  })
}

// ---------------------------------------------------------------------------
// Positions and numbers
// ---------------------------------------------------------------------------

const STEP = 1000

/** A key between two neighbours; past the last is a step beyond it. */
const positionBetween = (before: number | null, after: number | null): number => {
  if (before === null && after === null) return STEP
  if (before === null) return (after as number) - STEP
  if (after === null) return before + STEP
  return (before + after) / 2
}

/** Renumber a reel's live shots 1..n by position, in two statements (see the header). */
const renumberReel = async (db: Db, scope: ProjectScope, reelId: ReelId): Promise<void> => {
  await db.execute(sql`
    update ${reelShots} set number = number + 100000
    where ${scoped(scope, reelShots, eq(reelShots.reelId, reelId), isNull(reelShots.deletedAt))}
  `)
  await db.execute(sql`
    update ${reelShots} as s set number = ranked.n, position = ranked.n * ${STEP}
    from (
      select id, row_number() over (order by position asc, created_at asc) as n
      from ${reelShots}
      where ${scoped(scope, reelShots, eq(reelShots.reelId, reelId), isNull(reelShots.deletedAt))}
    ) as ranked
    where s.id = ranked.id
  `)
}

// ---------------------------------------------------------------------------
// Reels
// ---------------------------------------------------------------------------

export const insertReel = async (scope: ProjectScope, sceneNodeId: NodeId, name?: string): Promise<ReelRecord> => {
  return dbOf(scope).transaction(async (tx) => {
    const existing = await tx
      .select({ position: reels.position, count: sql<number>`count(*) over ()::int` })
      .from(reels)
      .where(scoped(scope, reels, eq(reels.sceneNodeId, sceneNodeId), isNull(reels.deletedAt)))
      .orderBy(desc(reels.position))
      .limit(1)
    const last = existing[0]
    const rows = await tx
      .insert(reels)
      .values({
        ...tenant(scope),
        sceneNodeId: sceneNodeId as string,
        name: name ?? `Reel ${String((last?.count ?? 0) + 1)}`,
        position: positionBetween(last?.position ?? null, null),
      })
      .returning()
    const row = rows[0]
    if (row === undefined) throw new Error('Folio: inserting a reel returned no row.')
    await logActivity(tx, scope, 'reel.add', 'reel', row.id, { sceneNodeId })
    return reelFromRow(row, [], null, null)
  })
}

/** Mark a rendered reel stale and its clip with it. Called by every write that changes what the clip shows. */
const staleReel = async (db: Db, scope: ProjectScope, reelId: ReelId): Promise<void> => {
  const changed = await db
    .update(reels)
    .set({ status: 'stale', updatedAt: new Date() })
    .where(scoped(scope, reels, eq(reels.id, reelId), eq(reels.status, 'rendered')))
    .returning({ id: reels.id })
  if (changed.length === 0) return
  await db.execute(sql`
    update ${clips} set state = 'stale'
    where id = (
      select id from ${clips} where ${scoped(scope, clips, eq(clips.reelId, reelId))} order by created_at desc limit 1
    ) and state = 'rendered'
  `)
}

export type ReelWriteResult = { readonly status: 'saved'; readonly reel: ReelRecord } | { readonly status: 'no-reel' }

export const patchReel = async (scope: ProjectScope, reelId: ReelId, patch: ReelPatch): Promise<ReelWriteResult> => {
  return dbOf(scope).transaction(async (tx) => {
    const rows = await tx
      .update(reels)
      .set({
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.clipLengthS === undefined ? {} : { clipLengthS: patch.clipLengthS }),
        updatedAt: new Date(),
      })
      .where(scoped(scope, reels, eq(reels.id, reelId), isNull(reels.deletedAt)))
      .returning()
    const row = rows[0]
    if (row === undefined) return { status: 'no-reel' }
    if (patch.clipLengthS !== undefined) await staleReel(tx, scope, reelId)
    await logActivity(tx, scope, 'reel.patch', 'reel', reelId as string, patch)
    const [reel] = await listReelsOfTx(tx, scope, [reelId])
    return reel === undefined ? { status: 'no-reel' } : { status: 'saved', reel }
  })
}

/** The reels by id, inside a transaction - the same read as the episode's, over a handle. */
const listReelsOfTx = async (db: Db, scope: ProjectScope, reelIds: readonly ReelId[]): Promise<readonly ReelRecord[]> => {
  const rows = await db
    .select({ sceneNodeId: reels.sceneNodeId })
    .from(reels)
    .where(scoped(scope, reels, inArray(reels.id, [...reelIds] as string[])))
  const sceneIds = [...new Set(rows.map((row) => row.sceneNodeId as NodeId))]
  const all = await listReelsOf(db, scope, sceneIds)
  return all.filter((reel) => reelIds.includes(reel.id))
}

export type DeleteReelResult = { readonly status: 'deleted' } | { readonly status: 'busy' } | { readonly status: 'no-reel' }

/** Soft-delete a reel and its shots. Refused while a generation targets the reel, its sheet or one of its shots. */
export const softDeleteReel = async (scope: ProjectScope, reelId: ReelId): Promise<DeleteReelResult> => {
  return dbOf(scope).transaction(async (tx) => {
    const busy = await tx.execute<{ readonly n: number }>(sql`
      select count(*)::int as n from ${generations} as g
      where g.project_id = ${scope.projectId} and g.state in ('queued', 'running') and (
        (g.target_type = 'reel' and g.target_id = ${reelId})
        or (g.target_type = 'sheet' and g.target_id in (select id from ${storyboardSheets} where reel_id = ${reelId}))
        or (g.target_type = 'shot' and g.target_id in (select id from ${reelShots} where reel_id = ${reelId}))
      )
    `)
    if ((busy[0]?.n ?? 0) > 0) return { status: 'busy' }
    const now = new Date()
    const rows = await tx
      .update(reels)
      .set({ deletedAt: now, updatedAt: now })
      .where(scoped(scope, reels, eq(reels.id, reelId), isNull(reels.deletedAt)))
      .returning({ id: reels.id })
    if (rows.length === 0) return { status: 'no-reel' }
    await tx
      .update(reelShots)
      .set({ deletedAt: now, updatedAt: now })
      .where(scoped(scope, reelShots, eq(reelShots.reelId, reelId), isNull(reelShots.deletedAt)))
    await logActivity(tx, scope, 'reel.delete', 'reel', reelId as string, {})
    return { status: 'deleted' }
  })
}

export const readReel = async (scope: ProjectScope, reelId: ReelId): Promise<ReelRecord | null> => {
  const [reel] = await listReelsOfTx(dbOf(scope), scope, [reelId])
  return reel ?? null
}

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

/** What a new shot carries. The action parses the description into parts before it gets here. */
export type ShotSeed = {
  readonly description: string
  readonly parts: readonly DescriptionPart[]
  readonly durationS: ReelShot['durationS']
  readonly shotType?: ReelShot['shotType']
  readonly cameraAngle?: string
  readonly cameraMotion?: ReelShot['cameraMotion']
  readonly cameraBody?: string
  readonly lens?: string
  readonly dialogue?: string | null
  readonly proposed?: boolean
  readonly frameState?: ReelShot['frameState']
}

/** The fields of a shot the spec says a writer changes when they "edit the shot": the frame is out of date after. */
const FRAME_FIELDS = ['description', 'shotType', 'cameraAngle', 'cameraMotion', 'cameraBody', 'lens'] as const

const writeParts = async (db: Db, scope: ProjectScope, shotId: ReelShotId, parts: readonly DescriptionPart[]): Promise<void> => {
  await db.delete(shotDescriptionParts).where(scoped(scope, shotDescriptionParts, eq(shotDescriptionParts.shotId, shotId)))
  if (parts.length === 0) return
  await db.insert(shotDescriptionParts).values(
    parts.map((part, position) => ({
      ...tenant(scope),
      shotId: shotId as string,
      position,
      kind: part.kind,
      text: part.text,
      characterId: part.characterId === null ? null : (part.characterId as string),
    })),
  )
}

/** The auto rows follow the mention parts; they are rewritten only while no manual row exists. */
const writeAutoCharacters = async (db: Db, scope: ProjectScope, shotId: ReelShotId, parts: readonly DescriptionPart[]): Promise<void> => {
  const manual = await db
    .select({ characterId: shotCharacters.characterId })
    .from(shotCharacters)
    .where(scoped(scope, shotCharacters, eq(shotCharacters.shotId, shotId), eq(shotCharacters.source, 'manual')))
    .limit(1)
  if (manual.length > 0) return
  await db.delete(shotCharacters).where(scoped(scope, shotCharacters, eq(shotCharacters.shotId, shotId)))
  const ids = [...new Set(parts.filter((part) => part.kind === 'mention' && part.characterId !== null).map((part) => part.characterId as string))]
  if (ids.length === 0) return
  await db
    .insert(shotCharacters)
    .values(ids.map((characterId) => ({ ...tenant(scope), shotId: shotId as string, characterId, source: 'auto' as const })))
    .onConflictDoNothing()
}

export const insertReelShots = async (scope: ProjectScope, reelId: ReelId, seeds: readonly ShotSeed[]): Promise<readonly ReelShotRecord[]> => {
  if (seeds.length === 0) return []
  return dbOf(scope).transaction(async (tx) => {
    const last = await tx
      .select({ position: reelShots.position, number: reelShots.number })
      .from(reelShots)
      .where(scoped(scope, reelShots, eq(reelShots.reelId, reelId), isNull(reelShots.deletedAt)))
      .orderBy(desc(reelShots.position))
      .limit(1)
    let position = last[0]?.position ?? 0
    let number = last[0]?.number ?? 0
    const rows = await tx
      .insert(reelShots)
      .values(
        seeds.map((seed) => {
          position += STEP
          number += 1
          return {
            ...tenant(scope),
            reelId: reelId as string,
            number,
            position,
            durationS: seed.durationS,
            shotType: seed.shotType ?? 'Medium',
            cameraAngle: seed.cameraAngle ?? 'Eye level',
            cameraMotion: seed.cameraMotion ?? 'Still',
            cameraBody: seed.cameraBody ?? '',
            lens: seed.lens ?? '',
            description: seed.description,
            dialogue: seed.dialogue ?? null,
            proposed: seed.proposed ?? false,
            frameState: seed.frameState ?? (seed.description.trim().length > 0 ? 'ready' : 'empty'),
            createdBy: scope.actor,
          }
        }),
      )
      .returning()
    for (const [index, row] of rows.entries()) {
      const parts = seeds[index]?.parts ?? []
      await writeParts(tx, scope, row.id as ReelShotId, parts)
      await writeAutoCharacters(tx, scope, row.id as ReelShotId, parts)
    }
    await staleReel(tx, scope, reelId)
    await logActivity(tx, scope, 'shot.add', 'reel', reelId as string, { count: rows.length })
    const parts = new Map(rows.map((row, index) => [row.id, seeds[index]?.parts ?? []]))
    return rows.map((row) => shotFromRow(row, parts.get(row.id) ?? [], []))
  })
}

export type ShotWriteResult = { readonly status: 'saved'; readonly shot: ReelShotRecord } | { readonly status: 'no-shot' }

/** The parsed parts travel with the patch when the description changes. */
export const patchShot = async (
  scope: ProjectScope,
  shotId: ReelShotId,
  patch: ShotPatch,
  parts: readonly DescriptionPart[] | null,
): Promise<ShotWriteResult> => {
  return dbOf(scope).transaction(async (tx) => {
    const before = await tx
      .select()
      .from(reelShots)
      .where(scoped(scope, reelShots, eq(reelShots.id, shotId), isNull(reelShots.deletedAt)))
      .limit(1)
    const current = before[0]
    if (current === undefined) return { status: 'no-shot' }
    const { characters: manualCharacters, ...fields } = patch
    const set: Partial<typeof reelShots.$inferInsert> = { updatedAt: new Date() }
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) (set as Record<string, unknown>)[key] = value
    }
    // Editing a proposal is accepting it - a writer who changed it has taken it.
    if (current.proposed && Object.keys(fields).length > 0) set.proposed = false
    // The frame is out of date once the shot it drew changed.
    const frameChanged = FRAME_FIELDS.some((key) => fields[key] !== undefined && fields[key] !== current[key])
    if (frameChanged && (current.frameState === 'drawn' || current.frameState === 'uploaded')) set.frameState = 'stale'
    if (fields.description !== undefined && current.frameState === 'empty' && fields.description.trim().length > 0) set.frameState = 'ready'
    // A rewritten refused shot is no longer refused.
    if (fields.description !== undefined && current.blocked && fields.description !== current.description) {
      set.blocked = false
      set.blockReason = null
      if (set.frameState === undefined || set.frameState === 'stale') set.frameState = 'ready'
    }
    const rows = await tx
      .update(reelShots)
      .set(set)
      .where(scoped(scope, reelShots, eq(reelShots.id, shotId)))
      .returning()
    const row = rows[0]
    if (row === undefined) return { status: 'no-shot' }
    if (parts !== null) {
      await writeParts(tx, scope, shotId, parts)
      await writeAutoCharacters(tx, scope, shotId, parts)
    }
    if (manualCharacters !== undefined) {
      await tx.delete(shotCharacters).where(scoped(scope, shotCharacters, eq(shotCharacters.shotId, shotId)))
      if (manualCharacters.length > 0) {
        await tx
          .insert(shotCharacters)
          .values(manualCharacters.map((characterId) => ({ ...tenant(scope), shotId: shotId as string, characterId: characterId as string, source: 'manual' as const })))
          .onConflictDoNothing()
      } else {
        // Cleared by hand: back to the auto rows from the current parts.
        const currentParts = parts ?? (await readParts(tx, scope, shotId))
        await writeAutoCharacters(tx, scope, shotId, currentParts)
      }
    }
    if (frameChanged || fields.durationS !== undefined) await staleReel(tx, scope, row.reelId as ReelId)
    await logActivity(tx, scope, 'shot.patch', 'shot', shotId as string, patch)
    const finalParts = parts ?? (await readParts(tx, scope, shotId))
    const characters = await readCharacters(tx, scope, shotId)
    return { status: 'saved', shot: shotFromRow(row, finalParts, characters) }
  })
}

const readParts = async (db: Db, scope: ProjectScope, shotId: ReelShotId): Promise<readonly DescriptionPart[]> => {
  const rows = await db
    .select()
    .from(shotDescriptionParts)
    .where(scoped(scope, shotDescriptionParts, eq(shotDescriptionParts.shotId, shotId)))
    .orderBy(asc(shotDescriptionParts.position))
  return rows.map((row) => ({ kind: row.kind, text: row.text, characterId: row.characterId === null ? null : (row.characterId as CharacterId) }))
}

const readCharacters = async (db: Db, scope: ProjectScope, shotId: ReelShotId): Promise<ReelShot['characters']> => {
  const rows = await db.select().from(shotCharacters).where(scoped(scope, shotCharacters, eq(shotCharacters.shotId, shotId)))
  const own = rows.map((row) => ({ characterId: row.characterId as CharacterId, source: row.source }))
  const manual = own.filter((c) => c.source === 'manual')
  return manual.length > 0 ? manual : own
}

/** The bulk bar's patch over the picked shots. Returns how many rows changed. */
export const bulkPatchShots = async (scope: ProjectScope, input: BulkPatch): Promise<number> => {
  const set: Partial<typeof reelShots.$inferInsert> = { updatedAt: new Date() }
  if (input.patch.status !== undefined) set.status = input.patch.status
  if (input.patch.assigneeId !== undefined) set.assigneeId = input.patch.assigneeId
  if (input.patch.priority !== undefined) set.priority = input.patch.priority
  return dbOf(scope).transaction(async (tx) => {
    const rows = await tx
      .update(reelShots)
      .set(set)
      .where(scoped(scope, reelShots, inArray(reelShots.id, input.ids.map((id) => id as string)), isNull(reelShots.deletedAt)))
      .returning({ id: reelShots.id })
    await logActivity(tx, scope, 'shot.bulk', 'shot', null, input)
    return rows.length
  })
}

export type MoveShotResult = { readonly status: 'moved'; readonly reelIds: readonly ReelId[] } | { readonly status: 'no-shot' } | { readonly status: 'no-reel' }

/**
 * Put a shot before `beforeId` in `reelId` (or last). One read for the shot,
 * the target reel and its siblings together; one position write; then the
 * touched reels renumber. The rows are not read back - the client already
 * holds the order it asked for, and every statement here is a far round
 * trip (`Script save path`).
 */
export const moveReelShot = async (scope: ProjectScope, shotId: ReelShotId, reelId: ReelId, beforeId: ReelShotId | null): Promise<MoveShotResult> => {
  return dbOf(scope).transaction(async (tx) => {
    const rows = await tx.execute<{
      readonly id: string
      readonly reel_id: string
      readonly position: string
      readonly target_exists: boolean
    }>(sql`
      select s.id, s.reel_id, s.position,
             exists (select 1 from ${reels} as r where r.id = ${reelId} and r.project_id = ${scope.projectId} and r.deleted_at is null) as target_exists
      from ${reelShots} as s
      where s.project_id = ${scope.projectId} and s.deleted_at is null and (s.id = ${shotId} or s.reel_id = ${reelId})
      order by s.position asc, s.created_at asc
    `)
    const moved = rows.find((row) => row.id === shotId)
    if (moved === undefined) return { status: 'no-shot' }
    if (rows[0]?.target_exists !== true) return { status: 'no-reel' }
    const siblings = rows.filter((row) => row.id !== shotId && row.reel_id === reelId).map((row) => ({ id: row.id, position: Number(row.position) }))
    const at = beforeId === null ? siblings.length : siblings.findIndex((row) => row.id === beforeId)
    const index = at < 0 ? siblings.length : at
    const before = index === 0 ? null : (siblings[index - 1]?.position ?? null)
    const after = siblings[index]?.position ?? null
    await tx
      .update(reelShots)
      .set({ reelId: reelId as string, position: positionBetween(before, after), number: 100000 + index, updatedAt: new Date() })
      .where(scoped(scope, reelShots, eq(reelShots.id, shotId)))
    await renumberReel(tx, scope, reelId)
    const fromReel = moved.reel_id as ReelId
    if (fromReel !== reelId) await renumberReel(tx, scope, fromReel)
    await staleReel(tx, scope, reelId)
    if (fromReel !== reelId) await staleReel(tx, scope, fromReel)
    await logActivity(tx, scope, 'shot.move', 'shot', shotId as string, { reelId, beforeId })
    return { status: 'moved', reelIds: fromReel === reelId ? [reelId] : [reelId, fromReel] }
  })
}

export const softDeleteShot = async (scope: ProjectScope, shotId: ReelShotId): Promise<ReelRecord | null> => {
  return dbOf(scope).transaction(async (tx) => {
    const now = new Date()
    const rows = await tx
      .update(reelShots)
      .set({ deletedAt: now, updatedAt: now })
      .where(scoped(scope, reelShots, eq(reelShots.id, shotId), isNull(reelShots.deletedAt)))
      .returning({ reelId: reelShots.reelId })
    const row = rows[0]
    if (row === undefined) return null
    const reelId = row.reelId as ReelId
    await renumberReel(tx, scope, reelId)
    await staleReel(tx, scope, reelId)
    await logActivity(tx, scope, 'shot.delete', 'shot', shotId as string, {})
    const [reel] = await listReelsOfTx(tx, scope, [reelId])
    return reel ?? null
  })
}

/** Which reel a live shot is in, or null. One row, for an action that needs the reel before it writes. */
export const readReelIdOfShot = async (scope: ProjectScope, shotId: ReelShotId): Promise<ReelId | null> => {
  const rows = await dbOf(scope)
    .select({ reelId: reelShots.reelId })
    .from(reelShots)
    .where(scoped(scope, reelShots, eq(reelShots.id, shotId), isNull(reelShots.deletedAt)))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : (row.reelId as ReelId)
}

/** The timing bar's drag: the clamp is the caller's (`derive.ts`) and re-checked by the action. */
export const retimeShot = async (scope: ProjectScope, shotId: ReelShotId, durationS: number): Promise<ShotWriteResult> =>
  patchShot(scope, shotId, { durationS }, null)

/** Point a shot's References at one more asset. */
export const addShotReference = async (scope: ProjectScope, shotId: ReelShotId, assetId: AssetId): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(reelShots)
    .set({ referenceAssetIds: sql`array_append(${reelShots.referenceAssetIds}, ${assetId}::uuid)`, updatedAt: new Date() })
    .where(scoped(scope, reelShots, eq(reelShots.id, shotId), isNull(reelShots.deletedAt)))
    .returning({ id: reelShots.id })
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// Scenes: setup and still
// ---------------------------------------------------------------------------

/** The scene-setup row's overrides. The `scenes` row is made if the pass has not made it yet. */
export const setSceneSetup = async (scope: ProjectScope, patch: SceneSetupPatch): Promise<void> => {
  const { sceneNodeId, ...fields } = patch
  const set: Record<string, unknown> = { updatedAt: new Date() }
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) set[key] = value
  await dbOf(scope).transaction(async (tx) => {
    await tx
      .insert(scenes)
      .values({ ...tenant(scope), sceneNodeId: sceneNodeId as string, ...(set as Partial<typeof scenes.$inferInsert>) })
      .onConflictDoUpdate({ target: scenes.sceneNodeId, set: set as Partial<typeof scenes.$inferInsert> })
    await logActivity(tx, scope, 'scene.setup', 'scene', sceneNodeId as string, fields)
  })
}

/** Point a scene at an uploaded still (state `uploaded`). */
export const setSceneStill = async (scope: ProjectScope, sceneNodeId: NodeId, assetId: AssetId): Promise<void> => {
  await dbOf(scope).transaction(async (tx) => {
    await tx
      .insert(scenes)
      .values({ ...tenant(scope), sceneNodeId: sceneNodeId as string, stillAssetId: assetId as string, stillState: 'uploaded' })
      .onConflictDoUpdate({
        target: scenes.sceneNodeId,
        set: { stillAssetId: assetId as string, stillState: 'uploaded', updatedAt: new Date() },
      })
    await logActivity(tx, scope, 'scene.still.upload', 'scene', sceneNodeId as string, { assetId })
  })
}

// ---------------------------------------------------------------------------
// Notes and preferences
// ---------------------------------------------------------------------------

/** Append a note; an empty body is the popover's `Remove`, written as an empty latest note. */
export const appendNote = async (scope: ProjectScope, targetType: NoteTarget, targetId: string, body: string): Promise<void> => {
  await dbOf(scope).insert(notes).values({ ...tenant(scope), targetType, targetId, body, authorId: scope.actor })
}

export const saveViewPreferences = async (scope: ProjectScope, episodeId: EpisodeId, patch: ViewPreferencesPatch): Promise<ViewPreferences> => {
  if (scope.actor === null) return DEFAULT_VIEW_PREFERENCES
  const current = await readPreferences(scope, episodeId)
  const next: ViewPreferences = {
    view: patch.view ?? current.view,
    fieldVisibility: { ...current.fieldVisibility, ...(patch.fieldVisibility ?? {}) },
    fieldOrder: patch.fieldOrder ?? current.fieldOrder,
    statusFilter: patch.statusFilter ?? current.statusFilter,
    unassignedOnly: patch.unassignedOnly ?? current.unassignedOnly,
    sort: patch.sort ?? current.sort,
  }
  const values = {
    view: next.view,
    fieldVisibility: jsonb(next.fieldVisibility),
    fieldOrder: [...next.fieldOrder],
    statusFilter: next.statusFilter,
    unassignedOnly: next.unassignedOnly,
    sort: next.sort,
    updatedAt: new Date(),
  }
  await dbOf(scope)
    .insert(viewPreferences)
    .values({ ...tenant(scope), userId: scope.actor, episodeId: episodeId as string, ...values })
    .onConflictDoUpdate({ target: [viewPreferences.userId, viewPreferences.episodeId], set: values })
  return next
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export const insertAsset = async (
  scope: ProjectScope,
  asset: { readonly kind: AssetKind; readonly storageKey: string; readonly mime: string; readonly width: number | null; readonly height: number | null; readonly source: Asset['source'] },
): Promise<AssetRecord> => {
  const rows = await dbOf(scope)
    .insert(assets)
    .values({ ...tenant(scope), ...asset, uploadedBy: asset.source === 'uploaded' ? scope.actor : null })
    .returning()
  const row = rows[0]
  if (row === undefined) throw new Error('Folio: inserting an asset returned no row.')
  return assetFromRow(row)
}

// ---------------------------------------------------------------------------
// Generations: reserve, run, settle
// ---------------------------------------------------------------------------

export type GenerationSeed = {
  readonly episodeId: EpisodeId
  readonly targetType: GenerationTarget
  readonly targetId: string
  readonly job: GenerationJob
  readonly cost: number
  readonly prompt: unknown
  readonly settingsSnapshot: unknown
  readonly route: string | null
  readonly sourceHash: string | null
}

export type CreateGenerationResult =
  | { readonly status: 'created'; readonly generation: Generation }
  | { readonly status: 'insufficient'; readonly available: number; readonly cost: number }

/** Reserve then create, in one statement - see the header. Then the target is marked queued. */
export const createGeneration = async (scope: ProjectScope, seed: GenerationSeed): Promise<CreateGenerationResult> => {
  const project = scope.projectId as string
  const actor = scope.actor as string | null
  const rows = await dbOf(scope).execute<{ readonly id: string | null; readonly available: number }>(sql`
    with settled as (
      select coalesce(sum(${creditLedger.delta}), 0)::int as total
      from ${creditLedger} where ${creditLedger.projectId} = ${project}
        and ${creditLedger.kind} not in ('reserve', 'release')
    ),
    held as (
      select coalesce(sum(l.delta), 0)::int as total
      from ${creditLedger} as l
      where l.project_id = ${project} and l.kind = 'reserve'
        and not exists (
          select 1 from ${creditLedger} as c
          where c.project_id = l.project_id
            and c.job_id is not distinct from l.job_id
            and c.kind in ('release', 'spend')
        )
    ),
    balance as (select (settled.total + held.total) as available from settled, held),
    created as (
      insert into ${generations} (project_id, episode_id, target_type, target_id, job, state, prompt, settings_snapshot, credits_reserved, route, source_hash, created_by)
      select ${project}, ${seed.episodeId}, ${seed.targetType}, ${seed.targetId}::uuid, ${seed.job}, 'queued',
             ${JSON.stringify(seed.prompt)}::jsonb, ${JSON.stringify(seed.settingsSnapshot)}::jsonb, ${seed.cost}, ${seed.route}, ${seed.sourceHash}, ${actor}::uuid
      from balance where balance.available >= ${seed.cost}
      returning id
    ),
    reserved as (
      insert into ${creditLedger} (project_id, kind, delta, job_id, idempotency_key, reason, created_by)
      select ${project}, 'reserve', ${-seed.cost}, created.id, 'reserve:job:' || created.id::text, ${`Reserved for ${seed.job}`}, ${actor}::uuid
      from created where ${seed.cost} > 0
      on conflict (project_id, idempotency_key) do nothing
      returning id
    )
    select (select id from created) as id, (select available from balance) as available
  `)
  const row = rows[0]
  if (row === undefined) throw new Error('Folio: creating a generation returned no row.')
  if (row.id === null) return { status: 'insufficient', available: row.available, cost: seed.cost }
  const generation = await readGeneration(scope, row.id as ProductionGenerationId)
  if (generation === null) throw new Error('Folio: the created generation could not be read back.')
  await markTarget(dbOf(scope), scope, generation, 'queued')
  return { status: 'created', generation }
}

export const readGeneration = async (scope: ProjectScope, id: ProductionGenerationId): Promise<Generation | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(generations)
    .where(scoped(scope, generations, eq(generations.id, id)))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : generationFromRow(row)
}

/** What the target shows while a generation is queued or running. */
const markTarget = async (db: Db, scope: ProjectScope, generation: Generation, phase: 'queued' | 'running'): Promise<void> => {
  const now = new Date()
  switch (generation.job) {
    case 'shot_frame':
      await db
        .update(reelShots)
        .set({ frameState: phase === 'queued' ? 'queued' : 'gen', frameProgress: phase === 'queued' ? null : 0, updatedAt: now })
        .where(scoped(scope, reelShots, eq(reelShots.id, generation.targetId)))
      return
    case 'storyboard_sheet':
      await db
        .insert(storyboardSheets)
        .values({ ...tenant(scope), reelId: generation.targetId, state: 'gen', progress: 0, generationId: generation.id as string })
        .onConflictDoUpdate({
          target: storyboardSheets.reelId,
          set: { state: 'gen', progress: 0, generationId: generation.id as string, updatedAt: now },
        })
      return
    case 'scene_image':
      await db
        .insert(scenes)
        .values({ ...tenant(scope), sceneNodeId: generation.targetId, stillState: phase === 'queued' ? 'queued' : 'gen' })
        .onConflictDoUpdate({ target: scenes.sceneNodeId, set: { stillState: phase === 'queued' ? 'queued' : 'gen', updatedAt: now } })
      return
    case 'shoot_reel':
      await db
        .update(reels)
        .set({ status: 'generating', updatedAt: now })
        .where(scoped(scope, reels, eq(reels.id, generation.targetId)))
      if (phase === 'queued') {
        const version = await db
          .select({ max: sql<number>`coalesce(max(${clips.version}), 0)::int` })
          .from(clips)
          .where(scoped(scope, clips, eq(clips.reelId, generation.targetId)))
        await db.insert(clips).values({
          ...tenant(scope),
          reelId: generation.targetId,
          state: 'queued',
          version: (version[0]?.max ?? 0) + 1,
          generationId: generation.id as string,
        })
      } else {
        await db
          .update(clips)
          .set({ state: 'generating' })
          .where(scoped(scope, clips, eq(clips.generationId, generation.id as string)))
      }
      return
    default:
      return
  }
}

export const startGeneration = async (scope: ProjectScope, id: ProductionGenerationId): Promise<Generation | null> => {
  return dbOf(scope).transaction(async (tx) => {
    const rows = await tx
      .update(generations)
      .set({ state: 'running', startedAt: new Date(), progress: 0 })
      .where(scoped(scope, generations, eq(generations.id, id), eq(generations.state, 'queued')))
      .returning()
    const row = rows[0]
    if (row === undefined) return null
    const generation = generationFromRow(row)
    await markTarget(tx, scope, generation, 'running')
    return generation
  })
}

export const progressGeneration = async (scope: ProjectScope, id: ProductionGenerationId, progress: number): Promise<void> => {
  const pct = Math.max(0, Math.min(100, Math.round(progress)))
  await dbOf(scope).transaction(async (tx) => {
    const rows = await tx
      .update(generations)
      .set({ progress: pct })
      .where(scoped(scope, generations, eq(generations.id, id), eq(generations.state, 'running')))
      .returning({ job: generations.job, targetId: generations.targetId })
    const row = rows[0]
    if (row === undefined) return
    if (row.job === 'shot_frame') {
      await tx.update(reelShots).set({ frameProgress: pct }).where(scoped(scope, reelShots, eq(reelShots.id, row.targetId)))
    } else if (row.job === 'storyboard_sheet') {
      await tx.update(storyboardSheets).set({ progress: pct }).where(scoped(scope, storyboardSheets, eq(storyboardSheets.reelId, row.targetId)))
    }
  })
}

/** What a finished generation produced, by job. */
export type GenerationOutcome =
  | { readonly job: 'shot_frame'; readonly asset: AssetId }
  | {
      readonly job: 'storyboard_sheet'
      readonly asset: AssetId
      readonly artStyleId: ArtStyleId | null
      readonly frames: readonly { readonly shotId: ReelShotId; readonly heading: string; readonly cameraNote: string; readonly timeFromS: number; readonly timeToS: number }[]
    }
  | { readonly job: 'scene_image'; readonly asset: AssetId }
  | { readonly job: 'shoot_reel'; readonly video: AssetId; readonly poster: AssetId | null }
  | { readonly job: 'ai_shotlist' | 'propose_shots' | 'character_look' }

/** The ledger row that closes the reservation: `spend` when the work ran, `release` when it did not. Idempotent on the generation. */
const closeReservation = async (db: Db, scope: ProjectScope, generation: Generation, kind: 'spend' | 'release', reason: string): Promise<void> => {
  if (generation.creditsReserved <= 0) return
  await db
    .insert(creditLedger)
    .values({
      ...tenant(scope),
      kind,
      delta: kind === 'spend' ? -generation.creditsReserved : generation.creditsReserved,
      jobId: generation.id as string,
      idempotencyKey: `${kind}:job:${generation.id}`,
      reason,
      createdBy: scope.actor,
    })
    .onConflictDoNothing({ target: [creditLedger.projectId, creditLedger.idempotencyKey] })
}

const finishGeneration = async (
  db: Db,
  scope: ProjectScope,
  id: ProductionGenerationId,
  set: Partial<typeof generations.$inferInsert>,
): Promise<Generation | null> => {
  const rows = await db
    .update(generations)
    .set({ ...set, finishedAt: new Date() })
    .where(scoped(scope, generations, eq(generations.id, id), inArray(generations.state, ['queued', 'running'])))
    .returning()
  const row = rows[0]
  return row === undefined ? null : generationFromRow(row)
}

export const succeedGeneration = async (scope: ProjectScope, id: ProductionGenerationId, outcome: GenerationOutcome): Promise<Generation | null> => {
  return dbOf(scope).transaction(async (tx) => {
    const before = await readGeneration(scope, id)
    if (before === null) return null
    const generation = await finishGeneration(tx, scope, id, { state: 'succeeded', progress: 100, creditsCharged: before.creditsReserved })
    if (generation === null) return null
    await closeReservation(tx, scope, generation, 'spend', `Spent on ${generation.job}`)
    const now = new Date()
    switch (outcome.job) {
      case 'shot_frame':
        await tx
          .update(reelShots)
          .set({ frameState: 'drawn', frameAssetId: outcome.asset as string, frameProgress: null, blocked: false, blockReason: null, updatedAt: now })
          .where(scoped(scope, reelShots, eq(reelShots.id, generation.targetId)))
        break
      case 'storyboard_sheet': {
        const sheets = await tx
          .insert(storyboardSheets)
          .values({
            ...tenant(scope),
            reelId: generation.targetId,
            state: 'done',
            assetId: outcome.asset as string,
            progress: null,
            generatedAt: now,
            creditsSpent: generation.creditsReserved,
            artStyleId: outcome.artStyleId === null ? null : (outcome.artStyleId as string),
            generationId: generation.id as string,
          })
          .onConflictDoUpdate({
            target: storyboardSheets.reelId,
            set: {
              state: 'done',
              assetId: outcome.asset as string,
              progress: null,
              generatedAt: now,
              creditsSpent: generation.creditsReserved,
              artStyleId: outcome.artStyleId === null ? null : (outcome.artStyleId as string),
              generationId: generation.id as string,
              updatedAt: now,
            },
          })
          .returning({ id: storyboardSheets.id })
        const sheetId = sheets[0]?.id
        if (sheetId !== undefined) {
          await tx.delete(storyboardFrames).where(scoped(scope, storyboardFrames, eq(storyboardFrames.sheetId, sheetId)))
          if (outcome.frames.length > 0) {
            await tx.insert(storyboardFrames).values(
              outcome.frames.map((frame, position) => ({
                ...tenant(scope),
                sheetId,
                shotId: frame.shotId as string,
                position,
                heading: frame.heading,
                cameraNote: frame.cameraNote,
                timeFromS: frame.timeFromS,
                timeToS: frame.timeToS,
              })),
            )
          }
        }
        // A redrawn sheet after a render: the clip no longer shows what the sheet does.
        await staleReel(tx, scope, generation.targetId as ReelId)
        break
      }
      case 'scene_image':
        await tx
          .insert(scenes)
          .values({ ...tenant(scope), sceneNodeId: generation.targetId, stillAssetId: outcome.asset as string, stillState: 'drawn' })
          .onConflictDoUpdate({ target: scenes.sceneNodeId, set: { stillAssetId: outcome.asset as string, stillState: 'drawn', updatedAt: now } })
        break
      case 'shoot_reel':
        await tx
          .update(clips)
          .set({ state: 'rendered', videoAssetId: outcome.video as string, posterAssetId: outcome.poster === null ? null : (outcome.poster as string), creditsSpent: generation.creditsReserved })
          .where(scoped(scope, clips, eq(clips.generationId, generation.id as string)))
        await tx
          .update(reels)
          .set({ status: 'rendered', finalized: true, updatedAt: now })
          .where(scoped(scope, reels, eq(reels.id, generation.targetId)))
        // The first successful shoot locks the episode's settings - the spec's rule 4.
        await tx
          .update(episodeSettings)
          .set({ lockedAt: now, updatedAt: now })
          .where(scoped(scope, episodeSettings, eq(episodeSettings.episodeId, generation.episodeId), isNull(episodeSettings.lockedAt)))
        break
      default:
        break
    }
    await logActivity(tx, scope, 'generation.succeeded', generation.targetType, generation.targetId, { job: generation.job })
    return generation
  })
}

/** Put the target back where a generation that did not finish leaves it. */
const unmarkTarget = async (db: Db, scope: ProjectScope, generation: Generation, end: 'refused' | 'failed' | 'cancelled', reason: string | null): Promise<void> => {
  const now = new Date()
  switch (generation.job) {
    case 'shot_frame':
      await db
        .update(reelShots)
        .set({
          frameState: end === 'refused' ? 'blocked' : end,
          frameProgress: null,
          ...(end === 'refused' ? { blocked: true, blockReason: reason ?? 'The model refused this shot.' } : {}),
          updatedAt: now,
        })
        .where(scoped(scope, reelShots, eq(reelShots.id, generation.targetId)))
      return
    case 'storyboard_sheet': {
      // Back to what it was: done if a sheet image exists, none otherwise.
      await db.execute(sql`
        update ${storyboardSheets} set state = case when asset_id is null then 'none'::sheet_state else 'done'::sheet_state end, progress = null, updated_at = now()
        where ${scoped(scope, storyboardSheets, eq(storyboardSheets.reelId, generation.targetId))}
      `)
      return
    }
    case 'scene_image':
      await db.execute(sql`
        update ${scenes} set still_state = case
          when ${end === 'refused'} then 'blocked'::frame_state
          when still_asset_id is not null then 'drawn'::frame_state
          else ${end}::frame_state end, updated_at = now()
        where ${scoped(scope, scenes, eq(scenes.sceneNodeId, generation.targetId))}
      `)
      return
    case 'shoot_reel':
      await db
        .update(clips)
        .set({ state: end === 'refused' ? 'failed' : end })
        .where(scoped(scope, clips, eq(clips.generationId, generation.id as string)))
      await db.execute(sql`
        update ${reels} set status = case when exists (
          select 1 from ${clips} where reel_id = ${generation.targetId} and state = 'rendered'
        ) then 'rendered'::reel_status else 'writing'::reel_status end, updated_at = now()
        where ${scoped(scope, reels, eq(reels.id, generation.targetId))}
      `)
      return
    default:
      return
  }
}

export const refuseGeneration = async (scope: ProjectScope, id: ProductionGenerationId, reason: string): Promise<Generation | null> => {
  return dbOf(scope).transaction(async (tx) => {
    const generation = await finishGeneration(tx, scope, id, { state: 'refused', refusalReason: reason })
    if (generation === null) return null
    await closeReservation(tx, scope, generation, 'release', `Refunded: ${generation.job} refused`)
    await unmarkTarget(tx, scope, generation, 'refused', reason)
    await logActivity(tx, scope, 'generation.refused', generation.targetType, generation.targetId, { job: generation.job, reason })
    return generation
  })
}

export const failGeneration = async (scope: ProjectScope, id: ProductionGenerationId, error: string): Promise<Generation | null> => {
  return dbOf(scope).transaction(async (tx) => {
    const generation = await finishGeneration(tx, scope, id, { state: 'failed', error })
    if (generation === null) return null
    await closeReservation(tx, scope, generation, 'release', `Refunded: ${generation.job} failed`)
    await unmarkTarget(tx, scope, generation, 'failed', null)
    await logActivity(tx, scope, 'generation.failed', generation.targetType, generation.targetId, { job: generation.job, error })
    return generation
  })
}

export type CancelGenerationResult = { readonly status: 'cancelled'; readonly generation: Generation } | { readonly status: 'already-over' } | { readonly status: 'no-generation' }

export const cancelGeneration = async (scope: ProjectScope, id: ProductionGenerationId): Promise<CancelGenerationResult> => {
  return dbOf(scope).transaction(async (tx) => {
    const before = await readGeneration(scope, id)
    if (before === null) return { status: 'no-generation' }
    const generation = await finishGeneration(tx, scope, id, { state: 'cancelled' })
    if (generation === null) return { status: 'already-over' }
    await closeReservation(tx, scope, generation, 'release', `Released: ${generation.job} cancelled`)
    await unmarkTarget(tx, scope, generation, 'cancelled', null)
    await logActivity(tx, scope, 'generation.cancelled', generation.targetType, generation.targetId, { job: generation.job })
    return { status: 'cancelled', generation }
  })
}

/** The one running generation for a target, if any - what the buttons disable on. */
export const readLiveGenerationFor = async (scope: ProjectScope, targetType: GenerationTarget, targetId: string): Promise<Generation | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(generations)
    .where(scoped(scope, generations, eq(generations.targetType, targetType), eq(generations.targetId, targetId), inArray(generations.state, ['queued', 'running'])))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : generationFromRow(row)
}

/** A status override written straight, for a seed or a test. Callers in the app go through `patchShot`. */
export const setShotStatus = async (scope: ProjectScope, shotId: ReelShotId, status: ShotStatus | null): Promise<void> => {
  await dbOf(scope).update(reelShots).set({ status, updatedAt: new Date() }).where(scoped(scope, reelShots, eq(reelShots.id, shotId)))
}

/** A reel status written straight, for a seed. The app moves status through the generation lifecycle. */
export const setReelStatus = async (scope: ProjectScope, reelId: ReelId, status: ReelStatus): Promise<void> => {
  await dbOf(scope).update(reels).set({ status, updatedAt: new Date() }).where(scoped(scope, reels, eq(reels.id, reelId)))
}
