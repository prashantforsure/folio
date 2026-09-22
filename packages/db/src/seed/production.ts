import type { ProjectId, UserId } from '@folio/contracts'
import { DEFAULT_ART_STYLE_KEY, GENERATION_COSTS, projectId as brandProjectId, userId as brandUserId } from '@folio/contracts'
import type { CharacterId, NodeId, ScreenplayNode } from '@folio/script'
import { countDerivationIds, derive, parseDescription, parseFountain } from '@folio/script'
import { eq, sql } from 'drizzle-orm'
import { createHash, createHmac } from 'node:crypto'

import { closeDatabases, sessionDatabase } from '../client'
import { openProjectForWorker } from '../repositories'
import { commitDerivation } from '../repositories/derived'
import { persistMintedRecords, readDerivationInput } from '../repositories/derivation'
import { createDocument, readProjectScreenplayNodes, replaceNodes } from '../repositories/documents'
import {
  createGeneration,
  insertAsset,
  insertReel,
  insertReelShots,
  progressGeneration,
  refuseGeneration,
  startGeneration,
  succeedGeneration,
  upsertEpisodeSettings,
} from '../repositories/production'
import { ensureSceneRecords } from '../repositories/scenes'
import { createProjectFor } from '../repositories/users'
import { artStyles, characters, creditLedger, episodes, locations, projects, reelShots, reels, scenes, users } from '../schema'
import type { ProjectScope } from '../scope'
import { dbOf, scoped } from '../scope'

/**
 * The dev-only Production seed: `folio-data-v4.js` (the v12 mockup's sample
 * data) as a real project, so every state the mockup shows exists in the
 * dev database - the rendered reel, the authoring reel with a proposed
 * shot, the generating reel with a refused shot, the reel with no shots,
 * the out-of-date reel, the empty scene, and the character with no
 * appearance reference (Old man) that blocks readiness. The 14 art-style
 * presets are the migration's; the seed asserts them.
 *
 *   pnpm --filter @folio/db seed:production -- --user <email>
 *
 * The script goes in through the same path the app uses - `parseFountain`,
 * `replaceNodes`, a derivation pass - so the scenes, cast and locations are
 * derived exactly as the app would derive them; only the Production rows
 * (and the portraits / plate that stand for appearance references) are
 * written directly. Re-running for the same user finds the project by
 * title and starts over on a fresh one, so the states are always the
 * mockup's. Portraits, the plate, the frames, the sheets and the stills
 * are 1×1 PNGs when `R2_*` is set; without storage the rows point at keys
 * nothing serves and the UI draws its plates, which is the honest state.
 */

const TITLE = 'Monsoon Line'

const SCRIPT = `Title: Monsoon Line
Credit: Written by
Author: Folio seed

EXT. COMMUNITY PITCH - DUSK

The cage under the floodlights. Rain just stopped. An OLD MAN sits on the bench at the touchline, a flat ball at his feet.

ADE
It's flat.

OLD MAN
(not looking up)
Everything's flat round here.

INT. ADE'S KITCHEN - NIGHT

A strip light over a small table. ADE eats standing up, boots still on, the bag by the door where he dropped it.

ADE
I'm not going back.

EXT. COMMUNITY PITCH - NIGHT

One floodlight dead. ADE runs the cage alone. NIA watches from the fence, hood up, saying nothing.

NIA
You'll wreck that knee.

INT. BUS SHELTER - DAWN

First light. ADE asleep sitting up, the bag across his lap, the flat ball under the bench.

EXT. COMMUNITY PITCH - DAY

Daylight. The cage empty, the puddles gone. ADE arrives with a pump in his hand and nothing to prove to anyone.

ADE
Right.
`

const CAM = 'ARRI Alexa Mini LF'

type Seed = {
  readonly cam: readonly [type: 'Wide angle' | 'Medium' | 'Close-up', angle: string, motion: 'Still' | 'Handheld', lens: string]
  readonly s: number
  readonly d: string
  readonly frame?: 'drawn' | 'ready' | 'empty' | 'stale'
  readonly proposed?: boolean
  readonly blocked?: string
  readonly gen?: 'running' | 'queued'
}

