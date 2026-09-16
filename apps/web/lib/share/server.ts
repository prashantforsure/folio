import { readShareLink } from '@folio/db'
import type { ProjectScope } from '@folio/db'

import type { ShareLinkView } from './result'

/** The live link as the header's popover is told it. One scoped read. */
export const loadShareLink = async (scope: ProjectScope): Promise<ShareLinkView> => {
  const link = await readShareLink(scope)
  if (link === null) return null
  return { token: link.token, role: link.role, createdAt: link.createdAt }
}

/** The path a share link opens. The origin is the browser's; the server never composes a URL it did not receive. */
export const sharePath = (token: string): `/share/${string}` => `/share/${token}`
