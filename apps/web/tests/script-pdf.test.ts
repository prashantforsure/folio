// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Episode, Measurement, Project } from '@folio/contracts'
import { episodeId, episodeSlug, measurementId, projectId } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import type { ScreenplayNode } from '@folio/script'
import { documentId, nodeId, paginate, printMeasureOf, printPages, resolveSheet, text, typed } from '@folio/script'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'

/**
 * The PDF export - roadmap task 5.3.
 *
 *   - The file is the record's pages on the sheet: a cover, then one PDF page
 *     per measured page, US Letter, in Courier Prime; a line Courier Prime has
 *     no glyphs for is drawn in the Devanagari fallback, shaped (the fontkit
 *     shim's test: a conjunct is one glyph).
 *   - It is drawn from the **stored** measurement when its digest matches the
 *     nodes, and from a measurement made now when it does not - never from a
 *     stale record.
 *   - The asian format refuses (open decision 8), and `export_script` hands a
 *     PDF over as base64 in the `download` event.
 */

const spies = vi.hoisted(() => ({ db: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>> }))

vi.mock('@folio/db', async (actual) => {
  const real = await actual<Record<string, unknown>>()
  const names = ['readDocumentByKind', 'readScreenplayNodes', 'readMeasurement', 'readMeasurementLayout', 'readMentionLabels', 'readLatestLockedPages', 'readTitlePage', 'listEpisodes']
  for (const name of names) spies.db[name] = vi.fn()
  return { ...real, ...Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.db[name]?.(...args)])) }
})

const { writeScriptPdf, runsOf } = await import('../lib/script/pdf')
const { fontkit } = await import('../lib/script/pdf-fonts')
const { exportScriptPdfWith, exportProjectPdfWith } = await import('../lib/script/pdf-export')
const { nodeDigest } = await import('../lib/script/server')
const { exportScript } = await import('../lib/agent/tools/script')

const PROJECT = projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10')
const EPISODE = { id: episodeId('1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a'), projectId: PROJECT, ordinal: 1, slug: episodeSlug('ep_001'), title: 'Pilot', revisionColour: 'white' } as Episode
const project = (format: 'hollywood' | 'asian' = 'hollywood') => ({ id: PROJECT, title: 'The Last Ferry', projectType: 'film', format, pageMode: 'paged', liveRepaginate: false }) as Project
const gate = (format: 'hollywood' | 'asian' = 'hollywood') => ({ actor: 'u' as never, scope: {} as ProjectScope, project: project(format), episode: EPISODE, role: 'writer' as const })

/** A stored measurement's header, as `readMeasurement` answers it - only the digest decides anything here. */
const storedMeasurement = (digest: string): Measurement => ({
  id: measurementId('5e1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'),
  projectId: PROJECT,
  episodeId: EPISODE.id,
  documentId: documentId('9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'),
  format: 'hollywood',
  pageMode: 'paged',
  liveRepaginate: false,
  sheet: {},
  totalPages: 2,
  totalLines: 60,
  totalScenes: 1,
  totalEighths: 9,
  nodeDigest: digest,
  computedAt: '2026-09-24T00:00:00.000Z',
})

const sheet = (() => {
  const resolved = resolveSheet('hollywood')
  if (!resolved.ok) throw new Error('no sheet')
  return resolved.value
})()

