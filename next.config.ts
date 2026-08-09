import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Expose the Google OAuth client ID to the browser for Google One Tap. The
   * client ID is not a secret (One Tap embeds it in the page), so we alias the
   * existing server-side GOOGLE_CLIENT_ID into the NEXT_PUBLIC_ name the One Tap
   * component reads — no duplicate Vercel env needed. Empty when unset → One Tap
   * stays disabled.
   */
  env: {
    NEXT_PUBLIC_GOOGLE_CLIENT_ID:
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? "",
  },
  /**
   * Keep the workspace MCP packages external (require()'d from node_modules
   * at runtime) rather than bundled. They ship pre-compiled `dist/` and
   * `@dopl/mcp-server` reads its own package.json at runtime (version.ts),
   * which breaks if bundled. The remote MCP route (src/app/api/mcp) imports
   * `@dopl/mcp-server/factory`. NOTE: verify a clean Vercel build — symlinked
   * workspace packages must be traced into the serverless bundle.
   */
  serverExternalPackages: [
    "@dopl/mcp-server",
    "@dopl/client",
    "@modelcontextprotocol/sdk",
  ],
  /**
   * Serve OAuth/MCP discovery metadata at its spec path. A normal API route
   * (/api/oauth-protected-resource) backs it, rewritten from the well-known
   * path to sidestep Next's dot-directory routing ambiguity. Stage 3 adds the
   * authorization-server metadata the same way.
   */
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/oauth-protected-resource",
      },
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/oauth-authorization-server",
      },
    ];
  },
  /**
   * THE ONLY RESPONSE HEADERS THIS PROJECT SETS (P0-4, 2026-08-07). Before this,
   * neither `vercel.json` (crons only) nor this file set a single one, so every
   * marketing page, legal page and favicon was served on Next's default
   * `public, max-age=0, must-revalidate` — a full revalidation round-trip per
   * asset per visit, for files that change a few times a year.
   *
   * THIS IS INERT WITHOUT THE MATCHER CHANGE IN `src/proxy.ts`, WHICH IS WHY THAT
   * LANDED FIRST. `getClaims()` can rotate the Supabase session cookie onto the
   * response, and a `Set-Cookie` overrides any shared-cache directive — a
   * `s-maxage` on a proxy-matched path is a promise the runtime can revoke on any
   * given request. `/pricing`, `/privacy`, `/terms` and `/favicons/*` are excluded
   * from the matcher now, so nothing in this list can acquire a `Set-Cookie`.
   *
   * `/` IS DELIBERATELY ABSENT even though it is the highest-traffic prerendered
   * page. It is still matched by the proxy (its signed-in bounce cannot move
   * client-side — see the `config` comment in `src/proxy.ts` and ENGINEERING.md
   * §9.4), so it is exactly the case above: a shared-cache directive there would
   * be a claim this app cannot keep. It gets one the day `/` leaves the matcher.
   *
   * TWO PROFILES, and the split is about who can be stranded:
   *   • HTML — `max-age=0` so a browser always revalidates and a corrected legal
   *     page is visible on the next view, `s-maxage=3600` so the CDN absorbs the
   *     traffic, `stale-while-revalidate` so an expiry is never a user-visible
   *     wait. A conditional request that 304s costs no body.
   *   • ICONS / OG CARD — same shape, longer, but NOT `immutable` and NOT a
   *     one-year `max-age`: these filenames are NOT content-hashed (`/_next/static`
   *     is, and Next owns that one), so an immutable directive would strand a
   *     stale mark in every browser that ever loaded it through the next rebrand.
   *     One hour in the browser, a week at the edge, a month of serving stale.
   */
  async headers() {
    const html =
      "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";
    const asset =
      "public, max-age=3600, s-maxage=604800, stale-while-revalidate=2592000";
    return [
      { source: "/pricing", headers: [{ key: "Cache-Control", value: html }] },
      { source: "/privacy", headers: [{ key: "Cache-Control", value: html }] },
      { source: "/terms", headers: [{ key: "Cache-Control", value: html }] },
      {
        source: "/favicons/:path*",
        headers: [{ key: "Cache-Control", value: asset }],
      },
      {
        source: "/favicon.ico",
        headers: [{ key: "Cache-Control", value: asset }],
      },
      {
        // The OG/Twitter card. Every link-preview scrape pulls it, and scrapers
        // do not share a cache with the visitor's browser — the edge TTL is the
        // one that matters here.
        source: "/img/:path*",
        headers: [{ key: "Cache-Control", value: asset }],
      },
    ];
  },
};

export default nextConfig;
