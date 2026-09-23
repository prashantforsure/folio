import { storageEnv } from '@folio/db/env'
import { AwsClient } from 'aws4fetch'
import { XMLParser } from 'fast-xml-parser'

/**
 * Object storage: Cloudflare R2 over its S3 API. Server only.
 *
 * The one place the app talks to a bucket. Put, delete, list (the worker's
 * sweeper, roadmap task 4.3) and the public URL of a key - and a flag for whether storage is
 * configured at all, which every caller reads first: with no `R2_*` in the
 * environment the Characters route draws Upload disabled and says why,
 * rather than failing on the first click.
 *
 * ## Why `aws4fetch`, and why here
 *
 * R2 speaks S3, and S3 wants every request signed with SigV4. `aws4fetch`
 * is the smallest thing that does that - one module, no dependencies,
 * built on `fetch` - and the alternative is either the AWS SDK at thirty
 * times the weight for a PUT and a DELETE, or a hand-rolled signer, which
 * is eighty lines that are wrong in a way nobody notices until a key with
 * a space in it. Approved with the Characters route's second pass
 * (`docs/build-decisions.md`).
 *
 * `apps/web/lib/storage/` is the directory `eslint.config.mjs` pre-declared
 * for storage clients, on the pattern of `lib/auth/` for the auth client.
 * Nothing under it may be imported by a Client Component: the credentials
 * live in `@folio/db/env`, which throws at module scope in a browser, and
 * `scripts/assert-no-server-secrets.mjs` scans the built bundle for the
 * `R2_SECRET_ACCESS_KEY` name and value after every build.
 *
 * ## Keys, not URLs
 *
 * Callers store the object *key* and compose the URL at read
 * (`publicUrl`), so the bucket can move to another domain without a data
 * change. Keys are `projects/<projectId>/...`: the project id in the path
 * is the tenancy boundary inside the bucket, the same boundary every
 * table has as `project_id`.
 */

const client = (): { readonly aws: AwsClient; readonly base: string; readonly publicBase: string } | null => {
  if (storageEnv === null) return null
  return {
    aws: new AwsClient({
      accessKeyId: storageEnv.R2_ACCESS_KEY_ID,
      secretAccessKey: storageEnv.R2_SECRET_ACCESS_KEY,
      service: 's3',
      region: 'auto',
    }),
    base: `https://${storageEnv.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${storageEnv.R2_BUCKET}`,
    publicBase: storageEnv.R2_PUBLIC_URL,
  }
}

/** Whether the five `R2_*` variables are set. Read before offering an upload. */
export const storageAvailable = (): boolean => storageEnv !== null

/** A key's public URL, or null with no storage configured. */
export const publicUrl = (key: string | null): string | null => {
  const r2 = client()
  if (r2 === null || key === null) return null
  return `${r2.publicBase}/${encodeKey(key)}`
}

const encodeKey = (key: string): string => key.split('/').map(encodeURIComponent).join('/')

/**
 * The key behind a public URL this bucket wrote, or null: storage unset,
 * or a URL from somewhere else. The inverse of `publicUrl`, for a caller
 * that stored the URL rather than the key (`shots.frame_upload_url`, a URL
 * the way a generation's `frame_url` is one) and now needs to delete the
 * object.
 */
export const keyOfPublicUrl = (url: string): string | null => {
  const r2 = client()
  if (r2 === null) return null
  const prefix = `${r2.publicBase}/`
  if (!url.startsWith(prefix)) return null
  try {
    return url.slice(prefix.length).split('/').map(decodeURIComponent).join('/')
  } catch {
    return null
  }
}

export type StorageOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string }

/** Write an object. The caller has already checked the bytes are what it says they are. */
export const putObject = async (
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<StorageOutcome> => {
  const r2 = client()
  if (r2 === null) return { ok: false, message: 'Storage is not configured.' }
  const response = await r2.aws.fetch(`${r2.base}/${encodeKey(key)}`, {
    method: 'PUT',
    headers: { 'content-type': contentType, 'content-length': String(bytes.byteLength) },
    body: bytes as BodyInit,
  })
  if (!response.ok) return { ok: false, message: `Storage refused the upload (${String(response.status)}).` }
  return { ok: true }
}

/** Delete an object. A key that is already gone is not an error. */
export const deleteObject = async (key: string): Promise<StorageOutcome> => {
  const r2 = client()
  if (r2 === null) return { ok: false, message: 'Storage is not configured.' }
  const response = await r2.aws.fetch(`${r2.base}/${encodeKey(key)}`, { method: 'DELETE' })
  if (!response.ok && response.status !== 404) {
    return { ok: false, message: `Storage refused the delete (${String(response.status)}).` }
  }
  return { ok: true }
}

/** One object as a listing names it. */
export type StoredObject = { readonly key: string; readonly size: number; readonly lastModified: Date }

export type ListOutcome = { readonly ok: true; readonly objects: readonly StoredObject[]; readonly truncated: boolean } | { readonly ok: false; readonly message: string }

const LIST_PAGE = 1000

/**
 * Every object under a prefix - S3's `ListObjectsV2`, a page of a thousand at
 * a time, parsed with `fast-xml-parser` (already approved, for FDX). For the
 * worker's sweeper (roadmap task 4.3), which compares what the bucket holds
 * with what the `assets` table points at. `maxObjects` bounds one sweep; a
 * listing cut short says `truncated`, and the next sweep carries on from its
 * last key (`startAfter`, S3's `start-after`).
 */
export const listObjects = async (
  prefix: string,
  options: { readonly maxObjects?: number; readonly startAfter?: string | null } = {},
): Promise<ListOutcome> => {
  const maxObjects = options.maxObjects ?? 10_000
  const r2 = client()
  if (r2 === null) return { ok: false, message: 'Storage is not configured.' }
  const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, isArray: (name) => name === 'Contents' })
  const objects: StoredObject[] = []
  let token: string | null = null
  for (;;) {
    const query = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': String(LIST_PAGE) })
    if (token !== null) query.set('continuation-token', token)
    else if (options.startAfter !== undefined && options.startAfter !== null) query.set('start-after', options.startAfter)
    const response = await r2.aws.fetch(`${r2.base}?${query.toString()}`, { method: 'GET' })
    if (!response.ok) return { ok: false, message: `Storage refused the listing (${String(response.status)}).` }
    const parsed = parser.parse(await response.text()) as {
      readonly ListBucketResult?: {
        readonly Contents?: readonly { readonly Key?: string; readonly Size?: string; readonly LastModified?: string }[]
        readonly IsTruncated?: string
        readonly NextContinuationToken?: string
      }
    }
    const page = parsed.ListBucketResult
    for (const entry of page?.Contents ?? []) {
      if (entry.Key === undefined || entry.LastModified === undefined) continue
      objects.push({ key: entry.Key, size: Number(entry.Size ?? 0), lastModified: new Date(entry.LastModified) })
    }
    const more = page?.IsTruncated === 'true' && page.NextContinuationToken !== undefined
    if (!more) return { ok: true, objects, truncated: false }
    if (objects.length >= maxObjects) return { ok: true, objects, truncated: true }
    token = page.NextContinuationToken ?? null
  }
}
