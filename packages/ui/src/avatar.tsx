import type { CSSProperties } from 'react'

/**
 * The round identity chip. 24px in the rail, larger in a menu.
 *
 * Presentational: it is handed initials and renders them. It does not know what
 * a user is, does not fetch one, and does not derive initials from an email -
 * `apps/web` does that, because "which part of a display name is the initial"
 * is a product question and AGENTS.md, Architecture keeps product questions out
 * of this package.
 *
 * The colour is `--avatar-bg`, a token invented in this phase; see the note at
 * the foot of `tokens/palette.css`.
 */

type AvatarProps = {
  /** One or two characters. The caller decides what they are. */
  readonly initials: string
  /** The full name, for the accessible label and the native tooltip. */
  readonly name: string
  /** A signed URL, or null. Never a raw storage path. */
  readonly imageUrl?: string | null
  readonly size?: number
  readonly className?: string
}

export const Avatar = ({ initials, name, imageUrl, size = 24, className }: AvatarProps) => {
  const style: CSSProperties = {
    width: `${String(size)}px`,
    height: `${String(size)}px`,
    borderRadius: 'var(--radius-full)',
    background: 'var(--avatar-bg)',
    color: 'var(--avatar-ink)',
    fontSize: `${String(Math.round(size * 3.75) / 10)}px`,
    fontWeight: 600,
    display: 'grid',
    placeItems: 'center',
    overflow: 'hidden',
    flex: 'none',
  }

  return (
    <span className={className} style={style} title={name} role="img" aria-label={name}>
      {typeof imageUrl === 'string' && imageUrl.length > 0 ? (
        // Deliberately a plain <img>: next/image wants a configured loader and
        // a remote host allowlist, and this package must not import from `next`
        // at all - it is presentational and framework-agnostic. An avatar is a
        // 24px square already sized by its container; nothing here is worth a
        // build-time image pipeline.
        <img src={imageUrl} alt="" width={size} height={size} style={{ objectFit: 'cover' }} />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  )
}
