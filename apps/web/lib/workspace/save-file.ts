/**
 * Save a file the server handed back as base64 - a PDF (roadmap task 5.3),
 * which a server action cannot answer with as bytes. The browser's own
 * download, through a Blob URL revoked as soon as the click has it, as the
 * text exports do it inline.
 */
export const saveBase64File = (filename: string, mime: string, base64: string): void => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
