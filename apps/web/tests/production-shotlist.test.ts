import { describe, expect, it } from 'vitest'

import { parseShotlist } from '../lib/production/pipeline/shotlist'

describe('parseShotlist', () => {
  it('reads a JSON array, clamps durations and defaults the camera', () => {
    const list = parseShotlist('[{"shotType":"Wide angle","durationS":4,"description":"The cage."},{"description":"@Ade at the gate.","duration_s":30}]')
    expect(list).not.toBeNull()
    expect(list?.[0]).toMatchObject({ shotType: 'Wide angle', cameraAngle: 'Eye level', cameraMotion: 'Still', lens: '', durationS: 4 })
    expect(list?.[1]?.durationS).toBe(15)
  })

  it('finds the array inside prose and under a shots key', () => {
    expect(parseShotlist('Here you go:\n[{"description":"x","durationS":3}]\nDone.')?.length).toBe(1)
    expect(parseShotlist('{"shots":[{"description":"x","durationS":3}]}')?.length).toBe(1)
  })

  it('refuses anything off-shape rather than guessing', () => {
    expect(parseShotlist('not json')).toBeNull()
    expect(parseShotlist('[]')).toBeNull()
    expect(parseShotlist('[{"durationS":3}]')).toBeNull()
    expect(parseShotlist('[{"description":"x"}]')).toBeNull()
  })
})
