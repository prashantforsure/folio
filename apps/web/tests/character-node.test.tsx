import type { CharacterId } from '@folio/script'
import { fireEvent, render } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { CharacterNode } from '../app/(app)/app/project/[projectId]/_characters/canvas/character-node'
import type { CastFigure } from '../lib/characters/cast'

/**
 * The Characters card's `✦ Generate` - roadmap task 5.2. It was drawn
 * disabled until the worker existed; now it draws the character's look and
 * says its price on the button before anything is spent, is `Drawing the
 * look…` while one draws, and is disabled with the server's own reason when
 * the model or the storage is not there. The look sheet's two buttons stay
 * disabled, with the reason that is true now.
 */

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  )
})

const figure = {
  id: 'e0000000-0000-4000-8000-000000000001' as CharacterId,
  name: 'MEERA',
  hue: 3,
  gender: null,
  age: null,
  bio: null,
  portraitUrl: null,
  appearances: 2,
  lines: 14,
  initial: 'M',
} as CastFigure

const draw = (look: { readonly cost: number; readonly off: string | null; readonly drawing: boolean }, onGenerate = vi.fn()) =>
  render(
    <CharacterNode
      figure={figure}
      position={{ x: 0, y: 0 }}
      scale={1}
      selected={false}
      dragging={false}
      target={false}
      connecting={false}
      storage
      look={look}
      onOpen={vi.fn()}
      onDrag={vi.fn()}
      onDrop={vi.fn()}
      onMeasure={vi.fn()}
      onConnectStart={vi.fn()}
      onUpload={vi.fn()}
      onGenerate={onGenerate}
    />,
  )

describe('the card`s Generate', () => {
  it('names its price and draws the look on a click', () => {
    const onGenerate = vi.fn()
    const { container } = draw({ cost: 40, off: null, drawing: false }, onGenerate)
    const button = container.querySelector<HTMLButtonElement>('[data-generate]')
    expect(button?.getAttribute('data-generate')).toBe('ready')
    expect(button?.disabled).toBe(false)
    expect(button?.textContent).toBe('✦Generate · 40 cr')
    expect(button?.getAttribute('title')).toBe("Draw MEERA's look from their appearance, age and gender - 40 credits")
    if (button !== null && button !== undefined) fireEvent.click(button)
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('says the look is drawing, and cannot be clicked again while it does', () => {
    const { container } = draw({ cost: 40, off: null, drawing: true })
    const button = container.querySelector<HTMLButtonElement>('[data-generate]')
    expect(button?.getAttribute('data-generate')).toBe('drawing')
    expect(button?.disabled).toBe(true)
    expect(button?.textContent).toBe('✦Drawing the look…')
  })

  it('is disabled with the server`s own reason when it cannot run here', () => {
    const { container } = draw({ cost: 40, off: 'The model is not connected: set GEMINI_API_KEY on this server.', drawing: false })
    const button = container.querySelector<HTMLButtonElement>('[data-generate]')
    expect(button?.getAttribute('data-generate')).toBe('off')
    expect(button?.disabled).toBe(true)
    expect(button?.getAttribute('title')).toBe('The model is not connected: set GEMINI_API_KEY on this server.')
  })

  it('leaves the look sheet`s buttons disabled, saying the sheet is not built - not that the worker is missing', () => {
    const { container } = draw({ cost: 40, off: null, drawing: false })
    const tab = container.querySelector<HTMLButtonElement>('[data-face-tab-button="looksheet"]')
    if (tab !== null) fireEvent.click(tab)
    const sheet = container.querySelector<HTMLButtonElement>('[data-generate-sheet]')
    expect(sheet?.disabled).toBe(true)
    expect(sheet?.getAttribute('title')).toBe('The three-angle look sheet is not built yet')
    expect(container.textContent).not.toContain('Needs the Production worker')
  })
})
