'use client'

import { setResearchDrawer } from '../../../../../../lib/research/compose'

/**
 * The empty state - `docs/ui design/README.md`, "Empty states": "A single
 * 440px card: heading, one paragraph of plain explanation, an accent AI
 * action plus a manual alternative, and a one-line caveat. Never an
 * illustration." `Route - Research v2.dc.html` draws `Nothing in research
 * yet`, the paragraph, `＋ Add a source` (accent) beside `Paste a link`
 * (hairline), and the caveat `Sources stay as you filed them. Clips point
 * back at the line they came from.`
 *
 * One word of the mockup's paragraph is changed: it files clips "to the
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
  <div data-empty-research className="flex min-h-0 flex-1 items-center justify-center px-[20px] py-[32px]">
    <div className="flex w-full max-w-[440px] flex-col gap-[16px] rounded-panel border border-line2 bg-s1 p-[24px]">
      <div className="flex flex-col gap-[7px]">
        <span className="text-17 font-medium tracking-title">Nothing in research yet</span>
        <span className="text-13 leading-[1.55] text-ink2" style={{ textWrap: 'pretty' }}>
          Drop in articles, PDFs, photos, interviews and recordings. Highlight a line in any of them and it becomes a clip you can file to a
          character, a location or a scene.
        </span>
      </div>
      <div className="flex gap-[8px]">
        <button
          type="button"
          data-empty-add-source
          onClick={() => {
            setResearchDrawer({ kind: 'new' })
          }}
          className="folio-accent-button h-[36px] flex-1 justify-center rounded-[10px] text-13"
        >
          ＋ Add a source
        </button>
        <button
          type="button"
          data-empty-paste-link
          onClick={() => {
            void readLink().then((origin) => {
              setResearchDrawer(origin === undefined ? { kind: 'new', origin: '' } : { kind: 'new', origin })
            })
          }}
          className="folio-line-button h-[36px] flex-none justify-center rounded-[10px] px-[15px] text-13"
          data-line="strong"
        >
          Paste a link
        </button>
      </div>
      <span className="text-11-5 text-ink3">Sources stay as you filed them. Clips point back at the line they came from.</span>
    </div>
  </div>
)
