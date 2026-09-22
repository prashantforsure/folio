import type { ReelShot } from '@folio/contracts'

/**
 * The camera line and the sheet's per-shot notes, as the mockup prints
 * them from the five camera columns (§3.3 row 2, §3.4).
 */

/** `{body}, {lens} — {type}, {angle}, {motion}`; the right half lower-cased as the mockup prints it. */
export const cameraLine = (shot: Pick<ReelShot, 'cameraBody' | 'lens' | 'shotType' | 'cameraAngle' | 'cameraMotion'>): string => {
  const left = [shot.cameraBody, shot.lens].filter((part) => part.trim().length > 0).join(', ')
  const right = [shot.shotType, shot.cameraAngle, shot.cameraMotion]
    .filter((part) => part.trim().length > 0)
    .join(', ')
    .toLowerCase()
  return left.length > 0 ? `${left} — ${right}` : right
}

/** The drawer's Camera row: the full string, mockup order. */
export const cameraString = (shot: Pick<ReelShot, 'cameraBody' | 'lens' | 'shotType' | 'cameraAngle' | 'cameraMotion'>): string =>
  [shot.shotType, shot.cameraAngle, shot.cameraMotion, shot.cameraBody, shot.lens].filter((part) => part.trim().length > 0).join(' · ')

/** The sheet row's heading: `{i}. {TYPE} – {MOTION}`. */
export const sheetHeading = (index: number, shot: Pick<ReelShot, 'shotType' | 'cameraMotion'>): string =>
  `${String(index + 1)}. ${`${shot.shotType} – ${shot.cameraMotion}`.toUpperCase()}`

/** The sheet row's camera note: `{body} · {lens}`, `lens tbd` with none. */
export const sheetCameraNote = (shot: Pick<ReelShot, 'cameraBody' | 'lens'>): string =>
  `${shot.cameraBody.trim().length > 0 ? shot.cameraBody : 'camera tbd'} · ${shot.lens.trim().length > 0 ? shot.lens : 'lens tbd'}`

/** `{from}–{to}s`. */
export const sheetTime = (from: number, to: number): string => `${String(from)}–${String(to)}s`

/** The card's duration pill and the table's cell: `4 s`, or `— s` with none. */
export const secondsLabel = (seconds: number | null): string => (seconds === null ? '— s' : `${String(seconds)} s`)
