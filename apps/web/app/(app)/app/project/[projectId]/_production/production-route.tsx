import type { EpisodeContext } from '../../../../../../lib/workspace/context'

/**
 * The Production route box. The v1 body was removed (2026-09-22) ahead of the
 * v12 rebuild (`docs/production/production.md`); the page mounts and says so
 * until the rebuilt body lands.
 */
export const ProductionRoute = ({ context }: { readonly context: EpisodeContext }) => (
  <main data-route="production" data-production-state="rebuilding" className="flex min-h-0 flex-1 flex-col items-center justify-center p-[24px]">
    <p className="text-12-5 text-ink3">
      Production is being rebuilt for {context.episode.title}.
    </p>
  </main>
)
