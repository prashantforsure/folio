import type { ShareLink } from '@folio/contracts'

/**
 * What the share actions hand back. Discriminated, never a throw across the
 * boundary (AGENTS.md, Conventions > Errors).
 */
export type ShareLinkResult =
  | { readonly status: 'issued'; readonly link: ShareLink }
  | { readonly status: 'revoked' }
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

/** What the header is told: the live link, or nothing. The token is what the URL is made of. */
export type ShareLinkView = {
  readonly token: string
  readonly role: ShareLink['role']
  readonly createdAt: string
} | null
