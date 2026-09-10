/**
 * Tailwind v4 runs as a single PostCSS plugin. There is no `tailwind.config.js`
 * and there must not be one: the theme is declared in CSS, in
 * `packages/ui/src/tokens/theme.css`, so the tokens and the utilities that
 * expose them are the same artefact rather than two that can disagree.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
