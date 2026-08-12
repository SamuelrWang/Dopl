import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

/**
 * The renderer's BUILD IDENTITY, inlined as `__DOPL_RENDERER_BUILD__`.
 *
 * It exists for one consumer: the persisted query cache's buster
 * (`src/lib/query-client.ts`). A dehydrated snapshot survives on disk across
 * launches, so it also survives an app UPDATE — and the entry it restores was
 * written by the previous bundle's understanding of every response shape. The
 * web app keys its buster to the Vercel deployment id; the packaged renderer
 * has no deployment, so the Electron app's version is the equivalent event:
 * shipping a new version is exactly when the bundle can have changed.
 *
 * Read from `dopl-desktop-app/package.json` (the version electron-builder
 * stamps into the app) rather than this workspace's own, which is frozen at
 * 0.1.0. Dev/test fall back to a constant — a dev restart is not a release.
 */
function rendererBuildId(): string {
  try {
    const pkg = readFileSync(
      new URL("../../dopl-desktop-app/package.json", import.meta.url),
      "utf8"
    );
    const version = (JSON.parse(pkg) as { version?: string }).version;
    return version ? `v${version}` : "dev";
  } catch {
    return "dev";
  }
}

/**
 * Supabase storage — the ONLY remote origin any packaged page is allowed to
 * load bytes from, and images only. Workspace icons are public-bucket objects
 * (`src/features/workspaces/server/icon.ts` → `getPublicUrl`), so `iconUrl` on
 * every rail tile is an absolute URL on this host. Pinned to the exact project
 * origin on purpose: NEVER widen this to `https:` or a wildcard subdomain —
 * `img-src` is the one hole in `default-src 'none'` and a wildcard would turn
 * any rendered URL into an outbound beacon.
 *
 * Mirrors `NEXT_PUBLIC_SUPABASE_URL`. Inlined rather than read from the
 * environment because this string is baked into the shipped HTML at build
 * time: a missing/typo'd env var would silently ship a policy that blocks
 * every icon again, which is exactly the bug this fixes.
 */
const SUPABASE_STORAGE_ORIGIN = "https://mrefkedvdehahjejreae.supabase.co";

/**
 * The production Content-Security-Policy for the packaged renderer.
 *
 * Modelled on the session window's page CSP
 * (`dopl-desktop-app/renderer/session/session.html:8`), which is the precedent
 * for a LOCAL Electron page in this repo. `default-src 'none'` and no
 * `connect-src` are a consequence of the target architecture, not a constraint
 * on it: the renderer never touches the network — every request goes through
 * `window.dopl.apiRequest` → IPC → the main process (see
 * docs/migration-research/desktop-main.md §2).
 *
 * `style-src 'unsafe-inline'` is the one relaxation: React and several deps
 * set inline `style` attributes and inject <style> tags at runtime.
 *
 * `img-src` carries the exact Supabase storage origin so workspace icons load
 * (`WorkspaceSwitcherCore`'s glyph `<img src={ws.iconUrl}>` — journey-audit
 * GAP-20; the rail that first motivated this was removed 2026-08-11).
 *
 * CLOSED SEAM — member AVATARS do not need an origin here and must never get
 * one. They are NOT Supabase URLs: `profiles.avatar_url` is copied from the
 * OAuth provider's `raw_user_meta_data` (see
 * `supabase/migrations/20260731090000_profiles_display_name_bounds.sql:85`),
 * so they resolve to `lh3.googleusercontent.com`,
 * `avatars.githubusercontent.com`, and whatever future providers return — an
 * open-ended set that CANNOT be pinned. They now arrive as `data:` URIs
 * instead: `@/shared/hooks/use-bridged-image-src` asks main over
 * `window.dopl.avatarDataUri`, main gates the destination
 * (`dopl-desktop-app/main/avatar-policy.js`) and fetches it bounded + cached
 * (`main/avatar-cache.js`), and the renderer only ever receives inline bytes.
 * A new avatar provider is a one-line allowlist edit in main, never a change
 * here. Do not widen `img-src` to `https:`.
 */
const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${SUPABASE_STORAGE_ORIGIN}`,
  "font-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join("; ");

function doplCsp(): Plugin {
  return {
    name: "dopl-csp",
    apply: "build",
    transformIndexHtml(html) {
      if (!html.includes("<head>")) {
        // The CSP is the renderer's ONLY containment under file:// — a
        // silent no-op replace would ship an unrestricted document.
        throw new Error("dopl-csp: <head> marker missing from index.html");
      }
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}" />`
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), doplCsp()],
  define: {
    __DOPL_RENDERER_BUILD__: JSON.stringify(rendererBuildId()),
  },
  // Relative asset URLs — the packaged renderer is loaded with `loadFile`, so
  // every absolute "/assets/..." would resolve to the filesystem root.
  base: "./",
  resolve: {
    alias: {
      // `#` = SPA-local source. `@` = the REPO-ROOT web tree — the same
      // meaning `@/` has inside that tree, so a reused web module's own
      // `@/shared/...` / `@/features/...` imports resolve verbatim with no
      // edits. This is what makes the port playbook's reuse-by-import
      // instruction executable; a next-coupled module that sneaks into the
      // graph fails the vite build LOUDLY (unresolvable `next/*`), which is
      // the guard — plus the eslint fence on `@/app/*`. See CONVENTIONS.md
      // § Sharing code with the web app.
      "#": src,
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
    },
  },
  build: {
    // Lands inside the Electron app's `files: ["main/**/*", "renderer/**/*"]`
    // glob, so electron-builder picks it up with no config change
    // (docs/migration-research/packages-and-build.md §4).
    outDir: fileURLToPath(
      new URL("../../dopl-desktop-app/renderer/app", import.meta.url)
    ),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
  },
  server: {
    // Fixed so DOPL_UI_DEV_URL in the desktop app never has to chase a port.
    port: 5173,
    strictPort: true,
    // Browser-dev mode (no Electron bridge): the REUSED web feature clients
    // fetch same-origin ("/api/..."); proxy them to the API so both
    // transports see one origin — mirroring the packaged topology where
    // both funnel into main. VITE_API_BASE_URL keeps parity with
    // api-transport's dev base.
    proxy: {
      "/api": {
        target: process.env.VITE_API_BASE_URL || "https://www.usedopl.com",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test-setup.ts"],
    restoreMocks: true,
  },
});
