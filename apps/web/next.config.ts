import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are consumed as source ("just-in-time" packages), so
  // Next compiles them itself. This is what lets cross-package imports be
  // `@folio/script` and never a relative path.
  transpilePackages: ['@folio/contracts', '@folio/db', '@folio/script', '@folio/ui'],
  typedRoutes: true,
  // A character portrait arrives through a server action as form data
  // (`lib/characters/actions.ts`, `uploadPortrait`), capped at 5 MB by the
  // contract; the default 1 MB body limit would refuse it before the action
  // ran. Nothing else sends a body near this.
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
}

export default nextConfig