const S1R1: readonly Seed[] = [
  { cam: ['Wide angle', 'Eye level', 'Still', '24mm T2.8'], s: 4, frame: 'drawn', d: 'The cage under the floodlights, rain just stopped. @Old man on the bench at the touchline, a flat ball at his feet.' },
  { cam: ['Medium', 'Eye level', 'Handheld', '35mm T2.0'], s: 3, frame: 'drawn', d: '@Ade at the gate, bag on one shoulder, looking at the ball and not the man.' },
  { cam: ['Close-up', 'Low', 'Still', '50mm T2.0'], s: 5, frame: 'drawn', d: 'The old man taps the flat ball toward @Ade; it barely rolls.' },
  { cam: ['Medium', 'Eye level', 'Handheld', '35mm T2.0'], s: 3, frame: 'drawn', d: '@Ade stops it with the taped boot. Doesn’t look up. “It’s flat.”' },
]
const S1R2: readonly Seed[] = [
  { cam: ['Wide angle', 'Eye level', 'Still', '24mm T2.8'], s: 4, frame: 'drawn', d: 'The two of them from behind the fence, the ball dead between them.' },
  { cam: ['Medium', 'Eye level', 'Handheld', '35mm T2.0'], s: 3, frame: 'ready', d: '@Ade picks the ball up, turns it over, finds the split in the seam.' },
  { cam: ['Close-up', 'Eye level', 'Still', '50mm T2.0'], s: 3, frame: 'empty', proposed: true, d: 'The old man watches him find it, and says nothing.' },
]
const S3R1: readonly Seed[] = [
  { cam: ['Wide angle', 'High', 'Still', '24mm T2.8'], s: 4, frame: 'drawn', d: 'The cage at night, one floodlight dead. Rain on the chain fence.' },
  { cam: ['Medium', 'Eye level', 'Handheld', '35mm T2.0'], s: 4, gen: 'running', d: '@Ade runs the length of the cage with the ball, faster than he needs to.' },
  { cam: ['Close-up', 'Low', 'Still', '50mm T2.0'], s: 4, gen: 'queued', d: '@Nia at the fence, fingers through the links, not calling out.' },
  { cam: ['Medium', 'Eye level', 'Handheld', '35mm T2.0'], s: 3, blocked: 'The model refused this shot: violence. Rewrite the shot or remove the blood.', d: '@Ade goes down on the wet concrete and comes up with his knee opened.' },
]
const S5R1: readonly Seed[] = [
  { cam: ['Wide angle', 'Eye level', 'Still', '24mm T2.8'], s: 5, frame: 'stale', d: 'Daylight on the pitch. The puddles gone, the ball still flat on the spot.' },
  { cam: ['Medium', 'Eye level', 'Still', '35mm T2.8'], s: 5, frame: 'stale', d: '@Ade pumps the ball at the fence, counting strokes under his breath.' },
  { cam: ['Wide angle', 'Low', 'Still', '24mm T4.0'], s: 5, frame: 'drawn', d: 'He drops it, strikes it clean, and it finally flies.' },
]

