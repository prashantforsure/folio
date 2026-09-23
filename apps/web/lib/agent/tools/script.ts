import { listEpisodes } from '@folio/db'
import { z } from 'zod'

import { ROLE } from '../../auth/roles'
import { outlineExport } from '../../outline/server'
import { exportScriptFdxWith, exportScriptFountainWith } from '../../script/core'
import { exportScriptPdfWith } from '../../script/pdf-export'
import { readPageCount } from '../../script/page-count'
import { defineTool } from '../registry'
import type { Tool, ToolContext } from '../registry'
import { deliver, deliverBinary } from './download'

/**
 * The Script and Outline toolset's reads - `docs/agents/tools.md`, *Script and
 * outline*, the Phase 2 rows. Loaded on the Script, Outline and Scenes routes,
 * or by `load_toolset("script")`.
 */

const EpisodeNumber = z.number().int().min(1).describe('An episode number - its place in the running order. Omit for the one the writer has open.')

/** The episode a tool means: the one named by number, else the one the turn is about. */
const episodeFor = async (ctx: ToolContext, ordinal: number | undefined) => {
  if (ordinal === undefined || ordinal === ctx.gate.episode.ordinal) return ctx.gate.episode
  const episodes = await listEpisodes(ctx.gate.scope)
  return episodes.find((entry) => entry.ordinal === ordinal) ?? null
}

export const getPageCount = defineTool({
  name: 'get_page_count',
  description:
    "Count an episode's pages the way the page view does: the total, its eighths, and each scene's pages and length. Reads the stored measurement when it is current and measures the script on the server when it is not. " +
    'Always use this for page counts and scene lengths - never estimate them.',
  toolset: 'script',
  minimumRole: ROLE.read,
  mode: 'read',
  input: z.object({ episode: EpisodeNumber.optional() }),
  label: () => 'Counting pages',
  run: async (ctx, input) => {
    const episode = await episodeFor(ctx, input.episode)
    if (episode === null) return { ok: false, message: `There is no episode ${String(input.episode)}.` }
    const result = await readPageCount(ctx.gate.scope, ctx.gate.project, episode)
    if (result.status !== 'ok') return { ok: false, message: result.message }
    return { ok: true, content: { episode: episode.ordinal, ...result.count }, summary: `${String(result.count.pages)} ${result.count.pages === 1 ? 'page' : 'pages'}` }
  },
})

export const exportScript = defineTool({
  name: 'export_script',
  description:
    "Download an episode's script for the writer, as Final Draft (.fdx), Fountain (.fountain) or PDF (.pdf) - the PDF laid out page for page as the Script route paginates it, with its title page. Comments never go into an export.",
  toolset: 'script',
  minimumRole: ROLE.export,
  mode: 'read',
  input: z.object({ format: z.enum(['fdx', 'fountain', 'pdf']), episode: EpisodeNumber.optional() }),
  label: (input) => `Exporting the script as ${input.format === 'fdx' ? 'Final Draft' : input.format === 'pdf' ? 'PDF' : 'Fountain'}`,
  run: async (ctx, input) => {
    const episode = await episodeFor(ctx, input.episode)
    if (episode === null) return { ok: false, message: `There is no episode ${String(input.episode)}.` }
    if (input.format === 'pdf') {
      const result = await exportScriptPdfWith({ ...ctx.gate, episode })
      if (result.status !== 'exported') return { ok: false, message: result.message }
      return deliverBinary(ctx, { filename: result.filename, mime: 'application/pdf', base64: result.base64 }, { pages: result.pages, measurement: result.source })
    }
    if (input.format === 'fdx') {
      const result = await exportScriptFdxWith({ ...ctx.gate, episode })
      if (result.status !== 'exported') return { ok: false, message: result.message }
      return deliver(ctx, { filename: result.filename, mime: 'application/xml', text: result.xml }, { commentsLeftOut: result.omitted })
    }
    const result = await exportScriptFountainWith({ ...ctx.gate, episode })
    if (result.status !== 'exported') return { ok: false, message: result.message }
    return deliver(ctx, { filename: result.filename, mime: 'text/plain;charset=utf-8', text: result.text }, { commentsLeftOut: result.omitted })
  },
})

export const exportOutline = defineTool({
  name: 'export_outline',
  description: "Download an episode's outline for the writer, as Markdown - what is saved, the same file the Outline menu exports.",
  toolset: 'script',
  minimumRole: ROLE.export,
  mode: 'read',
  input: z.object({ episode: EpisodeNumber.optional() }),
  label: () => 'Exporting the outline',
  run: async (ctx, input) => {
    const episode = await episodeFor(ctx, input.episode)
    if (episode === null) return { ok: false, message: `There is no episode ${String(input.episode)}.` }
    const result = await outlineExport(ctx.gate.scope, episode)
    if (result.status !== 'exported') return { ok: false, message: result.message }
    return deliver(ctx, result)
  },
})

export const SCRIPT_TOOLS: readonly Tool[] = [getPageCount, exportScript, exportOutline]
