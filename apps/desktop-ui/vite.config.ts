import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

/**
 * The renderer's build identity, inlined as `__DOPL_RENDERER_BUILD__` — the
 * persisted query cache's buster (`src/lib/query-client.ts`), so a snapshot
 * written by the previous bundle is dropped after an app update. Read from
 * `dopl-desktop-app/package.json` (this workspace is frozen at 0.1.0);
 * dev/test fall back to a constant.
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
 * 🔒 Supabase storage — the ONLY remote origin a packaged page may load bytes
 * from, images only (workspace icons are public-bucket URLs,
 * `src/features/workspaces/server/icon.ts`). NEVER widen to `https:` or a
 * wildcard: `img-src` is the one hole in `default-src 'none'` and a wildcard
 * turns any rendered URL into an outbound beacon.
 *
 * Mirrors `NEXT_PUBLIC_SUPABASE_URL`, inlined (not env) because it is baked
 * into the shipped HTML — a missing env var would silently block every icon.
 */
const SUPABASE_STORAGE_ORIGIN = "https://mrefkedvdehahjejreae.supabase.co";

/**
 * 🔒 The production Content-Security-Policy for the packaged renderer — the
 * precedent for a LOCAL Electron page in this repo. `default-src 'none'` and
 * no `connect-src` follow from the architecture: the renderer never touches
 * the network; every request goes `window.dopl.apiRequest` → IPC → main
 * (docs/migration-research/desktop-main.md §2).
 *
 * `style-src 'unsafe-inline'` is the one relaxation (React and deps set inline
 * styles / inject <style> tags). `img-src` carries only the Supabase storage
 * origin, for workspace icons (journey-audit GAP-20).
 *
 * CLOSED SEAM — member AVATARS must never get an origin here: they come from
 * OAuth providers (an open-ended set that cannot be pinned) and arrive as
 * `data:` URIs via `window.dopl.avatarDataUri`; main gates and fetches them
 * (`dopl-desktop-app/main/avatar-policy.js`, `main/avatar-cache.js`). A new
 * provider is an allowlist edit in main. Do not widen `img-src` to `https:`.
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
      // `#` = SPA-local source. `@` = the repo-root web tree, same meaning as
      // inside it, so reused web modules' `@/...` imports resolve verbatim.
      // A next-coupled module in the graph fails the build loudly
      // (unresolvable `next/*`) — the guard, plus the eslint fence on
      // `@/app/*`. See CONVENTIONS.md § Sharing code with the web app.
      "#": src,
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
    },
  },
  build: {
    // Inside electron-builder's `renderer/**/*` files glob
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
    // Browser-dev mode (no Electron bridge): reused web clients fetch
    // same-origin "/api/..."; proxy them so both transports see one origin.
    //
    // ⚠ To point browser-dev at a LOCAL `next dev`, use `DOPL_DEV_API_TARGET`
    // (retargets the proxy only), NOT `VITE_API_BASE_URL`: any `VITE_` shell
    // var lands in `import.meta.env`, making api-transport fetch cross-origin —
    // `POST /api/boot` preflights, no route answers OPTIONS, every page errors.
    //   DOPL_DEV_API_TARGET=http://localhost:3000 npm run dev:ui
    // The auth cookie rides along (cookies ignore port).
    proxy: {
      "/api": {
        target:
          process.env.DOPL_DEV_API_TARGET ||
          process.env.VITE_API_BASE_URL ||
          "https://www.usedopl.com",
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
