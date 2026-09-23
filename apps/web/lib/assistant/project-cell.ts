import type { EpisodeSlug, ProjectId } from '@folio/contracts'

import type { WorkspaceShape } from '../workspace/hrefs'
import { createCell } from '../workspace/open-cell'
import type { RailSection, WorkspaceRoute } from '../workspace/routes'

/**
 * Which project the assistant panel is inside, published by the workspace
 * shell (roadmap task 2.2).
 *
 * The panel is mounted once, app-wide, by `app/(app)/_shell/assistant-host.tsx`
 * - above both shells - so it survives every navigation. What it needs to know
 * about the project (the episode it reads, the route, the rail section) is the
 * project shell's, which is a layout below it; the shell publishes it here
 * after every render and clears it on unmount, and the host reads it. The
 * `lib/characters/facts.ts` shape, for the same reason: two trees, one cell.
 *
 * `null` means no project is open, and the host draws the launcher (ADR 0003
 * **D15**) instead of a chat.
 */
export type AssistantProject = {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  /** The episode the panel reads: the URL's, else the shell's fallback (last opened, else first). */
  readonly episode: EpisodeSlug
  readonly episodeCount: number
  /** `Episode 2 · Standpipe`, for the project-scoped routes' subhead. */
  readonly reading: string | null
  readonly section: RailSection | null
  readonly route: WorkspaceRoute | null
}

const cell = createCell<AssistantProject | null>(null)

export const publishAssistantProject = cell.set

export const useAssistantProject = cell.use
