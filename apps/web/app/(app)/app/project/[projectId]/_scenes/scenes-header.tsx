import { enterScenes } from '../../../../../../lib/scenes/server'
import { count } from '../../../../../../lib/workspace/format'
import type { SubViews } from '../../../../../../lib/workspace/params'
import { ROUTE_TITLE } from '../../../../../../lib/workspace/routes'
import { PageHeader } from '../../../../_shell/page-header'
import type { RouteAddress } from '../_chrome/episode-route-page'

/**
 * The Scenes header: title and the live scene count.
 *
 * `Route - Scenes.dc.html`, the `<header>`: title in Newsreader 21px, then a
 * count chip. The bundle titles it "Scene Board"; the route is titled
 * `Scenes` everywhere else (`ROUTE_TITLE`, the nav, the smoke test), and
 * `Route - Script.dc.html` wins on chrome, so the title is the route's.
 *
 * The three view tabs the bundle draws after the chip left this header on
 * 2026-09-17 for the shell header's centre, where every route's views are
 * drawn (`lib/workspace/views.ts`, `_chrome/header-views.tsx`) - with the
 * icons the v2 mockup gives them, which this pre-redesign header never
 * had. `?view=` is still the sub-view param (`params.ts`): a view is a URL
 * that survives being pasted into Slack, and an unknown value is a 404
 * before this renders.
 *
 * The bundle's other two header controls are not drawn: `＋ New scene`
 * because a scene is never created here - it comes from a heading, through
 * derivation - and `⤒ Export scene report` because export is a queued job
 * that does not exist yet and a button that does nothing is a placeholder.
 *
 * The count is `scene_derivations` rows in state `present` for this
 * document - the same read the body uses, shared through `cache()`. It counts
 * to zero legitimately, so it prints `0`, never `—`.
 */

export type ScenesView = SubViews<'scenes'>['view']

export const ScenesHeader = async ({ address }: { readonly address: RouteAddress }) => {
  const { load } = await enterScenes(address.projectId, address.segment)
  const scenes = load.state === 'script' ? load.scenes.length : 0

  return <PageHeader title={ROUTE_TITLE.scenes} badge={count(scenes)} />
}
