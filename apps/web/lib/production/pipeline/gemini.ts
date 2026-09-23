import { modelEnv } from '@folio/db/env'

import type { GenerationSpec, SpecReference } from './spec'

/**
 * Google's Gemini API over plain `fetch` - no SDK, by the client's ruling
 * (2026-09-22: "fetch + run after response"). Three calls, one per model
 * kind the registry names:
 *
 *   - text:  `models/{model}:generateContent`, JSON out
 *   - image: `models/{model}:generateContent` with `responseModalities:
 *            ['IMAGE']` and the reference images as `inlineData` parts
 *   - video: `models/{model}:predictLongRunning`, then the operation
 *            polled until `done`, then the file fetched with the key
 *
 * Every outcome is a value: `refused` when the model's safety layer
 * blocked the request (the shot's `block_reason`, in the writer's terms),
 * `failed` for everything else - a bad key, a quota, a model the key
 * cannot reach (Veo on the free tier). The runner turns each into the
 * generation's end state and the ledger's release. Nothing here throws
 * past its boundary.
 *
 * The key is read once from `modelEnv`; a call with none is a `failed`
 * with the connection message, so a button that slipped through the gate
 * still lands somewhere truthful.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

export type ModelOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly kind: 'refused'; readonly reason: string }
  | { readonly ok: false; readonly kind: 'failed'; readonly message: string }

export type ImageOut = { readonly bytes: Uint8Array; readonly mime: string }

const NOT_CONNECTED = 'The model is not connected: GEMINI_API_KEY is not set on this server.'

const headers = (): Record<string, string> | null =>
  modelEnv === null ? null : { 'x-goog-api-key': modelEnv.GEMINI_API_KEY, 'content-type': 'application/json' }

/** A refusal, in the writer's terms, from the reasons the API names. */
const refusalText = (reason: string, hint: string): string => {
  const why = reason.replace(/_/g, ' ').toLowerCase()
  return `The model refused this ${hint}: ${why}. Rewrite it or take the flagged part out.`
}

const BLOCK_REASONS = new Set(['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_PROHIBITED_CONTENT', 'IMAGE_RECITATION', 'RECITATION'])

/** Fetch a reference image into an `inlineData` part. A reference that will not load is dropped, not fatal. */
const inlinePart = async (reference: SpecReference): Promise<{ readonly inlineData: { readonly mimeType: string; readonly data: string } } | null> => {
  try {
    const response = await fetch(reference.url)
    if (!response.ok) return null
    const mime = response.headers.get('content-type')?.split(';')[0] ?? 'image/png'
    if (!mime.startsWith('image/')) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    return { inlineData: { mimeType: mime, data: bytes.toString('base64') } }
  } catch {
    return null
  }
}

type Part = { readonly text?: string; readonly inlineData?: { readonly mimeType: string; readonly data: string } }

type GenerateContentResponse = {
  readonly candidates?: readonly { readonly content?: { readonly parts?: readonly Part[] }; readonly finishReason?: string }[]
  readonly promptFeedback?: { readonly blockReason?: string }
  readonly error?: { readonly message?: string; readonly status?: string }
}

const readError = async (response: Response): Promise<{ readonly message: string; readonly refused: boolean }> => {
  const body: GenerateContentResponse | null = await response.json().then((json: unknown) => json as GenerateContentResponse, () => null)
  const message = body?.error?.message ?? `${String(response.status)} ${response.statusText}`
  const refused = /safety|prohibited|blocked|violat/i.test(message)
  return { message, refused }
}

const generateContent = async (
  model: string,
  parts: readonly Part[],
  generationConfig: Record<string, unknown>,
  hint: string,
  signal?: AbortSignal,
): Promise<ModelOutcome<readonly Part[]>> => {
  const h = headers()
  if (h === null) return { ok: false, kind: 'failed', message: NOT_CONNECTED }
  let response: Response
  try {
    response = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (cause) {
    return { ok: false, kind: 'failed', message: cause instanceof Error ? cause.message : 'The model could not be reached.' }
  }
  if (!response.ok) {
    const { message, refused } = await readError(response)
    return refused ? { ok: false, kind: 'refused', reason: refusalText(message, hint) } : { ok: false, kind: 'failed', message }
  }
  const body = (await response.json()) as GenerateContentResponse
  if (body.promptFeedback?.blockReason !== undefined) return { ok: false, kind: 'refused', reason: refusalText(body.promptFeedback.blockReason, hint) }
  const candidate = body.candidates?.[0]
  if (candidate === undefined) return { ok: false, kind: 'failed', message: 'The model returned nothing.' }
  if (candidate.finishReason !== undefined && BLOCK_REASONS.has(candidate.finishReason)) {
    return { ok: false, kind: 'refused', reason: refusalText(candidate.finishReason, hint) }
  }
  return { ok: true, value: candidate.content?.parts ?? [] }
}

/**
 * What an image call reads of a spec - the prompt, the references and the
 * aspect. A Production spec is one; a Storyboard frame's (`storyboardFrameSpec`)
 * is another, with no film settings to snapshot.
 */
export type ImageSpec = Pick<GenerationSpec, 'prompt' | 'references' | 'aspect'>

/** JSON text out. The caller parses and validates it. */
export const generateText = async (model: string, spec: GenerationSpec, signal?: AbortSignal): Promise<ModelOutcome<string>> => {
  const out = await generateContent(model, [{ text: spec.prompt }], { responseMimeType: 'application/json', temperature: 0.7 }, 'shotlist', signal)
  if (!out.ok) return out
  const text = out.value.map((part) => part.text ?? '').join('').trim()
  return text.length === 0 ? { ok: false, kind: 'failed', message: 'The model returned no text.' } : { ok: true, value: text }
}

/** One image out, with the spec's references in as image parts. */
export const generateImage = async (model: string, spec: ImageSpec, signal?: AbortSignal): Promise<ModelOutcome<ImageOut>> => {
  const references = (await Promise.all(spec.references.slice(0, 8).map(inlinePart))).filter((part): part is NonNullable<typeof part> => part !== null)
  const labels = spec.references
    .slice(0, 8)
    .map((reference, index) => `Reference image ${String(index + 1)}: ${reference.role} - ${reference.label}.`)
    .join(' ')
  const parts: Part[] = [{ text: labels.length > 0 ? `${spec.prompt}\n${labels}` : spec.prompt }, ...references]
  const out = await generateContent(model, parts, { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: spec.aspect } }, 'image', signal)
  if (!out.ok) return out
  const image = out.value.find((part) => part.inlineData !== undefined)?.inlineData
  if (image === undefined) return { ok: false, kind: 'refused', reason: 'The model returned no image for this prompt. Rewrite it or take the flagged part out.' }
  return { ok: true, value: { bytes: new Uint8Array(Buffer.from(image.data, 'base64')), mime: image.mimeType } }
}