let n = 0
const node = (type: 'scene' | 'action' | 'character' | 'dialogue', content: string): ScreenplayNode => {
  n += 1
  const base = { id: nodeId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`), provenance: typed(), content: [text(content)] }
  return type === 'character' ? { type, ...base, modifiers: [] } : { type, ...base }
}

/** A two-page script: a heading, sixty lines of action, a speech in Hindi and English. */
const script = (): readonly ScreenplayNode[] => [
  node('scene', 'EXT. JETTY - DAWN'),
  ...Array.from({ length: 12 }, () => node('action', 'The ferry pulls away from the jetty. Gulls lift off the pilings, one by one, and settle again.')),
  node('character', 'MEERA'),
  node('dialogue', 'नमस्ते - the ferry is late again, क्षमा करें.'),
]

const fontsIn = async (bytes: Uint8Array): Promise<readonly string[]> => {
  const pdf = await PDFDocument.load(bytes)
  const names: string[] = []
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict && object.get(PDFName.of('Type'))?.toString() === '/Font') names.push(object.get(PDFName.of('BaseFont'))?.toString() ?? '')
  }
  return names
}

beforeEach(() => {
  vi.clearAllMocks()
  spies.db['readDocumentByKind']?.mockResolvedValue({ id: documentId('9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'), kind: 'screenplay' })
  spies.db['readMentionLabels']?.mockResolvedValue([])
  spies.db['readLatestLockedPages']?.mockResolvedValue([])
  spies.db['readTitlePage']?.mockResolvedValue(null)
  spies.db['readMeasurement']?.mockResolvedValue(null)
})

describe('the fonts', () => {
  it('shapes Devanagari through the fontkit shim: a conjunct is one glyph, and the i-matra moves before its consonant', () => {
    const face = fontkit.create(readFileSync(join(process.cwd(), 'assets', 'fonts', 'NotoSansDevanagari-Regular.ttf')))
    expect(face.layout('क्ष').glyphs).toHaveLength(1)
    // Typed first, drawn second: the matra (U+093F) is reordered before the consonant (U+0915).
    expect(face.layout('कि').glyphs.map((glyph) => glyph.codePoints)).toEqual([[0x93f], [0x915]])
  })

  it('draws a character Courier Prime has in Courier Prime, and a run it has none for in the fallback, spaces joining their run', () => {
    const courier = new Set([...'MEERA the ferry '].map((char) => char.codePointAt(0) ?? 0))
    const deva = new Set([...'नमस्ते '].map((char) => char.codePointAt(0) ?? 0))
    expect(runsOf('the ferry नमस्ते नमस्ते MEERA', courier, deva)).toEqual([
      { text: 'the ferry ', at: 0, fallback: false },
      { text: 'नमस्ते नमस्ते ', at: 10, fallback: true },
      { text: 'MEERA', at: 24, fallback: false },
    ])
  })
})

describe('writeScriptPdf', () => {
  it('writes a cover and then a US Letter page per measured page, in Courier Prime and the Devanagari fallback', async () => {
    const nodes = script()
    const record = paginate(nodes, { format: 'hollywood', pageMode: 'paged', liveRepaginate: false })
    if (!record.ok) throw new Error('refused')
    const pages = printPages(nodes, printMeasureOf(record.value), [])
    if (!pages.ok) throw new Error('refused')
    const pdf = await writeScriptPdf(sheet, [{ kind: 'title', lines: [{ line: 18, leftPx: 300, text: 'THE LAST FERRY', style: 'bold' }] }, ...pages.value.map((page, index) => ({ kind: 'script' as const, page, numbered: index > 0 }))], { title: 'The Last Ferry', author: null })
    if (!pdf.ok) throw new Error(pdf.message)
    const read = await PDFDocument.load(pdf.bytes)
    expect(read.getPageCount()).toBe(1 + record.value.pages.length)
    expect(read.getPage(1).getSize()).toEqual({ width: 612, height: 792 })
    expect(read.getTitle()).toBe('The Last Ferry')
    const fonts = await fontsIn(pdf.bytes)
    expect(fonts.some((name) => name.includes('CourierPrime-Regular'))).toBe(true)
    expect(fonts.some((name) => name.includes('CourierPrime-Bold'))).toBe(true)
    expect(fonts.some((name) => name.includes('NotoSansDevanagari'))).toBe(true)
  })
})

describe('exportScriptPdfWith', () => {
  it('draws from the stored measurement when its digest matches the script - measuring nothing', async () => {
    const nodes = script()
    const record = paginate(nodes, { format: 'hollywood', pageMode: 'paged', liveRepaginate: false })
    if (!record.ok) throw new Error('refused')
    spies.db['readScreenplayNodes']?.mockResolvedValue({ ok: true, value: nodes.map((entry) => ({ node: entry })) })
    spies.db['readMeasurement']?.mockResolvedValue(storedMeasurement(nodeDigest(nodes)))
    spies.db['readMeasurementLayout']?.mockResolvedValue({ pages: record.value.pages, runs: new Map(record.value.nodes.map((entry) => [String(entry.id), entry.runs])) })
    const result = await exportScriptPdfWith(gate())
    expect(result).toMatchObject({ status: 'exported', filename: 'Pilot.pdf', pages: record.value.pages.length, source: 'stored' })
    expect(spies.db['readMeasurement']).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'hollywood', 'paged')
  })

  it('measures again when the stored measurement is stale, and never reads its layout', async () => {
    const nodes = script()
    spies.db['readScreenplayNodes']?.mockResolvedValue({ ok: true, value: nodes.map((entry) => ({ node: entry })) })
    spies.db['readMeasurement']?.mockResolvedValue(storedMeasurement('stale-digest-of-another-list'))
    const result = await exportScriptPdfWith(gate())
    expect(result).toMatchObject({ status: 'exported', source: 'computed' })
    expect(spies.db['readMeasurementLayout']).not.toHaveBeenCalled()
  })

  it('refuses the asian format - its sheet width is open decision 8 - and an episode with no script says so', async () => {
    expect(await exportScriptPdfWith(gate('asian'))).toMatchObject({ status: 'refused' })
    spies.db['readDocumentByKind']?.mockResolvedValue(null)
    expect(await exportScriptPdfWith(gate())).toEqual({ status: 'error', message: 'There is no script to export yet.' })
  })

  it('exports every episode with a script for the project card, skipping the empty ones', async () => {
    const nodes = script()
    const second = { ...EPISODE, id: episodeId('2d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a'), ordinal: 2, slug: episodeSlug('ep_002'), title: 'Two' } as Episode
    spies.db['listEpisodes']?.mockResolvedValue([second, EPISODE])
    spies.db['readDocumentByKind']?.mockImplementation((_scope: unknown, episode: unknown) => Promise.resolve(episode === EPISODE.id ? { id: documentId('9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'), kind: 'screenplay' } : null))
    spies.db['readScreenplayNodes']?.mockResolvedValue({ ok: true, value: nodes.map((entry) => ({ node: entry })) })
    const result = await exportProjectPdfWith({ actor: 'u' as never, scope: {} as ProjectScope, project: project(), role: 'writer' })
    expect(result).toMatchObject({ status: 'exported', filename: 'The-Last-Ferry.pdf', source: 'computed' })
  })
})

describe('export_script as PDF', () => {
  it('hands the file over as base64 in the download event, and tells the model its name and pages', async () => {
    const nodes = script()
    spies.db['readScreenplayNodes']?.mockResolvedValue({ ok: true, value: nodes.map((entry) => ({ node: entry })) })
    const emit = vi.fn()
    const result = await exportScript.run({ gate: gate(), runId: 'r' as never, idempotencyKey: 'k', emit, loaded: new Set(), proposals: { propose: vi.fn(), earlier: () => undefined, applyNow: vi.fn() } } as never, { format: 'pdf' })
    expect(result).toMatchObject({ ok: true, summary: 'Downloaded Pilot.pdf', content: { downloaded: 'Pilot.pdf', measurement: 'computed' } })
    const event = emit.mock.calls[0]?.[0] as { type: string; filename: string; mime: string; encoding: string; text: string }
    expect(event).toMatchObject({ type: 'download', filename: 'Pilot.pdf', mime: 'application/pdf', encoding: 'base64' })
    expect(Buffer.from(event.text, 'base64').subarray(0, 5).toString()).toBe('%PDF-')
  })
})
