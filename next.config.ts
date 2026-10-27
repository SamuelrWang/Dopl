import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * DEV-ONLY, AND IT IS WHY BROWSER-BACK INTO A DEV PAGE CAME BACK DEAD (F-782,
   * measured 2026-10-16 on Next 16.2.2; the same code is still in 16.4.2).
   *
   * With the default `reactDebugChannel: true`, `next dev` keeps React's debug info OUT
   * of the HTML and streams it over the HMR WebSocket, keyed by the document's request id
   * (`self.__next_r`). Hydration waits for that stream to close. The server hands each
   * id's stream out ONCE (`next/dist/server/dev/debug-channel.js ›
   * connectReactDebugChannelForHtmlRequest` deletes it, and silently returns for an
   * unknown id). Browser back/forward re-serves the document from DISK CACHE (dev HTML is
   * `no-cache`, which history navigation skips; the open HMR socket keeps it out of
   * bfcache), so the replayed page asks for an id already spent, never gets its close
   * chunk, and never hydrates: every client hook stays at its SSR `static` mode and every
   * `ssr: false` chunk (and its CSS) never loads — "animations and styling dropped".
   *
   * `false` puts the debug info back inline in the RSC payload. Production never had the
   * channel (it is gated on `__NEXT_DEV_SERVER`), so this changes nothing there.
   */
  experimental: { reactDebugChannel: false },
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
   * The legal pages render `docs/legal/*.md` (`features/marketing/legal/load-legal-doc.ts`).
   * They are `force-static`, so the read happens at build; this traces the two files into
   * the route bundles anyway, so an on-demand render could never find them missing.
   */
  outputFileTracingIncludes: {
    "/services-agreement": ["./docs/legal/SERVICES-AGREEMENT.md"],
    "/privacy": ["./docs/legal/PRIVACY.md"],
  },
  /**
   * `/terms` WAS the terms page until 2026-10-14; it is now the Services Agreement at
   * `/services-agreement`. `permanent: true` is a 308, so every old link, bookmark and
   * the desktop builds already in the wild keep landing on the agreement. Config-level
   * redirects run BEFORE `src/proxy.ts`, so `/terms` needs no proxy or public-route entry.
   */
  async redirects() {
    return [
      { source: "/terms", destination: "/services-agreement", permanent: true },
      // The docs land on Overview (`docs/content/index.ts › DOCS_HOME`); config redirects run
      // before the proxy, so bare `/docs` needs no public-route entry (`/docs/` has one).
      // Temporary since B2 (2026-10-27): the home moved once, and a 308 is cached by browsers.
      { source: "/docs", destination: "/docs/overview", permanent: false },
      // B2 docs restructure (2026-10-27): slugs that left the sidebar keep working. Temporary
      // until the new structure has settled.
      { source: "/docs/start-here", destination: "/docs/overview", permanent: false },
      { source: "/docs/use-cases/connect-devices", destination: "/docs/guides/connect-a-device", permanent: false },
      { source: "/docs/use-cases/routing", destination: "/docs/concepts/context-profiles-and-routing", permanent: false },
      { source: "/docs/devices/meta-ray-ban", destination: "/docs/devices/meta", permanent: false },
      // B3 (2026-10-27): the phone came back as its own Coming soon page (D2 fallback surface).
      { source: "/docs/devices/phone-push", destination: "/docs/devices/phone", permanent: false },
      { source: "/docs/devices/:device(mac-notch|apple-watch)", destination: "/docs/devices", permanent: false },
      // C10 `doc_url` (`@dopl/contracts/device-sdk › ERROR_DOC_BASE`) points at /docs/errors/<code>.
      { source: "/docs/errors/:code", destination: "/docs/api-reference/errors", permanent: false },
      // The API reference's pre-contract pages (2026-10-20) were renamed to the frozen Device
      // SDK contract (`docs/specs/device-sdk/openapi.yaml`); show/ask/notify are Deliver intents.
      { source: "/docs/api-reference/:intent(show|ask|notify)", destination: "/docs/api-reference/deliver", permanent: false },
      { source: "/docs/api-reference/endpoints", destination: "/docs/api-reference/connections", permanent: false },
    ];
  },
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
   * given request. `/pricing`, `/privacy`, `/services-agreement` and `/favicons/*` are excluded
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
      {
        source: "/services-agreement",
        headers: [{ key: "Cache-Control", value: html }],
      },
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
