import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are consumed as source ("just-in-time" packages), so
  // Next compiles them itself. This is what lets cross-package imports be
  // `@folio/script` and never a relative path.
  transpilePackages: ['@folio/contracts', '@folio/db', '@folio/script', '@folio/ui'],
  typedRoutes: true,
}

export default nextConfig
