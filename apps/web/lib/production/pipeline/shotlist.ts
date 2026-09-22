/**
 * The shotlist the text model returns, read strictly - pure, so it can be
 * tested without the env the client reads. Anything off-shape is a
 * failure the runner reports, never a guess.
 */

export type ShotlistItem = {
  readonly shotType: string
  readonly cameraAngle: string
  readonly cameraMotion: string
  readonly lens: string
  readonly durationS: number
  readonly description: string
}

export const parseShotlist = (text: string): readonly ShotlistItem[] | null => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    const match = /\[[\s\S]*\]/.exec(text)
    if (match === null) return null
    try {
      raw = JSON.parse(match[0])
    } catch {
      return null
    }
  }
  const list = Array.isArray(raw) ? raw : typeof raw === 'object' && raw !== null && Array.isArray((raw as { shots?: unknown }).shots) ? (raw as { shots: unknown[] }).shots : null
  if (list === null) return null
  const out: ShotlistItem[] = []
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) return null
    const item = entry as Record<string, unknown>
    const durationS = typeof item.durationS === 'number' ? item.durationS : typeof item.duration_s === 'number' ? item.duration_s : NaN
    if (typeof item.description !== 'string' || !Number.isFinite(durationS)) return null
    out.push({
      shotType: typeof item.shotType === 'string' ? item.shotType : typeof item.shot_type === 'string' ? item.shot_type : 'Medium',
      cameraAngle: typeof item.cameraAngle === 'string' ? item.cameraAngle : typeof item.camera_angle === 'string' ? item.camera_angle : 'Eye level',
      cameraMotion: typeof item.cameraMotion === 'string' ? item.cameraMotion : typeof item.camera_motion === 'string' ? item.camera_motion : 'Still',
      lens: typeof item.lens === 'string' ? item.lens : '',
      durationS: Math.max(1, Math.min(15, Math.round(durationS))),
      description: item.description,
    })
  }
  return out.length === 0 ? null : out
}
