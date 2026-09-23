import type { PrintedPage, SheetSpec, TitleLine } from '@folio/script'
import type { PDFFont, PDFPage } from 'pdf-lib'
import { PDFDocument } from 'pdf-lib'

import type { FontBytes } from './pdf-fonts'
import { fontkit, readFonts } from './pdf-fonts'

/**
 * Draw a script as PDF - roadmap task 5.3, AGENTS.md *Export*: "Export must
 * agree with on-screen pagination exactly."
 *
 * Nothing here decides where anything goes. `@folio/script`'s `printPages`
 * and `printTitlePage` place every line from the measurement record and the
 * sheet (`packages/script/src/print.ts`); this turns those lines into PDF
 * operators - the sheet's 96-dpi pixels into points (×0.75), the line index
 * into a baseline under the sheet's top margin, the text into glyphs.
 *
 * ## Two faces on one line
 *
 * Courier Prime draws everything it has a glyph for. A run of characters it
 * has none for - Devanagari, in a script that mixes Hindi and English - is
 * drawn in Noto Sans Devanagari, shaped by fontkit (conjuncts, the `ि` matra
 * before its consonant). Each run starts where the monospace sheet puts that
 * character, so the Latin on a mixed line stays on the grid the engine
 * counted; the fallback's own advances inside a run are the font's. The engine
 * breaks such a line where it counts characters, which is where the screen
 * breaks it too - the run's drawn width is the one thing a proportional face
 * decides.
 *
 * ## The page number
 *
 * The page's label (`12`, `12A`) with a full stop, top right, half an inch
 * down, on every page but a section's first - the screenplay convention. The
 * label is the record's: past a lock it continues as the engine numbers it
 * (AGENTS.md open decision 12, implemented and not ruled - printed as
 * measured, by the client's ruling of 2026-09-24).
 */

const PT_PER_PX = 0.75
const TYPE_SIZE = 12

/** One page of the file: a section's cover, or a page of its script. */
export type PdfPage =
  | { readonly kind: 'title'; readonly lines: readonly TitleLine[] }
  | { readonly kind: 'script'; readonly page: PrintedPage; readonly numbered: boolean }

export type PdfMeta = { readonly title: string; readonly author: string | null }

export type PdfOutcome = { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly message: string }

export const NO_FONTS = 'The PDF fonts are not on this server (apps/web/assets/fonts), so a PDF cannot be drawn here.'

type Faces = { readonly regular: PDFFont; readonly italic: PDFFont; readonly bold: PDFFont; readonly fallback: PDFFont; readonly has: ReadonlySet<number> }

/** Split a line into runs by the face that has its glyphs; each run carries its offset in the line, in the characters the sheet counts. */
export const runsOf = (text: string, courier: ReadonlySet<number>, fallback: ReadonlySet<number>): readonly { readonly text: string; readonly at: number; readonly fallback: boolean }[] => {
  const runs: { text: string; at: number; fallback: boolean }[] = []
  let at = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    // A character Courier Prime has is Courier's; one only the fallback has is the fallback's; a space joins the run it is in.
    const inFallback = code === 0x20 ? (runs.at(-1)?.fallback ?? false) : !courier.has(code) && fallback.has(code)
    const last = runs.at(-1)
    if (last !== undefined && last.fallback === inFallback) last.text += char
    else runs.push({ text: char, at, fallback: inFallback })
    at += char.length
  }
  return runs
}

const drawLine = (page: PDFPage, sheet: SheetSpec, faces: Faces, fallbackSet: ReadonlySet<number>, line: number, leftPx: number, text: string, font: PDFFont): void => {
  const height = page.getHeight()
  const baseline = height - (sheet.marginTopPx + line * sheet.lineHeightPx) * PT_PER_PX - TYPE_SIZE * 0.8
  for (const run of runsOf(text, faces.has, fallbackSet)) {
    if (run.text.trim() === '') continue
    page.drawText(run.text, { x: (leftPx + run.at * sheet.charWidthPx) * PT_PER_PX, y: baseline, size: TYPE_SIZE, font: run.fallback ? faces.fallback : font })
  }
}

/** The file, page by page, on the sheet's geometry. */
export const writeScriptPdf = async (sheet: SheetSpec, pages: readonly PdfPage[], meta: PdfMeta, fonts: FontBytes | null = null): Promise<PdfOutcome> => {
  const bytes = fonts ?? (await readFonts())
  if (bytes === null) return { ok: false, message: NO_FONTS }
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const [regular, italic, bold, fallback] = await Promise.all([
    doc.embedFont(bytes.regular, { subset: true }),
    doc.embedFont(bytes.italic, { subset: true }),
    doc.embedFont(bytes.bold, { subset: true }),
    doc.embedFont(bytes.fallback, { subset: true }),
  ])
  const faces: Faces = { regular, italic, bold, fallback, has: new Set(regular.getCharacterSet()) }
  const fallbackSet = new Set(fallback.getCharacterSet())
  const size: [number, number] = [sheet.widthPx * PT_PER_PX, sheet.heightPx * PT_PER_PX]

  for (const entry of pages) {
    const page = doc.addPage(size)
    if (entry.kind === 'title') {
      for (const line of entry.lines) drawLine(page, sheet, faces, fallbackSet, line.line, line.leftPx, line.text, line.style === 'bold' ? bold : regular)
      continue
    }
    for (const line of entry.page.lines) drawLine(page, sheet, faces, fallbackSet, line.line, line.leftPx, line.text, line.style === 'italic' ? italic : regular)
    if (entry.numbered) {
      const label = `${entry.page.label}.`
      const right = (sheet.widthPx - sheet.element.action.rightPx) * PT_PER_PX
      page.drawText(label, { x: right - regular.widthOfTextAtSize(label, TYPE_SIZE), y: page.getHeight() - (sheet.marginTopPx / 2) * PT_PER_PX - TYPE_SIZE * 0.8, size: TYPE_SIZE, font: regular })
    }
  }

  doc.setTitle(meta.title)
  if (meta.author !== null) doc.setAuthor(meta.author)
  doc.setCreator('Folio')
  doc.setProducer('Folio')
  return { ok: true, bytes: await doc.save() }
}
