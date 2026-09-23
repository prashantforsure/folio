import { AGENT_DOWNLOAD_MAX } from '@folio/contracts'

import type { TextExport } from '../../workspace/export'
import type { ToolContext, ToolResult } from '../registry'

/**
 * Hand an export to the writer - ruling **R2**: a download is a read, a file
 * the requesting user could have clicked for themselves. The file goes to the
 * panel as a `download` event, which saves it as a Blob; the model is told the
 * file's name and size, never handed its text, so an export does not fill the
 * context window with a screenplay it already has tools to read.
 */
export const deliver = (ctx: ToolContext, file: TextExport, detail: Readonly<Record<string, unknown>> = {}): ToolResult => {
  if (file.text.length > AGENT_DOWNLOAD_MAX) return { ok: false, message: `${file.filename} is too large to hand over from here; export it from the route instead.` }
  ctx.emit({ type: 'download', filename: file.filename, mime: file.mime, text: file.text })
  return { ok: true, content: { downloaded: file.filename, characters: file.text.length, ...detail }, summary: `Downloaded ${file.filename}` }
}
