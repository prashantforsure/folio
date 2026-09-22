'use client'

import type { ProductionScene } from '@folio/contracts'
import { GENERATION_COSTS } from '@folio/contracts'
import { useRef } from 'react'

import { useProduction } from './production-context'

/**
 * §3.6, the scene image: `SCENE IMAGE`, the plate (`scene still` until
 * there is one), `✦ Generate scene · 40 cr` / `↑ Upload scene`. One image
 * per scene, shared by its reels. Generating draws the plate dimmed with
 * a progress bar; a refused still says so on the plate.
 */
export const SceneImage = ({ scene }: { readonly scene: ProductionScene }) => {
  const { act, model, storage, live } = useProduction()
  const input = useRef<HTMLInputElement>(null)
  const generation = live.find((candidate) => candidate.job === 'scene_image' && candidate.targetId === scene.sceneNodeId) ?? null
  const busy = scene.stillState === 'gen' || scene.stillState === 'queued' || generation !== null
  const url = scene.still?.url ?? null
  const connected = model && storage
  const label = busy ? '◌ Drawing scene…' : `✦ Generate scene · ${String(GENERATION_COSTS.scene_image)} cr`
  return (
    <div className="folio-prod-image-col" data-scene-image data-still-state={scene.stillState}>
      <span className="folio-prod-eyebrow">Scene image</span>
      <span className="folio-prod-still" data-drawn={url === null ? undefined : 'true'} data-busy={busy ? 'true' : undefined} style={url === null ? undefined : { backgroundImage: `url(${url})` }}>
        {url === null ? (scene.stillState === 'blocked' ? 'refused — try another prompt' : scene.stillState === 'failed' ? 'failed · refunded' : 'scene still') : null}
        {busy ? (
          <span className="folio-prod-progress" role="progressbar" aria-label="Drawing the scene image" aria-valuemin={0} aria-valuemax={100} aria-valuenow={generation?.progress ?? 0}>
            <span style={{ width: `${String(generation?.progress ?? 0)}%` }} />
          </span>
        ) : null}
      </span>
      <div className="flex gap-[7px]">
        <button
          type="button"
          data-generate-scene
          aria-disabled={busy || !connected}
          title={!model ? 'The model is not connected' : !storage ? 'Image storage is not set up on this server yet' : busy ? 'The scene image is being drawn' : `Draw one still for this scene · ${String(GENERATION_COSTS.scene_image)} cr`}
          onClick={() => {
            if (busy || !connected) return
            act.generateSceneImage(scene.sceneNodeId)
          }}
          className="folio-prod-accent-solid flex-1"
        >
          {label}
        </button>
        <button
          type="button"
          data-upload-scene
          aria-disabled={!storage}
          title={storage ? 'Upload a still for this scene' : 'Image storage is not set up on this server yet'}
          onClick={() => {
            if (storage) input.current?.click()
          }}
          className="folio-prod-line-small h-[32px] flex-1 justify-center"
        >
          ↑ Upload scene
        </button>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          aria-label="Scene image file"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file !== undefined) act.uploadSceneImage(scene.sceneNodeId, file)
            event.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
