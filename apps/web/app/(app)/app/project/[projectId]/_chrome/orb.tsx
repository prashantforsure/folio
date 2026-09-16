/**
 * The assistant's orb. `docs/ui design/README.md`, "Assistant": "A
 * radial-gradient sphere (`#e8f6ff → #8fd4ff → #2a7fd4 → #123a72`) with a
 * blue glow." Two sizes in the mockups - 26px in the header, 124px in the
 * panel with a 9s drift, 20px in the panel's title row - and one component.
 *
 * The gradient's stops are hex by the design's own hand and live in
 * `globals.css` as `.folio-orb`, where a hex is a token's business; nothing
 * here names a colour.
 */
export const Orb = ({ size, drift = false }: { readonly size: number; readonly drift?: boolean }) => (
  <span
    aria-hidden="true"
    className={`folio-orb ${drift ? 'folio-orb-drift' : ''}`}
    style={{ width: size, height: size }}
    data-size={size >= 100 ? 'large' : 'small'}
  />
)
