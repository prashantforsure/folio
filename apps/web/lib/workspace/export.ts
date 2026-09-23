/**
 * A text file an export hands back - roadmap task 2.4.
 *
 * The outline's Markdown, the chronology, the two sheets' CSVs and a set's
 * breakdown were built in the browser and nowhere else (AGENT_READINESS_REPORT
 * section 6.2, item 3), so an agent had no way to produce one. Each now has a
 * server function beside its route's loader that builds the same text from the
 * same pure helper, and a server action that gates it (`ROLE.export`, a
 * reader's - ADR 0003 D16 and ruling R2: a download is a read, for the
 * requesting user). The agent's export tools hand the result to the panel as a
 * `download` event; nothing is stored and nothing is sent anywhere else.
 */
export type TextExport = {
  readonly filename: string
  readonly mime: string
  readonly text: string
}

export type TextExportResult =
  | ({ readonly status: 'exported' } & TextExport)
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

export const CSV_MIME = 'text/csv;charset=utf-8'

export const MARKDOWN_MIME = 'text/markdown;charset=utf-8'
