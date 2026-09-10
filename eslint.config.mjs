import { builtinModules } from 'node:module'

import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Folio lint contract.
 *
 * Everything in here is an error, never a warning. Two groups:
 *
 *   1. The purity boundary around `packages/script`. AGENTS.md, Architecture:
 *      "packages/script importing anything framework- or database-shaped is a
 *      lint error, not a code review comment." That rule is why this file exists.
 *   2. The repo-wide ban list, which encodes the "Deliberately not using" table
 *      in AGENTS.md so a future instance cannot reintroduce one of those
 *      choices out of habit.
 */

// `builtinModules` yields bare names ('fs', 'path'); the handful of builtins
// that are `node:`-only are covered by the `node:*` pattern below.
const BARE_NODE_BUILTINS = builtinModules.filter((m) => !m.startsWith('node:'))

const PURE =
  'packages/script is pure: no React, no Next, no Drizzle, no Zod, no Supabase, no node: builtins, no I/O. ' +
  'It must run identically in the browser, in server code, in the worker and in tests. See AGENTS.md, Development philosophy 2.'

const ICON_LIBRARIES = [
  'lucide-react',
  'lucide-*',
  '@heroicons/*',
  'react-icons',
  'react-icons/*',
  '@radix-ui/react-icons',
  '@tabler/icons-react',
  'phosphor-react',
  '@phosphor-icons/*',
  'feather-icons',
  'react-feather',
  '@fortawesome/*',
]

const COMPONENT_LIBRARIES = [
  '@mui/*',
  '@material-ui/*',
  '@chakra-ui/*',
  'antd',
  'antd/*',
  '@ant-design/*',
  'shadcn',
  'shadcn-ui',
  'shadcn/*',
]

// Hex colours: 3, 4, 6 or 8 digits, not followed by another hex digit.
const HEX_COLOUR = String.raw`#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])`
// Tailwind's `dark:` variant, anywhere in a variant chain.
const DARK_VARIANT = String.raw`\bdark:`
// Tailwind's default cool-toned greys.
const COOL_GREY = String.raw`\b(?:gray|slate)-(?:50|[1-9]00|950)\b`

const HEX_MESSAGE =
  'No hardcoded hex colours outside the token definition file. Tokens are CSS custom properties; theme via data-theme. See AGENTS.md, Conventions > Styling.'
const DARK_MESSAGE =
  'The Tailwind dark: variant is banned. Routes nest a light sheet inside a dark page, so dark: is wrong by construction — theme via data-theme. See AGENTS.md, Deliberately not using.'
const COOL_GREY_MESSAGE =
  'The Tailwind default gray/slate scales are cool-toned. The palette is warm neutral with a terracotta accent. See AGENTS.md, Deliberately not using.'

/**
 * @param {string} regex
 * @param {string} message
 */
const bannedText = (regex, message) => [
  { selector: `Literal[value=/${regex}/]`, message },
  { selector: `TemplateElement[value.raw=/${regex}/]`, message },
  { selector: `JSXText[value=/${regex}/]`, message },
]

const NO_DEFAULT_EXPORT = {
  selector: 'ExportDefaultDeclaration',
  message:
    'No default exports except where Next.js requires them (pages, layouts, route handlers, config files). See AGENTS.md, Conventions > Imports.',
}

