import type { ReactNode } from 'react'

import { ThemeProvider, themeScript } from '../lib/state/theme'
import './globals.css'

/**
 * The document. Everything else nests inside this.
 *
 * ## `data-theme="dark"` is written on the server
 *
 * AGENTS.md, UI fidelity: "Theme is `dark` by default, via `data-theme`." The
 * attribute is rendered here rather than left to the client so the very first
 * byte of HTML already carries a theme - `packages/ui`'s tokens key off it, and
 * an element with no `data-theme` ancestor would otherwise be styled by
 * `:root`'s fallback for one frame.
 *
 * `themeScript` then corrects it to the stored preference before first paint.
 * It has to be inline and it has to be here: any script that arrives over the
 * network arrives after the first paint, which is the flash. See
 * `lib/state/theme.tsx` for why React's copy of the theme starts at the default
 * rather than reading storage.
 *
 * `suppressHydrationWarning` on `<html>` is scoped to that one element's
 * attributes and is exactly what it is for: the script mutates `data-theme`
 * between the server render and hydration, on purpose, and React would
 * otherwise report the difference it was asked to allow.
 *
 * ## Fonts are preloaded, and only the two that paint chrome
 *
 * `font-display: swap` means text is visible immediately in a fallback face and
 * reflows when the real one arrives. Preloading the two faces that draw the
 * shell removes that reflow for the frame most likely to be seen. Courier Prime
 * is deliberately not preloaded: nothing on a sign-in page or the shell is set
 * in it, and preloading a face nothing uses is a wasted request that the
 * browser also warns about.
 */

export const metadata = {
  title: 'Folio',
  description: 'Write a screenplay and carry it through to production.',
}

const RootLayout = ({ children }: { readonly children: ReactNode }) => (
  <html lang="en" data-theme="dark" suppressHydrationWarning>
    <head>
      <link
        rel="preload"
        href="/fonts/instrument-sans-400-700-latin.woff2"
        as="font"
        type="font/woff2"
        crossOrigin="anonymous"
      />
      <link
        rel="preload"
        href="/fonts/newsreader-400-600-latin.woff2"
        as="font"
        type="font/woff2"
        crossOrigin="anonymous"
      />
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
    </head>
    <body>
      <ThemeProvider>{children}</ThemeProvider>
    </body>
  </html>
)

export default RootLayout