/** A 1×1 PNG of one colour, so storage has a real object without any image library. */
const png1x1 = (r: number, g: number, b: number): Uint8Array => {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (bytes: Uint8Array): number => {
    let c = 0xffffffff
    for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = new Uint8Array(13)
  const iv = new DataView(ihdr.buffer)
  iv.setUint32(0, 1)
  iv.setUint32(4, 1)
  ihdr.set([8, 2, 0, 0, 0], 8)
  // One scanline: filter byte 0 then RGB, deflated as a stored block.
  const raw = new Uint8Array([0, r, g, b])
  const adler = (() => {
    let a = 1
    let s = 0
    for (const byte of raw) {
      a = (a + byte) % 65521
      s = (s + a) % 65521
    }
    return ((s << 16) | a) >>> 0
  })()
  const idat = new Uint8Array(2 + 5 + raw.length + 4)
  idat.set([0x78, 0x01, 0x01, raw.length, 0, (~raw.length) & 0xff, 0xff], 0)
  idat.set(raw, 7)
  new DataView(idat.buffer).setUint32(7 + raw.length, adler)
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/**
 * AWS SigV4 for one S3 PUT, with node:crypto - the seed is this package's
 * and `aws4fetch` is the web app's dependency. Region `auto`, service
 * `s3`, the body hashed, as R2 expects.
 */
const signS3Put = (input: {
  readonly host: string
  readonly path: string
  readonly bytes: Uint8Array
  readonly mime: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
}): Record<string, string> => {
  const sha = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex')
  const hmac = (key: Uint8Array | string, data: string): Buffer => createHmac('sha256', key).update(data).digest()
  const now = new Date()
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const date = amzDate.slice(0, 8)
  const payloadHash = sha(input.bytes)
  const encodedPath = input.path.split('/').map((part) => encodeURIComponent(part)).join('/')
  const headers: Record<string, string> = {
    host: input.host,
    'content-type': input.mime,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }
  const signedHeaders = Object.keys(headers).sort().join(';')
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name] ?? ''}\n`)
    .join('')
  const canonicalRequest = ['PUT', encodedPath, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const credentialScope = `${date}/auto/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha(canonicalRequest)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), 'auto'), 's3'), 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

const arg = (name: string): string | null => {
  const at = process.argv.indexOf(`--${name}`)
  return at < 0 ? null : (process.argv[at + 1] ?? null)
}