type Operation = {
  readonly name?: string
  readonly done?: boolean
  readonly error?: { readonly message?: string }
  readonly response?: {
    readonly generateVideoResponse?: {
      readonly generatedSamples?: readonly { readonly video?: { readonly uri?: string } }[]
      readonly raiMediaFilteredReasons?: readonly string[]
    }
  }
}

/** Veo takes 4, 6 or 8 seconds; a 5 s reel is 6, a 10 or 15 s reel 8 - flagged: extension is not wired. */
const veoDuration = (seconds: number | null): '4' | '6' | '8' => (seconds === null ? '8' : seconds <= 4 ? '4' : seconds <= 6 ? '6' : '8')

const VEO_ASPECT: Readonly<Record<GenerationSpec['aspect'], '16:9' | '9:16'>> = { '16:9': '16:9', '9:16': '9:16', '21:9': '16:9' }

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** One clip out: start the operation, poll it, fetch the file. Reports progress by elapsed polls. */
export const generateVideo = async (
  model: string,
  spec: GenerationSpec,
  onProgress: (percent: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<ModelOutcome<ImageOut>> => {
  const h = headers()
  if (h === null) return { ok: false, kind: 'failed', message: NOT_CONNECTED }
  const still = spec.references.find((reference) => reference.role === 'scene_still' || reference.role === 'reference')
  const image = still === undefined ? null : await inlinePart(still)
  let started: Response
  try {
    started = await fetch(`${BASE}/models/${model}:predictLongRunning`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        instances: [image === null ? { prompt: spec.prompt } : { prompt: spec.prompt, image: image.inlineData }],
        parameters: { aspectRatio: VEO_ASPECT[spec.aspect], durationSeconds: veoDuration(spec.durationS), resolution: '720p' },
      }),
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (cause) {
    return { ok: false, kind: 'failed', message: cause instanceof Error ? cause.message : 'The video model could not be reached.' }
  }
  if (!started.ok) {
    const { message, refused } = await readError(started)
    return refused ? { ok: false, kind: 'refused', reason: refusalText(message, 'clip') } : { ok: false, kind: 'failed', message }
  }
  const operation = (await started.json()) as Operation
  if (operation.name === undefined) return { ok: false, kind: 'failed', message: 'The video model returned no operation.' }
  const deadline = Date.now() + 10 * 60 * 1000
  let polls = 0
  while (Date.now() < deadline) {
    await sleep(10_000)
    if (signal?.aborted === true) return { ok: false, kind: 'failed', message: 'Stopped: the generation was cancelled.' }
    polls += 1
    await onProgress(Math.min(90, polls * 6))
    const polled = await fetch(`${BASE}/${operation.name}`, { headers: h })
    if (!polled.ok) {
      const { message } = await readError(polled)
      return { ok: false, kind: 'failed', message }
    }
    const state = (await polled.json()) as Operation
    if (state.done !== true) continue
    if (state.error !== undefined) return { ok: false, kind: 'failed', message: state.error.message ?? 'The video model failed.' }
    const filtered = state.response?.generateVideoResponse?.raiMediaFilteredReasons ?? []
    const uri = state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
    if (uri === undefined) {
      return filtered.length > 0
        ? { ok: false, kind: 'refused', reason: refusalText(filtered.join('; '), 'clip') }
        : { ok: false, kind: 'failed', message: 'The video model returned no clip.' }
    }
    const file = await fetch(uri, { headers: { 'x-goog-api-key': h['x-goog-api-key'] ?? '' }, redirect: 'follow' })
    if (!file.ok) return { ok: false, kind: 'failed', message: `The clip could not be fetched (${String(file.status)}).` }
    const bytes = new Uint8Array(await file.arrayBuffer())
    return { ok: true, value: { bytes, mime: file.headers.get('content-type')?.split(';')[0] ?? 'video/mp4' } }
  }
  return { ok: false, kind: 'failed', message: 'The video model took longer than ten minutes.' }
}
