import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import fontkit from '@pdf-lib/fontkit'

/**
 * The PDF export's fonts and its font engine - roadmap task 5.3, ADR 0003 D17
 * (`pdf-lib` and `@pdf-lib/fontkit`, pre-approved; nothing else).
 *
 * ## The fonts
 *
 * `assets/fonts/` in this app, read on the server only: **Courier Prime**,
 * the face the pagination engine measures in (AGENTS.md: "the *measured* face
 * (the engine, the cover, the export)"), as TrueType - the `.woff2` files in
 * `public/fonts/` are split into Latin and Latin-ext subsets and pdf-lib embeds
 * a whole face - and **Noto Sans Devanagari**, the fallback for a line in a
 * script Courier Prime has no glyphs for. Both SIL OFL 1.1; the licences sit
 * beside them. They are found from the app's directory or the repository
 * root, so the web process and the worker (a background run's `export_script`)
 * both find them; a server without them answers that in words.
 *
 * ## The shim, and why it is here
 *
 * `@pdf-lib/fontkit` 1.1.1 - every build of it - ships its Indic shaper's
 * state machine compiled with regenerator but without the runtime: the first
 * Devanagari line throws `regeneratorRuntime is not defined`. Supplying the
 * runtime would be a new package (`regenerator-runtime`, not approved); what
 * that one compiled function uses of it is `mark`, `wrap` and a context's
 * `next` / `stop`, so that much is defined below, only when nothing else
 * defined it. `tests/script-pdf.test.ts` shapes a conjunct through it, so an
 * upgrade that fixes or changes the build shows up there.
 */

type Context = { prev: number; next: number | string; sent: unknown; done: boolean; rval: unknown; stop: () => unknown }

type Runtime = {
  readonly mark: <F>(fn: F) => F
  readonly wrap: (inner: (context: Context) => unknown, outer: unknown, self: unknown) => Iterator<unknown> & Iterable<unknown>
}

const holder = globalThis as { regeneratorRuntime?: Runtime }

holder.regeneratorRuntime ??= {
  mark: (fn) => fn,
  wrap: (inner, _outer, self) => {
    const context: Context = {
      prev: 0,
      next: 0,
      sent: undefined,
      done: false,
      rval: undefined,
      stop() {
        this.done = true
        return this.rval
      },
    }
    const generator: Iterator<unknown> & Iterable<unknown> = {
      next: (sent?: unknown) => {
        if (context.done) return { value: undefined, done: true }
        context.sent = sent
        const value = inner.call(self, context)
        return context.done ? { value, done: true } : { value, done: false }
      },
      [Symbol.iterator]: () => generator,
    }
    return generator
  },
}

export { fontkit }

export const FONT_FILES = {
  regular: 'CourierPrime-Regular.ttf',
  italic: 'CourierPrime-Italic.ttf',
  bold: 'CourierPrime-Bold.ttf',
  fallback: 'NotoSansDevanagari-Regular.ttf',
} as const

export type FontName = keyof typeof FONT_FILES

export type FontBytes = Readonly<Record<FontName, Uint8Array>>

const CANDIDATES = [join(process.cwd(), 'assets', 'fonts'), join(process.cwd(), 'apps', 'web', 'assets', 'fonts'), join(process.cwd(), '..', 'web', 'assets', 'fonts')]

let loaded: Promise<FontBytes | null> | null = null

const exists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  )

/** The four font files, read once per process; null when this server does not have them. */
export const readFonts = (): Promise<FontBytes | null> => {
  loaded ??= (async () => {
    for (const dir of CANDIDATES) {
      if (!(await exists(join(dir, FONT_FILES.regular)))) continue
      const [regular, italic, bold, fallback] = await Promise.all([FONT_FILES.regular, FONT_FILES.italic, FONT_FILES.bold, FONT_FILES.fallback].map((file) => readFile(join(dir, file))))
      if (regular === undefined || italic === undefined || bold === undefined || fallback === undefined) return null
      return { regular, italic, bold, fallback }
    }
    return null
  })()
  return loaded
}