const NO_DOUBLE_ASSERTION = {
  selector: 'TSAsExpression > TSAsExpression.expression',
  message:
    'No double type assertion (as unknown as). If the types do not line up, the model is wrong — fix the type. See AGENTS.md, Conventions > Typing.',
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'docs/**',
      '**/next-env.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---------------------------------------------------------------------------
  // Repo-wide ban list. Errors, not warnings.
  // ---------------------------------------------------------------------------
  {
    files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': [
        'error',
        NO_DEFAULT_EXPORT,
        NO_DOUBLE_ASSERTION,
        ...bannedText(HEX_COLOUR, HEX_MESSAGE),
        ...bannedText(DARK_VARIANT, DARK_MESSAGE),
        ...bannedText(COOL_GREY, COOL_GREY_MESSAGE),
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ICON_LIBRARIES,
              message:
                'No icon library. Every glyph is a Unicode character rendered as text. See AGENTS.md, UI fidelity.',
            },
            {
              group: COMPONENT_LIBRARIES,
              message:
                'No opinionated component library (MUI, Chakra, Ant, shadcn). The design system is written and specific. See AGENTS.md, Deliberately not using.',
            },
            {
              group: ['@supabase/supabase-js', '@supabase/ssr', '@supabase/auth-*'],
              message:
                'The Supabase JS client is for auth and storage only. Data access goes through Drizzle in @folio/db. See AGENTS.md, Deliberately not using.',
            },
          ],
        },
      ],
    },
  },

  // The one place a hex colour may be written down. This directory does not
  // exist yet - phase 1 writes no tokens. The exemption is declared up front so
  // the token file can land without a lint-config change.
  {
    files: ['packages/ui/src/tokens/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        NO_DEFAULT_EXPORT,
        NO_DOUBLE_ASSERTION,
        ...bannedText(DARK_VARIANT, DARK_MESSAGE),
        ...bannedText(COOL_GREY, COOL_GREY_MESSAGE),
      ],
    },
  },

  // Auth and storage are the only places the Supabase JS client is allowed.
  // None of these directories exist yet.
  {
    files: [
      'apps/web/lib/auth/**/*.{ts,tsx}',
      'apps/web/lib/storage/**/*.{ts,tsx}',
      'apps/worker/src/storage/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ICON_LIBRARIES, message: 'No icon library.' },
            { group: COMPONENT_LIBRARIES, message: 'No opinionated component library.' },
          ],
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // The purity boundary. The most important block in this file.
  // ---------------------------------------------------------------------------
  {
    files: ['packages/script/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: BARE_NODE_BUILTINS.map((name) => ({ name, message: PURE })),
          patterns: [
            { group: ['node:*'], message: PURE },
            { group: ['react', 'react/*', 'react-dom', 'react-dom/*'], message: PURE },
            { group: ['next', 'next/*', '@next/*'], message: PURE },
            {
              group: ['drizzle-orm', 'drizzle-orm/*', 'drizzle-kit', 'drizzle-kit/*'],
              message: PURE,
            },
            { group: ['zod', 'zod/*'], message: PURE },
            { group: ['@supabase/*'], message: PURE },
            {
              group: ['pg', 'pg/*', 'postgres', 'postgres/*', 'ioredis', 'bullmq', 'bullmq/*'],
              message: PURE,
            },
            { group: ['@folio/ui', '@folio/db', '@folio/contracts'], message: PURE },
            { group: ['@sentry/*', 'posthog-js', 'posthog-node', 'pino', 'pino/*'], message: PURE },
            { group: ['@anthropic-ai/*'], message: PURE },
            { group: ['*.css', '*.scss'], message: PURE },
            ...ICON_LIBRARIES.map((group) => ({ group: [group], message: PURE })),
            ...COMPONENT_LIBRARIES.map((group) => ({ group: [group], message: PURE })),
          ],
        },
      ],
      // Purity is not only about imports: no clock, no entropy, no ambient I/O.
      // AGENTS.md, Development philosophy 2.
      'no-restricted-globals': [
        'error',
        ...[
          'fetch',
          'process',
          'window',
          'document',
          'localStorage',
          'sessionStorage',
          'navigator',
          'XMLHttpRequest',
          'WebSocket',
          'crypto',
        ].map((name) => ({ name, message: PURE })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: PURE },
        { object: 'Math', property: 'random', message: PURE },
      ],
      'no-restricted-syntax': [
        'error',
        NO_DEFAULT_EXPORT,
        NO_DOUBLE_ASSERTION,
        ...bannedText(HEX_COLOUR, HEX_MESSAGE),
        {
          selector: 'NewExpression[callee.name="Date"][arguments.length=0]',
          message: PURE,
        },
      ],
    },
  },

  // Config files and Next.js-owned files are the sanctioned default exports.
  // This block sits after the purity block on purpose: flat config is
  // last-match-wins per rule, so packages/script/vitest.config.ts needs the
  // exemption to come afterwards. It relaxes only no-restricted-syntax — the
  // purity import boundary above still applies to those files.
  {
    files: [
      '**/*.config.{ts,mts,cts,js,mjs,cjs}',
      'apps/web/app/**/{page,layout,route,error,loading,not-found,template,default,global-error}.{ts,tsx}',
      'apps/web/app/**/{icon,apple-icon,opengraph-image,twitter-image,sitemap,robots,manifest}.{ts,tsx}',
      'apps/web/middleware.ts',
      'apps/web/instrumentation.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        NO_DOUBLE_ASSERTION,
        ...bannedText(HEX_COLOUR, HEX_MESSAGE),
        ...bannedText(DARK_VARIANT, DARK_MESSAGE),
        ...bannedText(COOL_GREY, COOL_GREY_MESSAGE),
      ],
    },
  },

  // Test files reach for globals the source may not.
  {
    files: ['**/*.{test,spec}.{ts,tsx}', '**/e2e/**/*.ts', '**/tests/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },

  // This file writes the banned strings down in order to ban them, so the text
  // bans cannot apply to it. Same shape of exemption as the token file.
  {
    files: ['eslint.config.mjs'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
)
