/**
 * The `@modal` slot's fallback: nothing, on every URL its intercepted
 * sibling (`(.)[characterId]/page.tsx`) does not match - a plain
 * `/characters` visit, another record's plain page, a route Next has not
 * matched a modal for. Required by parallel routes: a slot with no
 * `default.tsx` 404s instead of rendering empty.
 */
const Default = () => null

export default Default
