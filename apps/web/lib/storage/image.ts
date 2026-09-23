import type { PortraitType } from '@folio/contracts'
import { PORTRAIT_TYPES } from '@folio/contracts'

/**
 * What an uploaded image is, read from its bytes. Server only - the caller
 * is a server action holding the `File` it was handed.
 *
 * The declared `content-type` is never trusted: a PNG renamed `.jpg` is a
 * PNG, and a text file called `photo.png` is neither. The first bytes say
 * which of the three accepted formats a file is, or that it is none of
 * them. One module because two routes store an image on a record - a
 * character's portrait and a location's photo - and the rule for what an
 * image is cannot differ between them.
 */
export type ImageType = PortraitType

/** The first bytes of the three formats accepted. */
export const sniffImage = (bytes: Uint8Array): ImageType | null => {
  const at = (index: number): number => bytes[index] ?? -1
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if (
    at(0) === 0x52 &&
    at(1) === 0x49 &&
    at(2) === 0x46 &&
    at(3) === 0x46 &&
    at(8) === 0x57 &&
    at(9) === 0x45 &&
    at(10) === 0x42 &&
    at(11) === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

/** The file extension a key takes for each type. */
export const IMAGE_EXTENSION: Readonly<Record<ImageType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export type ImageCheck =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly type: ImageType }
  | { readonly ok: false; readonly status: 'error' | 'refused'; readonly message: string }

/**
 * Read a form entry as an image: a `File`, not empty, under `maxBytes`, and
 * one of the three formats by its bytes. `noun` names it in the messages -
 * `A portrait is…`, `A photo is…`.
 *
 * **Call this after the gate, never before.** `arrayBuffer()` pulls the whole
 * upload into this process's memory, and the size cap below cannot prevent
 * that - by the time it is checked, the body has already been accepted. An
 * upload action that read the file first let anyone who is not signed in make
 * the server buffer the entire action body limit per request. Every caller
 * gates first (AGENT_READINESS_REPORT.md 3.4.3, finding 11).
 */
export const readImage = async (entry: FormDataEntryValue | null, maxBytes: number, noun: string): Promise<ImageCheck> => {
  if (!(entry instanceof File)) return { ok: false, status: 'error', message: 'Pick an image to upload.' }
  if (entry.size === 0) return { ok: false, status: 'error', message: 'That file is empty.' }
  if (entry.size > maxBytes) {
    return { ok: false, status: 'refused', message: `A ${noun} is at most ${String(maxBytes / (1024 * 1024))} MB.` }
  }
  const bytes = new Uint8Array(await entry.arrayBuffer())
  const type = sniffImage(bytes)
  if (type === null || !(PORTRAIT_TYPES as readonly string[]).includes(type)) {
    return { ok: false, status: 'refused', message: `A ${noun} is a PNG, JPEG or WebP image.` }
  }
  return { ok: true, bytes, type }
}
