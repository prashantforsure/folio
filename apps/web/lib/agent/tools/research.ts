import { z } from 'zod'

import { ROLE } from '../../auth/roles'
import { loadResearch } from '../../research/server'
import { defineTool } from '../registry'
import type { Tool } from '../registry'

/**
 * `read_research` - `docs/agents/tools.md`, *Research - read-only*. There are
 * no Research write tools: AGENTS.md ruling **R3**, "a model that can edit the
 * evidence cannot be used to check itself".
 *
 * ## What it reads, and what it does not
 *
 * AGENTS.md and `tools.md` both say the per-source `readable` toggle is **the
 * one context gate**, enforced where context is built and never in the UI. No
 * such toggle exists yet - `research_sources` has no `readable` column, and the
 * panel's own copy on the route says "Research sources are not readable yet."
 * So every source is treated as **not readable**: the tool reports the
 * library's shape - collections, each source's title, kind, origin and
 * collection, how many clips were cut from it and where they were filed - and
 * returns **no source text and no clip text**. Reading a source's words is the
 * widening AGENTS.md puts behind a question; it arrives with the toggle.
 */
export const readResearch = defineTool({
  name: 'read_research',
  description:
    "Read the Research library's shape: its collections, each source's title, kind, origin and collection, and how many clips were cut from each and filed to which characters, locations and scenes. " +
    'Source text and clip text are not readable yet, so quote nothing from research; tell the writer what exists and where it is filed.',
  toolset: 'research',
  minimumRole: ROLE.read,
  mode: 'read',
  input: z.object({}),
  label: () => 'Reading the research library',
  run: async (ctx) => {
    const load = await loadResearch({ scope: ctx.gate.scope })
    const filed = (sourceId: string) =>
      load.clips
        .filter((clip) => clip.sourceId === sourceId)
        .flatMap((clip) =>
          clip.filings.map((filing) =>
            filing.kind === 'scene'
              ? { kind: 'scene' as const, scene: filing.ref === null ? null : `E${String(filing.ref.episodeOrdinal)} Sc ${String(filing.ref.number)}` }
              : { kind: filing.kind, name: filing.name },
          ),
        )
    return {
      ok: true,
      content: {
        readable: false,
        collections: load.collections.map((collection) => ({ id: collection.id, name: collection.name })),
        sources: load.sources.map((source) => ({
          id: source.id,
          title: source.title,
          kind: source.kind,
          origin: source.origin,
          collection: source.collection?.name ?? null,
          clips: source.clips,
          filedTo: filed(source.id),
        })),
      },
      summary: `${String(load.sources.length)} ${load.sources.length === 1 ? 'source' : 'sources'}, ${String(load.clips.length)} ${load.clips.length === 1 ? 'clip' : 'clips'}`,
    }
  },
})

export const RESEARCH_TOOLS: readonly Tool[] = [readResearch]
