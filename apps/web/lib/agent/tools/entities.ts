import { listEpisodes } from '@folio/db'
import { z } from 'zod'

import { ROLE } from '../../auth/roles'
import { previewRename as previewCharacterRename } from '../../characters/actions'
import { charactersCsv } from '../../characters/server'
import { previewRename as previewLocationRename } from '../../locations/actions'
import { locationBreakdownCsv, locationsCsv } from '../../locations/server'
import { defineTool } from '../registry'
import type { Tool } from '../registry'
import { deliver } from './download'

/**
 * The Characters, Locations and Props toolset's reads - `docs/agents/tools.md`,
 * the Phase 2 rows of *Characters, locations and props*. Loaded on those three
 * routes, or by `load_toolset("entities")`.
 */

export const previewRename = defineTool({
  name: 'preview_rename',
  description:
    'See what renaming a character or a location would change, without changing anything: how many cues or scene headings would be rewritten in each episode, which other spellings stay, and whether the new name is already taken. ' +
    'Use it before suggesting a rename.',
  toolset: 'entities',
  minimumRole: ROLE.read,
  mode: 'read',
  input: z.object({
    entity: z.enum(['character', 'location']),
    id: z.uuid().describe("The record's id."),
    name: z.string().trim().min(1).max(200).describe('The new name.'),
  }),
  label: (input) => `Previewing a ${input.entity} rename`,
  run: async (ctx, input) => {
    if (input.entity === 'character') {
      const result = await previewCharacterRename(ctx.gate.project.id, input.id, input.name)
      if (result.status !== 'preview') return { ok: false, message: result.message }
      return { ok: true, content: result, summary: `${String(result.cues)} ${result.cues === 1 ? 'cue' : 'cues'} would change` }
    }
    const result = await previewLocationRename(ctx.gate.project.id, input.id, input.name)
    if (result.status !== 'preview') return { ok: false, message: result.message }
    return { ok: true, content: result, summary: `${String(result.headings)} ${result.headings === 1 ? 'heading' : 'headings'} would change` }
  },
})

export const exportEntitiesCsv = defineTool({
  name: 'export_entities_csv',
  description:
    'Download a spreadsheet for the writer: "characters" (the cast list, with optional words, share and per-episode columns), "locations" (the location sheet, the series or one episode), ' +
    'or "breakdown" (one location\'s scene-by-scene breakdown, by its id).',
  toolset: 'entities',
  minimumRole: ROLE.export,
  mode: 'read',
  input: z.discriminatedUnion('sheet', [
    z.object({ sheet: z.literal('characters'), words: z.boolean().default(false), share: z.boolean().default(false), episodes: z.boolean().default(false) }),
    z.object({ sheet: z.literal('locations'), episode: z.number().int().min(1).optional().describe('One episode by number; omit for the series.') }),
    z.object({ sheet: z.literal('breakdown'), locationId: z.uuid() }),
  ]),
  label: (input) => `Exporting the ${input.sheet} CSV`,
  run: async (ctx, input) => {
    const episodes = await listEpisodes(ctx.gate.scope)
    const context = { scope: ctx.gate.scope, project: ctx.gate.project, episodes }
    switch (input.sheet) {
      case 'characters':
        return deliver(ctx, await charactersCsv(context, { words: input.words, share: input.share, episodes: input.episodes }))
      case 'locations': {
        const ordinal = input.episode ?? null
        if (ordinal !== null && !episodes.some((episode) => episode.ordinal === ordinal)) return { ok: false, message: `There is no episode ${String(ordinal)}.` }
        return deliver(ctx, await locationsCsv(context, ordinal))
      }
      case 'breakdown': {
        const file = await locationBreakdownCsv(context, input.locationId)
        return file === null ? { ok: false, message: 'That location could not be found.' } : deliver(ctx, file)
      }
    }
  },
})

export const ENTITY_TOOLS: readonly Tool[] = [previewRename, exportEntitiesCsv]
