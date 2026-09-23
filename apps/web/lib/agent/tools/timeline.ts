import { listEpisodes } from '@folio/db'
import type { NodeId } from '@folio/script'
import { formatStoryTime } from '@folio/script'
import { z } from 'zod'

import { ROLE } from '../../auth/roles'
import { chronologyExport, readContinuity, readTimelineFacts } from '../../timeline/server'
import { findingNote, sceneRef } from '../../timeline/view'
import { defineTool } from '../registry'
import type { Tool } from '../registry'
import { deliver } from './download'

/**
 * The Timeline toolset's reads - `docs/agents/tools.md`, *Timeline*, the
 * Phase 2 rows. Loaded on the Timeline route, or by `load_toolset("timeline")`.
 * Timeline never reads a slugline as a date: what it reports is the story
 * time the writer placed, and the check over it (`readContinuity`).
 */

export const runContinuityCheck = defineTool({
  name: 'run_continuity_check',
  description:
    "Run the Timeline's continuity check: every open finding (a scene out of order, someone in two places, a thread that goes quiet...) as the Timeline words it, the scenes with no story time, " +
    "the number of story days, and the placements the script's own time cues suggest. The same check the Timeline draws.",
  toolset: 'timeline',
  minimumRole: ROLE.read,
  mode: 'read',
  input: z.object({}),
  label: () => 'Running the continuity check',
  run: async (ctx) => {
    const read = await readContinuity({ scope: ctx.gate.scope, project: ctx.gate.project, episodes: await listEpisodes(ctx.gate.scope) })
    const { buckets, book, chronology, proposals } = read.continuity
    const byId = new Map(read.scenes.map((scene) => [scene.sceneNodeId, scene]))
    const refOf = (id: NodeId): string => {
      const scene = byId.get(id)
      return scene === undefined ? id : sceneRef(scene)
    }
    const facts = readTimelineFacts(read)
    return {
      ok: true,
      content: {
        // `key` is what mark_finding_deliberate takes (roadmap task 3.5).
        open: buckets.open.map((finding) => ({ key: finding.key, scene: refOf(finding.sceneId), sceneId: finding.sceneId, kind: finding.kind, note: findingNote(finding, book) })),
        notes: buckets.notes.map((finding) => ({ scene: refOf(finding.sceneId), kind: finding.kind, note: findingNote(finding, book) })),
        markedDeliberate: buckets.deliberate.length,
        unplaced: facts.unplaced.map((ref) => `E${String(ref.episodeOrdinal)} Sc ${String(ref.number)}`),
        storyDays: chronology.days.length,
        suggestedPlacements: proposals.map((proposal) => ({ scene: refOf(proposal.sceneNodeId), time: formatStoryTime(proposal.time), reason: proposal.reason, quote: proposal.quote })),
      },
      summary: `${String(buckets.open.length)} open ${buckets.open.length === 1 ? 'finding' : 'findings'}, ${String(facts.unplaced.length)} unplaced`,
    }
  },
})

export const exportChronology = defineTool({
  name: 'export_chronology',
  description: 'Download the story chronology for the writer, as Markdown: the scenes in story order, a heading per story day, the unplaced scenes at the foot.',
  toolset: 'timeline',
  minimumRole: ROLE.export,
  mode: 'read',
  input: z.object({}),
  label: () => 'Exporting the chronology',
  run: async (ctx) => {
    const read = await readContinuity({ scope: ctx.gate.scope, project: ctx.gate.project, episodes: await listEpisodes(ctx.gate.scope) })
    return deliver(ctx, chronologyExport(read, ctx.gate.project.title))
  },
})

export const TIMELINE_TOOLS: readonly Tool[] = [runContinuityCheck, exportChronology]
