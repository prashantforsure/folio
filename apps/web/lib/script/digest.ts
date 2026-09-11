/**
 * A short, stable digest of a JSON-serialisable value, the same in the
 * browser and on the server.
 *
 * The Script route's save asks the server for a measurement record - every
 * save recomputes one - but with `liveRepaginate` the client has already run
 * the same pure engine over the same nodes with the same inputs, so the two
 * records are byte-identical and sending 400 KB of it back down for a
 * feature is waste. The client sends this digest of its own record; the
 * server digests its own; if they agree, the response carries no record and
 * the client keeps what it drew. If they differ - a label changed under it,
 * a page was locked on the Revisions route - the server's record comes down
 * as before. Correctness never rests on the digest: the only thing it can
 * cost is a record the client already had.
 *
 * FNV-1a, 64 bits as two 32-bit halves, over `JSON.stringify`. Not a
 * security primitive and not `node:crypto` - this runs in a Client
 * Component too. `nodeDigest` in `server.ts` stays SHA-256 because it is
 * stored and compared across processes; this one is compared once, in
 * flight.
 */
export const digestOf = (value: unknown): string => {
  const text = JSON.stringify(value)
  let a = 0x811c9dc5
  let b = 0x01000193 ^ 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    a ^= code
    a = Math.imul(a, 0x01000193) >>> 0
    b ^= code
    b = Math.imul(b, 0x01000193) >>> 0
    b ^= b >>> 15
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}:${String(text.length)}`
}
