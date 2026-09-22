'use client'

import type { SettingsInput } from '@folio/contracts'
import { ASPECT_RATIO_CARDS, SETTINGS_GROUPS } from '@folio/contracts'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useViewport } from '../../../../../../lib/state/viewport'
import { useFocusTrap } from '../_chrome/use-focus-trap'
import { useProduction } from './production-context'
import { closeSetup } from './view-state'

/**
 * §5.4, Production Settings: `min(1180px)`, two panes (one column under
 * 1160px). Left: Aspect Ratio (three shape cards) and the four option
 * groups; right: the Art Style grid (two columns, one under 980px) - a
 * 158px reference plate with the era pill, `✓` on the selected, the name
 * over a gradient scrim, the `#tag` reference films, the description.
 * Footer: the mono summary + `— locked to this episode once production
 * starts`, and `Confirm`. Opens by default for a fresh episode and from
 * the header chip; Escape closes; Tab stays inside. Once the episode is
 * locked every control is disabled and Confirm reads `Locked`.
 */
const STRIPES = 'repeating-linear-gradient(135deg,rgba(255,255,255,.055) 0 9px,rgba(0,0,0,.05) 9px 18px),'

export const SettingsModal = () => {
  const { settings, defaults, artStyles, act } = useProduction()
  const { width } = useViewport()
  const [mounted, setMounted] = useState(false)
  const [busy, setBusy] = useState(false)
  const current = settings ?? defaults
  const locked = settings?.lockedAt !== null && settings?.lockedAt !== undefined
  const [draft, setDraft] = useState<SettingsInput>({
    aspectRatio: current.aspectRatio,
    productionType: current.productionType,
    cameraStyle: current.cameraStyle,
    pacing: current.pacing,
    lighting: current.lighting,
    artStyleId: current.artStyleId,
  })
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setMounted(true)
  }, [])
  useFocusTrap(panel, mounted)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeSetup()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  if (!mounted) return null
  const narrow = width < 1160
  const styleName = artStyles.find((style) => style.id === draft.artStyleId)?.name ?? ''
  const summary = `${ASPECT_RATIO_CARDS.find((card) => card.id === draft.aspectRatio)?.label ?? draft.aspectRatio} · ${draft.productionType} · ${draft.cameraStyle} · ${draft.pacing} · ${draft.lighting} · ${styleName} — locked to this episode once production starts`

  return createPortal(
    <div data-production-root className="folio-prod-modal-scrim" data-settings-modal>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="production-settings-title" className="folio-prod-modal">
        <div className="flex flex-none flex-col gap-[6px] border-b border-line2 px-[28px] pb-[20px] pt-[26px]">
          <span id="production-settings-title" className="text-20 font-medium tracking-[-.02em]">
            Production Settings
          </span>
          <span className="text-13 leading-[1.5] text-ink2 [text-wrap:pretty]">The art style is a film&apos;s visual soul — every scene, storyboard and final frame will follow it</span>
        </div>

        <div className="folio-prod-modal-body" data-narrow={narrow ? 'true' : undefined}>
          <div className="folio-prod-modal-pane">
            <div className="folio-prod-group">
              <span className="flex flex-col gap-[5px]">
                <span className="text-14 font-medium tracking-title">Aspect Ratio</span>
                <span className="text-11-5 leading-[1.55] text-ink3 [text-wrap:pretty]">Sets the frame format and the ratio of every video output · locked once production starts</span>
              </span>
              <span role="radiogroup" aria-label="Aspect ratio" className="flex gap-[8px]">
                {ASPECT_RATIO_CARDS.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    role="radio"
                    aria-checked={draft.aspectRatio === card.id}
                    disabled={locked}
                    data-aspect={card.id}
                    onClick={() => {
                      setDraft((d) => ({ ...d, aspectRatio: card.id }))
                    }}
                    className="folio-prod-ratio"
                  >
                    <span className="folio-prod-ratio-shape" style={{ width: `${String(card.w)}px`, height: `${String(card.h)}px` }} aria-hidden="true" />
                    <span className="text-center text-11-5 leading-[1.3]">{card.label}</span>
                  </button>
                ))}
              </span>
            </div>
            {SETTINGS_GROUPS.map((group) => (
              <div key={group.id} className="folio-prod-group">
                <span className="flex flex-col gap-[5px]">
                  <span className="text-14 font-medium tracking-title">{group.label}</span>
                  <span className="text-11-5 leading-[1.55] text-ink3 [text-wrap:pretty]">{group.hint}</span>
                </span>
                <span role="radiogroup" aria-label={group.label} className="flex flex-wrap gap-[8px]">
                  {group.options.map((option) => {
                    const on = draft[group.id] === option.id
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={locked}
                        data-option={option.id}
                        onClick={() => {
                          setDraft((d) => ({ ...d, [group.id]: option.id }))
                        }}
                        className="folio-prod-option"
                      >
                        <span className="text-12-5 font-medium">{option.id}</span>
                        <span className="text-11 leading-[1.4] text-ink3">{option.sub}</span>
                      </button>
                    )
                  })}
                </span>
              </div>
            ))}
          </div>

          <div className="folio-prod-modal-pane folio-prod-group">
            <span className="flex flex-col gap-[5px]">
              <span className="text-14 font-medium tracking-title">Art Style</span>
              <span className="text-11-5 leading-[1.55] text-ink3 [text-wrap:pretty]">The shared visual baseline for every scene, storyboard and final frame · sets the film&apos;s mood</span>
            </span>
            <span role="radiogroup" aria-label="Art style" className="folio-prod-styles" data-one-column={width < 980 ? 'true' : undefined}>
              {artStyles.map((style) => {
                const on = draft.artStyleId === style.id
                return (
                  <button
                    key={style.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={locked}
                    data-art-style={style.key}
                    onClick={() => {
                      setDraft((d) => ({ ...d, artStyleId: style.id }))
                    }}
                    className="folio-prod-style"
                  >
                    <span className="folio-prod-style-plate" style={{ background: `${STRIPES}${style.plateGradient}` }}>
                      <span className="folio-prod-style-era">{style.era}</span>
                      {on ? (
                        <span className="folio-prod-style-check" aria-hidden="true">
                          ✓
                        </span>
                      ) : null}
                      <span className="folio-prod-style-name">{style.name}</span>
                      <span className="folio-prod-style-ref" aria-hidden="true">
                        REFERENCE STILL
                      </span>
                    </span>
                    <span className="flex flex-col gap-[7px] px-[12px] pb-[13px] pt-[11px]">
                      <span className="flex flex-wrap gap-[6px]">
                        {style.referenceFilms.map((film) => (
                          <span key={film} className="font-mono text-10-5 text-ok">
                            #{film}
                          </span>
                        ))}
                      </span>
                      <span className="text-11-5 leading-[1.55] text-ink2 [text-wrap:pretty]">{style.description}</span>
                    </span>
                  </button>
                )
              })}
            </span>
          </div>
        </div>

        <div className="flex flex-none items-center gap-[12px] border-t border-line2 px-[28px] py-[16px]">
          <span className="min-w-0 flex-1 text-11-5 leading-[1.5] text-ink3 [text-wrap:pretty]" data-settings-summary>
            {summary}
          </span>
          <button
            type="button"
            data-settings-confirm
            disabled={busy}
            onClick={() => {
              if (locked) {
                closeSetup()
                return
              }
              setBusy(true)
              void act.saveSettings(draft).then((saved) => {
                setBusy(false)
                if (saved) closeSetup()
              })
            }}
            className="folio-prod-confirm"
          >
            {locked ? 'Locked' : busy ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
