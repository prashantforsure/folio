import { expect, test } from '@playwright/test'

/**
 * Do the seventeen glyphs actually draw?
 *
 * AGENTS.md, UI fidelity: "Every glyph is a Unicode character rendered as
 * text", followed by the set. `tests/glyphs.test.ts` proves we ship the right
 * characters and `tests/fonts.test.ts` proves none of them is in a self-hosted
 * face. Neither can tell you whether the *browser* finds one, and a missing
 * glyph is a small rectangle, not an error.
 *
 * ## How "renders" is decided
 *
 * By advance width, measured on a canvas with the real resolved font stack.
 *
 *   - **Zero width** means nothing was drawn.
 *   - **The notdef width** means a box was drawn. The control is U+FFFF, a
 *     permanent Unicode non-character that no font may map, so whatever the
 *     browser produces for it is this stack's notdef.
 *
 * A glyph that is non-zero and differs from the control has been found in some
 * face. Which face is not exposed to JavaScript in any browser, so the
 * screenshots exist for a human to look at - the check catches tofu, the
 * picture catches "found, but wrong".
 *
 * ## Both themes, at the sizes the design uses
 *
 * A glyph is not a colour, so a theme cannot hide one - but the screenshots are
 * the artefact a reviewer looks at, and half of them being unreadable is worth
 * knowing. Sizes are the ones the bundles specify: 8px rail label, 11px nav
 * column, 13px theme toggle, 14px rail glyph, 21px route title.
 */

// Transcribed from AGENTS.md, UI fidelity. Order matters; do not sort.
const GLYPHS = [
  ['writing', '✎'],
  ['characters', '◍'],
  ['locations', '⌖'],
  ['timeline', '◷'],
  ['bible', '◈'],
  ['research', '▧'],
  ['insights', '◎'],
  ['production', '▶'],
  ['themeDark', '☾'],
  ['themeLight', '☀'],
  ['settings', '⚙'],
  ['script', '▤'],
  ['outline', '⋮'],
  ['storyboard', '▥'],
  ['scenes', '▢'],
  ['revisions', '⇄'],
  ['notes', '❝'],
] as const

/** U+25B6, U+2600, U+2699 have emoji forms and are given U+FE0E by `Glyph`. */
const EMOJI_FORMS = new Set(['▶', '☀', '⚙'])

const SIZES = [8, 11, 13, 14, 21] as const

const PROOF_ID = 'glyph-proof'

/**
 * Build the proof inside a real page.
 *
 * `/sign-in` is used as a host rather than a purpose-built route: it already
 * loads `globals.css`, the tokens and the self-hosted faces, so what is
 * measured is the stack the product actually ships. AGENTS.md's brief for this
 * phase says to build no product routes, and a `/dev/glyphs` page would be a
 * route - one with a real risk of reaching production.
 */
const buildProof = (glyphs: readonly (readonly [string, string])[], sizes: readonly number[]) => `
  const host = document.createElement('div')
  host.id = ${JSON.stringify(PROOF_ID)}
  host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--desk);color:var(--ink);padding:16px;font-family:var(--font-sans);overflow:auto'
  const rows = ${JSON.stringify(glyphs)}
  const sizes = ${JSON.stringify(sizes)}
  const table = document.createElement('table')
  table.style.cssText = 'border-collapse:collapse;font-size:11px'
  const head = document.createElement('tr')
  head.innerHTML = '<th style="text-align:left;padding:4px 10px;color:var(--ink3);font-size:9.5px;letter-spacing:.09em;text-transform:uppercase">name</th>' +
    sizes.map((s) => '<th style="padding:4px 10px;color:var(--ink3);font-size:9.5px">' + s + 'px</th>').join('')
  table.appendChild(head)
  for (const [name, glyph] of rows) {
    const tr = document.createElement('tr')
    const th = document.createElement('td')
    th.textContent = name
    th.style.cssText = 'padding:3px 10px;color:var(--ink2);border-top:1px solid var(--line2)'
    tr.appendChild(th)
    for (const size of sizes) {
      const td = document.createElement('td')
      td.style.cssText = 'padding:3px 10px;text-align:center;border-top:1px solid var(--line2)'
      const span = document.createElement('span')
      span.setAttribute('data-glyph', name)
      span.setAttribute('data-size', String(size))
      span.style.cssText = 'font-family:var(--font-glyph);font-variant-emoji:text;line-height:1;font-size:' + size + 'px'
      span.textContent = glyph
      td.appendChild(span)
      tr.appendChild(td)
    }
    table.appendChild(tr)
  }
  host.appendChild(table)
  document.body.appendChild(host)
`

const measure = (glyphs: readonly (readonly [string, string])[]) => `
  (() => {
    const probe = document.querySelector('[data-glyph]')
    const font = getComputedStyle(probe).fontFamily
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    ctx.font = '32px ' + font
    // U+FFFF is a permanent non-character: no font may map it, so whatever the
    // browser draws for it is this stack's notdef box.
    const notdef = ctx.measureText('\\uFFFF').width
    const out = {}
    for (const [name, glyph] of ${JSON.stringify(glyphs)}) {
      out[name] = { width: ctx.measureText(glyph).width, notdef }
    }
    return out
  })()
`

type Measured = Record<string, { width: number; notdef: number }>

for (const theme of ['dark', 'light'] as const) {
  test(`all seventeen glyphs render in the ${theme} theme`, async ({ page }) => {
    await page.goto('/sign-in')
    await page.evaluate((next) => {
      document.documentElement.setAttribute('data-theme', next)
    }, theme)
    await page.evaluate(buildProof(GLYPHS, [...SIZES]))
    // The faces are `font-display: swap`; measuring before they land would
    // measure the fallback. None of the seventeen comes from them, but the
    // stack should be settled all the same.
    await page.evaluate(() => document.fonts.ready)

    const measured = (await page.evaluate(measure(GLYPHS))) as Measured

    const missing: string[] = []
    const tofu: string[] = []
    for (const [name] of GLYPHS) {
      const entry = measured[name]
      if (entry === undefined || entry.width === 0) missing.push(name)
      else if (entry.width === entry.notdef) tofu.push(name)
    }

    expect({ missing, tofu }).toEqual({ missing: [], tofu: [] })

    await page.locator(`#${PROOF_ID}`).screenshot({
      path: `test-results/glyphs-${theme}.png`,
    })
  })
}

test('the three glyphs with emoji forms are forced to text presentation', async ({ page }) => {
  await page.goto('/sign-in')
  await page.evaluate(buildProof(GLYPHS, [...SIZES]))

  /*
   * The variation selector is invisible and has no advance of its own, so it
   * cannot be checked by measuring. What can be checked is that the component
   * asks for text presentation at all - `font-variant-emoji: text` on the
   * element - and that the fallback stack names no emoji face, which is the
   * other half of the fix. The U+FE0E itself is asserted in
   * `tests/glyphs.test.ts`, where it is a string and can simply be read.
   */
  const stack = await page.evaluate(() => {
    const probe = document.querySelector('[data-glyph]')
    if (probe === null) return { fontFamily: '', variant: '' }
    const style = getComputedStyle(probe)
    // `getPropertyValue`, not the camelCase property: `font-variant-emoji` is
    // supported by the browser but is not yet in TypeScript's DOM lib, so the
    // typed accessor does not exist.
    return { fontFamily: style.fontFamily, variant: style.getPropertyValue('font-variant-emoji') }
  })

  expect(stack.fontFamily.toLowerCase()).not.toContain('emoji')
  expect(stack.fontFamily).toContain('Symbol')
  expect([...EMOJI_FORMS]).toHaveLength(3)
})
