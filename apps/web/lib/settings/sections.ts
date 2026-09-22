/**
 * The account settings sections, in order.
 *
 * One table so the nav, the body and the breadcrumb cannot disagree about
 * which sections exist or what each one is called. `handoff-account-v2/`'s
 * seven, verbatim, because each one is a real question about an account even
 * where this product's answer is "not yet, and here is why".
 *
 * ## Which section is showing is client state, not a query param
 *
 * AGENTS.md, Routing: "Sub-views are query params, never separate routes" -
 * and adding one is behind "ask first". Every route rebuilt since 2026-09-16
 * has taken the client's ruling of that day instead (Characters, then the
 * Storyboard, Scenes, Locations, the Timeline): the view is React state and
 * the URL does not move. Settings follows them. A stale `?section=plan` link
 * opens Profile rather than a 404, because nothing here reads the query.
 */

export const SETTINGS_SECTIONS = [
  'profile',
  'plan',
  'editor',
  'notifications',
  'team',
  'apps',
  'security',
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export type SectionSpec = {
  readonly name: string
  readonly title: string
  readonly blurb: string
}

export const SECTION: Readonly<Record<SettingsSection, SectionSpec>> = {
  profile: {
    name: 'Profile',
    title: 'Profile',
    blurb: 'How you appear on notes, revisions and shared drafts.',
  },
  plan: {
    name: 'Plan & credits',
    title: 'Plan & credits',
    blurb: 'Writing is unlimited. Credits are spent on generation, and they belong to a project.',
  },
  editor: {
    name: 'Editor defaults',
    title: 'Editor defaults',
    blurb: 'What the editor does before you have told it otherwise.',
  },
  notifications: {
    name: 'Notifications',
    title: 'Notifications',
    blurb: 'What leaves the app, and what does not.',
  },
  team: {
    name: 'Collaborators',
    title: 'Collaborators',
    blurb: 'Everyone you share a project with, and what a role means today.',
  },
  apps: {
    name: 'Integrations',
    title: 'Integrations',
    blurb: 'The formats Folio reads and writes, and the tools it does not talk to yet.',
  },
  security: {
    name: 'Security',
    title: 'Security',
    blurb: 'Sign-in, devices, and everything that ends in a confirmation.',
  },
}
