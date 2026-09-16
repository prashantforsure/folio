'use client'

import { setResearchDrawer } from '../../../../../../lib/research/compose'
import { EmptyCard } from '../_chrome/empty-card'

/**
 * The empty state - `docs/ui design/README.md`, "Empty states", as the
 * shared `_chrome/empty-card.tsx` draws it. `Route - Research v2.dc.html`
 * writes `Nothing in research yet`, the paragraph, `＋ Add a source`
 * (accent) beside `Paste a link` (hairline), and the caveat `Sources stay
 * as you filed them. Clips point back at the line they came from.`
 *
 * One phrase of the mockup's paragraph is changed: it files clips "to the
 * Bible, a character or a scene", and the Bible was removed
 * (`docs/build-decisions.md`, "Bible route removed"). The three places a
 * clip can go are a character, a location and a scene, and the sentence
 * says so. Flagged: specified copy, edited because it named a route that
 * does not exist.
 *
 * `Paste a link` opens the same drawer with the origin filled from the
 * clipboard when the browser will say what is on it and it is a URL;
 * otherwise the drawer opens with the origin field empty and focused.
 */
const readLink = async (): Promise<string | undefined> => {
  try {
    const text = (await navigator.clipboard.readText()).trim()
    return /^https?:\/\/\S+$/.test(text) ? text : undefined
  } catch {
    return undefined
  }
}

export const EmptyResearch = () => (
  <EmptyCard
    attr="data-empty-research"
    title="Nothing in research yet"
    body="Drop in articles, PDFs, photos, interviews and recordings. Highlight a line in any of them and it becomes a clip you can file to a character, a location or a scene."
    primary={{
      label: '＋ Add a source',
      attr: 'data-empty-add-source',
      onClick: () => {
        setResearchDrawer({ kind: 'new' })
      },
    }}
    secondary={{
      label: 'Paste a link',
      attr: 'data-empty-paste-link',
      onClick: () => {
        void readLink().then((origin) => {
          setResearchDrawer(origin === undefined ? { kind: 'new', origin: '' } : { kind: 'new', origin })
        })
      },
    }}
    caveat="Sources stay as you filed them. Clips point back at the line they came from."
  />
)
