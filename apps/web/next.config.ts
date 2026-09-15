import type { NextConfig } from 'next';

/**
 * Next.js configuration.
 *
 * `standalone` output produces a self-contained server bundle, which keeps the
 * production image small — see infra/docker/web.Dockerfile.
 *
 * The security headers below are the browser-facing half of the policy the API
 * enforces on its own responses. A tight CSP matters most here, because this is
 * the origin that holds the session cookie.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  // Next generates AGENTS.md/CLAUDE.md at the repo root on dev start; this
  // repository documents itself under docs/, so the generated files are noise.
  agentRules: false,
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@almajeed/shared'],
  typedRoutes: true,

  async headers() {
    // React's development build uses `eval()` for stack reconstruction and the
    // dev server uses a websocket for hot reload. Both are development-only, so
    // the relaxation is too — production keeps the strict policy, which is the
    // one that actually protects users. Loosening it globally to quieten a dev
    // console is how a real CSP gets thrown away.
    const development = process.env.NODE_ENV !== 'production';

    const csp = [
      "default-src 'self'",
      // Next's runtime needs inline styles; scripts are same-origin only.
      `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      // The browser never calls the API directly — every request goes through
      // this app's route handlers, which attach the token server-side. The
      // websocket is the dev server's hot reload.
      `connect-src 'self'${development ? ' ws: http://127.0.0.1:* http://localhost:*' : ''}`,
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
