import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  // Pin the workspace root: a stray lockfile higher up the filesystem otherwise
  // makes Next guess the wrong root for file tracing.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  env: {
    NEXT_PUBLIC_BUILD_SHA: (process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7),
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Privy's SDK (email sign-in) bundles screens the game never opens: a fiat on-ramp
  // (Stripe's loader) and Farcaster mini-app Solana support. They resolve to empty
  // modules rather than pulling those SDKs into the app.
  webpack(config) {
    config.resolve.alias = { ...config.resolve.alias, '@stripe/stripe-js': false, '@farcaster/mini-app-solana': false }
    return config
  },
  // The API on this site's own origin (/api/*, forwarded to the real API). A session
  // cookie set by another site is third-party, and Brave and Safari block those; through
  // this rewrite it is the page's own cookie. (The API sets no cookie Domain, so it
  // lands on this host.) Off when the API is local or unset.
  async rewrites() {
    const target = (process.env.API_PROXY_TARGET ?? process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
    if (!/^https:\/\//.test(target)) return []
    return [{ source: '/api/:path*', destination: `${target}/:path*` }]
  },
}

export default nextConfig