const log = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const main = async (): Promise<void> => {
  const email = arg('user')
  if (email === null) throw new Error('Usage: seed:production -- --user <email>')
  const db = await sessionDatabase()
  const userRows = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  const user = userRows[0]
  if (user === undefined) throw new Error(`No user with the email ${email}. Sign up in the app first.`)
  const actor: UserId = brandUserId(user.id)

  // Storage: the same env gate the app uses, read here without the web layer.
  const { storageEnv } = await import('../env')
  const put = async (key: string, bytes: Uint8Array, mime: string): Promise<boolean> => {
    if (storageEnv === null) return false
    const host = `${storageEnv.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    const response = await fetch(`https://${host}/${storageEnv.R2_BUCKET}/${key}`, {
      method: 'PUT',
      body: bytes,
      headers: signS3Put({ host, path: `/${storageEnv.R2_BUCKET}/${key}`, bytes, mime, accessKeyId: storageEnv.R2_ACCESS_KEY_ID, secretAccessKey: storageEnv.R2_SECRET_ACCESS_KEY }),
    })
    if (!response.ok) log(`storage refused ${key}: ${String(response.status)}`)
    return response.ok
  }

  // A fresh project every run: the previous one of this title goes to the bin.
  await db
    .update(projects)
    .set({ trashedAt: new Date(), title: `${TITLE} (replaced ${new Date().toISOString().slice(0, 16)})` })
    .where(sql`${projects.title} = ${TITLE} and ${projects.createdBy} = ${actor} and ${projects.trashedAt} is null`)
  const created = await createProjectFor(db, actor, { title: TITLE, kind: 'screenwriting', projectType: 'series', format: 'hollywood' })
  const projectId: ProjectId = brandProjectId(created.project.id)
  const scope: ProjectScope = await openProjectForWorker(projectId, actor)
  log(`project ${projectId} (episode ${created.episode.slug})`)

  // The script, the app's way.
  const document = await createDocument(scope, created.episode.id, 'screenplay', TITLE)
  const parsed = parseFountain(SCRIPT, { freshIds: Array.from({ length: 200 }, () => crypto.randomUUID() as NodeId) })
  if (!parsed.ok) throw new Error(`The seed script would not parse: ${JSON.stringify(parsed.error)}`)
  const nodes: readonly ScreenplayNode[] = parsed.value.nodes
  await replaceNodes(scope, document.id, 'screenplay', nodes)
  const all = await readProjectScreenplayNodes(scope)
  if (!all.ok) throw new Error('The stored script would not read back.')
  const previous = await readDerivationInput(scope)
  const pass = derive(all.value, previous, { freshIds: Array.from({ length: countDerivationIds(all.value, previous) }, () => crypto.randomUUID()) })
  if (!pass.ok) throw new Error(`Derivation refused: ${JSON.stringify(pass.error)}`)
  await Promise.all([persistMintedRecords(scope, pass.value.minted), ensureSceneRecords(scope, pass.value.entities.scenes)])
  await commitDerivation(scope, pass.value.entities)
  const sceneIds = pass.value.entities.scenes.filter((scene) => scene.presence === 'present').map((scene) => scene.id)
  log(`script: ${String(nodes.length)} nodes, ${String(sceneIds.length)} scenes`)

  // Cast: the pass minted ADE, OLD MAN and NIA. Portraits for two of them - the appearance reference, by the ruling.
  const castRows = await dbOf(scope).select({ id: characters.id, name: characters.name }).from(characters).where(scoped(scope, characters))
  const byName = new Map(castRows.map((row) => [row.name.toLowerCase(), row.id as CharacterId]))
  const names = castRows.map((row) => ({ id: row.id as CharacterId, name: row.name }))
  const portrait = async (name: string, rgb: readonly [number, number, number]): Promise<void> => {
    const id = byName.get(name.toLowerCase())
    if (id === undefined) throw new Error(`The pass minted no record for ${name}.`)
    const key = `projects/${projectId}/characters/${id}/portrait-${crypto.randomUUID()}.png`
    await put(key, png1x1(...rgb), 'image/png')
    await dbOf(scope)
      .update(characters)
      .set({ portraitKey: key, appearance: name === 'Ade' ? 'seventeen, wiry, close-cropped hair, a faded green training top two sizes too big, taped-up boots' : 'sixteen, braided hair, school blazer pulled over a tracksuit, phone always in hand' })
      .where(scoped(scope, characters, eq(characters.id, id)))
  }
  // The pass names a record by its cue; the mockup's names are the writer's. A rename keeps the cue bound.
  for (const [cue, name] of [['ade', 'Ade'], ['nia', 'Nia'], ['old man', 'Old man']] as const) {
    const id = byName.get(cue)
    if (id !== undefined) await dbOf(scope).update(characters).set({ name }).where(scoped(scope, characters, eq(characters.id, id)))
  }
  for (const name of names) (name as { name: string }).name = name.name === 'ADE' ? 'Ade' : name.name === 'NIA' ? 'Nia' : name.name === 'OLD MAN' ? 'Old man' : name.name
  await portrait('Ade', [92, 70, 140])
  await portrait('Nia', [60, 120, 90])
  const oldMan = byName.get('old man')
  if (oldMan !== undefined) {
    await dbOf(scope).update(characters).set({ appearance: 'sixties, heavy coat, flat cap, hands that never leave his pockets' }).where(scoped(scope, characters, eq(characters.id, oldMan)))
  }

  // The plate: the pitch's photo. The kitchen and the bus shelter have none.
  const placeRows = await dbOf(scope).select({ id: locations.id, name: locations.name }).from(locations).where(scoped(scope, locations))
  const pitch = placeRows.find((row) => /community pitch/i.test(row.name))
  if (pitch !== undefined) {
    const key = `projects/${projectId}/locations/${pitch.id}/photo-${crypto.randomUUID()}.png`
    await put(key, png1x1(70, 90, 70), 'image/png')
    await dbOf(scope).update(locations).set({ photoKey: key }).where(scoped(scope, locations, eq(locations.id, pitch.id)))
  }

  // Settings: the mockup's defaults.
  const preset = (await dbOf(scope).select().from(artStyles).where(eq(artStyles.key, DEFAULT_ART_STYLE_KEY)).limit(1))[0]
  if (preset === undefined) throw new Error('The art-style presets are missing - run the migrations first (0026 seeds them).')
  const presetCount = await dbOf(scope).select({ n: sql<number>`count(*)::int` }).from(artStyles).where(eq(artStyles.isPreset, true))
  if ((presetCount[0]?.n ?? 0) !== 14) throw new Error(`Expected 14 art-style presets, found ${String(presetCount[0]?.n ?? 0)}.`)
  await upsertEpisodeSettings(scope, created.episode.id, {
    aspectRatio: '16:9 landscape',
    productionType: 'Narrative',
    cameraStyle: 'Academy',
    pacing: 'Balanced',
    lighting: 'Motivated',
    artStyleId: preset.id as never,
  })

  // Credits, so the live generations below can hold theirs.
  await db.insert(creditLedger).values({ projectId: projectId as string, kind: 'grant', delta: 2000, idempotencyKey: `seed:grant:${projectId}`, reason: 'Production seed', createdBy: actor as string })

  const asset = async (kind: 'frame' | 'sheet' | 'still' | 'clip', rgb: readonly [number, number, number]): Promise<string> => {
    const ext = kind === 'clip' ? 'mp4' : 'png'
    const key = `projects/${projectId}/production/${kind}/${crypto.randomUUID()}.${ext}`
    if (kind !== 'clip') await put(key, png1x1(...rgb), 'image/png')
    const row = await insertAsset(scope, { kind, storageKey: key, mime: kind === 'clip' ? 'video/mp4' : 'image/png', width: 1, height: 1, source: 'generated' })
    return row.id as string
  }

  const [s1, , s3, s4, s5] = sceneIds
  if (s1 === undefined || s3 === undefined || s4 === undefined || s5 === undefined) throw new Error('Five scenes were expected.')

  const seedReel = async (sceneId: NodeId, name: string, clip: 5 | 8 | 10 | 15, seeds: readonly Seed[]) => {
    const reel = await insertReel(scope, sceneId, name)
    await dbOf(scope).update(reels).set({ clipLengthS: clip }).where(scoped(scope, reels, eq(reels.id, reel.id)))
    const shots = await insertReelShots(
      scope,
      reel.id,
      seeds.map((seed) => ({
        description: seed.d,
        parts: parseDescription(seed.d, names),
        durationS: seed.s,
        shotType: seed.cam[0],
        cameraAngle: seed.cam[1],
        cameraMotion: seed.cam[2],
        cameraBody: CAM,
        lens: seed.cam[3],
        proposed: seed.proposed ?? false,
        frameState: seed.frame ?? 'ready',
      })),
    )
    for (const [index, seed] of seeds.entries()) {
      const shot = shots[index]
      if (shot === undefined) continue
      if (seed.frame === 'drawn' || seed.frame === 'stale') {
        const id = await asset('frame', [40 + index * 30, 60, 120])
        await dbOf(scope)
          .update(reelShots)
          .set({ frameAssetId: id, frameState: seed.frame, frameKept: true, takeIndex: [1, 1] })
          .where(scoped(scope, reelShots, eq(reelShots.id, shot.id)))
      }
      if (seed.gen !== undefined) {
        const made = await createGeneration(scope, {
          episodeId: created.episode.id,
          targetType: 'shot',
          targetId: shot.id,
          job: 'shot_frame',
          cost: GENERATION_COSTS.shot_frame,
          prompt: { text: seed.d },
          settingsSnapshot: {},
          route: 'seed',
          sourceHash: null,
        })
        if (made.status !== 'created') throw new Error('The seed could not hold credits for a frame.')
        if (seed.gen === 'running') {
          await startGeneration(scope, made.generation.id)
          await progressGeneration(scope, made.generation.id, 62)
        }
      }
      if (seed.blocked !== undefined) {
        const made = await createGeneration(scope, {
          episodeId: created.episode.id,
          targetType: 'shot',
          targetId: shot.id,
          job: 'shot_frame',
          cost: GENERATION_COSTS.shot_frame,
          prompt: { text: seed.d },
          settingsSnapshot: {},
          route: 'seed',
          sourceHash: null,
        })
        if (made.status !== 'created') throw new Error('The seed could not hold credits for the refused frame.')
        await startGeneration(scope, made.generation.id)
        await refuseGeneration(scope, made.generation.id, seed.blocked)
      }
    }
    return { reel, shots }
  }

  const sheetFor = async (reelId: string, shots: readonly { readonly id: string }[]): Promise<void> => {
    const made = await createGeneration(scope, { episodeId: created.episode.id, targetType: 'reel', targetId: reelId, job: 'storyboard_sheet', cost: GENERATION_COSTS.storyboard_sheet, prompt: {}, settingsSnapshot: {}, route: 'seed', sourceHash: null })
    if (made.status !== 'created') throw new Error('The seed could not hold credits for a sheet.')
    await startGeneration(scope, made.generation.id)
    const id = await asset('sheet', [50, 45, 40])
    let clock = 0
    await succeedGeneration(scope, made.generation.id, {
      job: 'storyboard_sheet',
      asset: id as never,
      artStyleId: preset.id as never,
      frames: shots.map((shot, index) => {
        const from = clock
        clock += 4
        return { shotId: shot.id as never, heading: `${String(index + 1)}. SHOT`, cameraNote: `${CAM} · lens`, timeFromS: from, timeToS: clock }
      }),
    })
  }

  const stillFor = async (sceneId: NodeId): Promise<void> => {
    const id = await asset('still', [60, 80, 110])
    await dbOf(scope).update(scenes).set({ stillAssetId: id, stillState: 'drawn' }).where(scoped(scope, scenes, eq(scenes.sceneNodeId, sceneId)))
  }

  const clipFor = async (reelId: string, stale: boolean): Promise<void> => {
    const made = await createGeneration(scope, { episodeId: created.episode.id, targetType: 'reel', targetId: reelId, job: 'shoot_reel', cost: GENERATION_COSTS.shoot_reel, prompt: {}, settingsSnapshot: {}, route: 'seed', sourceHash: null })
    if (made.status !== 'created') throw new Error('The seed could not hold credits for a clip.')
    await startGeneration(scope, made.generation.id)
    const id = await asset('clip', [0, 0, 0])
    await succeedGeneration(scope, made.generation.id, { job: 'shoot_reel', video: id as never, poster: null })
    if (stale) {
      await dbOf(scope).update(reels).set({ status: 'stale' }).where(scoped(scope, reels, eq(reels.id, reelId)))
      await dbOf(scope).execute(sql`update clips set state = 'stale' where reel_id = ${reelId}`)
    }
  }

  // Scene 1: rendered + authoring.
  const r11 = await seedReel(s1, 'Reel 1', 15, S1R1)
  await sheetFor(r11.reel.id, r11.shots)
  await stillFor(s1)
  await clipFor(r11.reel.id, false)
  // A second clip so the rendered reel reads "v2".
  await clipFor(r11.reel.id, false)
  await seedReel(s1, 'Reel 2', 10, S1R2)

  // Scene 3: generating, with the sheet drawing and one shot refused.
  const r31 = await seedReel(s3, 'Reel 1', 15, S3R1)
  const sheetGen = await createGeneration(scope, { episodeId: created.episode.id, targetType: 'reel', targetId: r31.reel.id, job: 'storyboard_sheet', cost: GENERATION_COSTS.storyboard_sheet, prompt: {}, settingsSnapshot: {}, route: 'seed', sourceHash: null })
  if (sheetGen.status !== 'created') throw new Error('The seed could not hold credits for the generating sheet.')
  await startGeneration(scope, sheetGen.generation.id)
  await progressGeneration(scope, sheetGen.generation.id, 62)
  await dbOf(scope).update(reels).set({ status: 'generating' }).where(scoped(scope, reels, eq(reels.id, r31.reel.id)))

  // Scene 4: a reel with no shots.
  await seedReel(s4, 'Reel 1', 15, [])

  // Scene 5: out of date - a done sheet, a stale clip, two stale frames.
  const r51 = await seedReel(s5, 'Reel 1', 15, S5R1)
  await sheetFor(r51.reel.id, r51.shots)
  await stillFor(s5)
  await clipFor(r51.reel.id, true)
  for (const shot of r51.shots.slice(0, 2)) {
    await dbOf(scope).update(reelShots).set({ frameState: 'stale' }).where(scoped(scope, reelShots, eq(reelShots.id, shot.id)))
  }

  const episodeRow = (await db.select({ slug: episodes.slug }).from(episodes).where(eq(episodes.id, created.episode.id)).limit(1))[0]
  log(`done: /app/project/${projectId}/${episodeRow?.slug ?? 'ep_001'}/production`)
}

main()
  .catch((cause: unknown) => {
    process.stderr.write(`${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
    process.exitCode = 1
  })
  .finally(() => closeDatabases())
