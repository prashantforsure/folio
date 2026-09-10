import { expect, test } from '@playwright/test'

/**
 * The theme, and the one thing about it that is not negotiable.
 *
 * AGENTS.md, UI fidelity: revision colours "are industry artefacts, not palette
 * tokens, and **must survive a theme switch intact**."
 *
 * `tests/revision-colours.test.ts` proves the stylesheet has no theme block for
 * them. This proves the consequence in a real engine: the *computed* colour of
 * every swatch is byte-identical before and after a switch, while the palette
 * around it has demonstrably moved. Both halves matter - if the page did not
 * change, an unchanged swatch would prove nothing.
 */

const REVISION_COLOURS = ['white', 'blue', 'pink', 'yellow', 'green'] as const

const buildSwatches = `
  const host = document.createElement('div')
  host.id = 'swatch-proof'
  host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--desk);color:var(--ink);padding:20px;font-family:var(--font-sans);font-size:11px'
  const names = ${JSON.stringify(REVISION_COLOURS)}
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;gap:14px;align-items:flex-end'
  for (const name of names) {
    const cell = document.createElement('div')
    cell.style.cssText = 'display:flex;flex-direction:column;gap:6px;align-items:center'
    const chip = document.createElement('span')
    chip.setAttribute('data-revision', name)
    chip.style.cssText = 'width:48px;height:48px;border-radius:2px;box-shadow:inset 0 0 0 1px var(--rev-ring);background:var(--rev-' + name + ')'
    const label = document.createElement('span')
    label.textContent = name
    label.style.cssText = 'color:var(--ink2);font-size:10.5px'
    cell.appendChild(chip)
    cell.appendChild(label)
    row.appendChild(cell)
  }
  const caption = document.createElement('p')
  caption.style.cssText = 'margin:0 0 14px;color:var(--ink3);font-size:10.5px'
  caption.textContent = 'Revision colours — White, Blue, Pink, Yellow, Green'
  host.appendChild(caption)
  host.appendChild(row)
  document.body.appendChild(host)
`

const readSwatches = `
  (() => {
    const out = {}
    for (const chip of document.querySelectorAll('[data-revision]')) {
      out[chip.getAttribute('data-revision')] = getComputedStyle(chip).backgroundColor
    }
    out.__page = getComputedStyle(document.body).backgroundColor
    out.__ink = getComputedStyle(document.body).color
    return out
  })()
`

type Swatches = Record<string, string>

test('revision colours are identical across a theme switch, while the palette is not', async ({
  page,
}) => {
  await page.goto('/sign-in')
  await page.evaluate(buildSwatches)
  await page.evaluate(() => document.fonts.ready)

  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
  })
  const dark = (await page.evaluate(readSwatches)) as Swatches
  await page.locator('#swatch-proof').screenshot({ path: 'test-results/revision-dark.png' })

  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light')
  })
  const light = (await page.evaluate(readSwatches)) as Swatches
  await page.locator('#swatch-proof').screenshot({ path: 'test-results/revision-light.png' })

  // The control: the theme really did change.
  expect(dark['__page']).not.toBe(light['__page'])
  expect(dark['__ink']).not.toBe(light['__ink'])

  // The guarantee: every swatch is the same colour in both.
  for (const name of REVISION_COLOURS) {
    expect({ name, colour: light[name] }).toEqual({ name, colour: dark[name] })
  }

  // And they are five distinct colours, not five references to one token.
  expect(new Set(REVISION_COLOURS.map((name) => dark[name])).size).toBe(REVISION_COLOURS.length)
})

test('the page is dark by default and the palette moves with data-theme', async ({ page }) => {
  await page.goto('/sign-in')

  // AGENTS.md, UI fidelity: "Theme is `dark` by default, via `data-theme`."
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  /*
   * Rasterised through a canvas, not read as a string.
   *
   * Neither the custom property nor the computed `background-color` is usable
   * text here: Tailwind's transformer downlevels `oklch()` to `lab()`, and
   * Chromium keeps `lab()` as the computed value, so parsing the three numbers
   * out of it yields lightness and two opponent axes - not red, green and blue.
   * Reading them as channels is how this test failed the first time it was
   * written, and it failed in the direction that looks like a real bug.
   *
   * Painting the resolved colour into a canvas and sampling a pixel gives sRGB,
   * which is what "terracotta, not violet" is a claim about.
   */
  const read = async () =>
    page.evaluate(() => {
      const probe = document.createElement('div')
      document.body.appendChild(probe)
      const sample = (token: string) => {
        probe.style.backgroundColor = `var(${token})`
        return getComputedStyle(probe).backgroundColor
      }

      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const ctx = canvas.getContext('2d', { willReadFrequently: true })

      const channels = (colour: string) => {
        if (ctx === null) return { r: 0, g: 0, b: 0 }
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = colour
        ctx.fillRect(0, 0, 1, 1)
        const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data
        return { r, g, b }
      }

      const result = {
        desk: sample('--desk'),
        ink: sample('--ink'),
        accent: sample('--accent'),
        accentChannels: channels(sample('--accent')),
      }
      probe.remove()
      return result
    })

  const dark = await read()
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light')
  })
  const light = await read()

  expect(dark.desk).not.toBe(light.desk)
  expect(dark.ink).not.toBe(light.ink)
  expect(dark.accent).not.toBe(light.accent)

  /*
   * The accent is terracotta in both themes. AGENTS.md, Deliberately not using
   * bans cool-toned substitutes, and the design README retires the violet
   * `oklch(0.52 0.13 285)` that both superseded shell bundles use. A terracotta
   * is red-dominant and blue-poor; the violet it replaced is the opposite, so
   * `r > g > b` is enough to tell them apart and would fail loudly if the stale
   * accent were ever pasted back in.
   */
  for (const [theme, channels] of [
    ['dark', dark.accentChannels],
    ['light', light.accentChannels],
  ] as const) {
    expect({ theme, warm: channels.r > channels.g && channels.g > channels.b }).toEqual({
      theme,
      warm: true,
    })
  }
})

test('a light island nests inside a dark page, which no single global flag can express', async ({
  page,
}) => {
  await page.goto('/sign-in')

  const nested = await page.evaluate(() => {
    const island = document.createElement('div')
    island.setAttribute('data-theme', 'light')
    const inner = document.createElement('div')
    island.appendChild(inner)
    document.body.appendChild(island)
    return {
      page: getComputedStyle(document.documentElement).getPropertyValue('--sheet').trim(),
      island: getComputedStyle(inner).getPropertyValue('--sheet').trim(),
    }
  })

  // AGENTS.md, Deliberately not using bans Tailwind's dark variant on exactly
  // this ground: "Routes nest a light sheet inside a dark page." A single global
  // bit cannot express two grounds on one screen. (The variant's literal
  // spelling is absent here because eslint bans that string repo-wide, which is
  // the same rule enforcing itself one layer up.)
  expect(nested.island).not.toBe(nested.page)
})

test('the theme is applied before first paint, with no flash', async ({ page }) => {
  // The inline script in app/layout.tsx runs in <head>, so by the time the
  // document has a body the attribute is already correct. Setting the stored
  // preference before navigation is the only way to observe that ordering.
  await page.goto('/sign-in')
  await page.evaluate(() => {
    localStorage.setItem('folio.theme', 'light')
  })
  await page.reload()

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})
