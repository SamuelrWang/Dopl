import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

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
 * OPEN SEAM — `img-src 'self' data: blob:` blocks remote avatars and workspace
 * icons (Supabase storage URLs). When the first page that renders them is
 * ported, either proxy the bytes through main (preferred — keeps `connect-src
 * 'none'` honest) or add that exact origin here. Do not widen to `https:`.
 */
const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
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
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test-setup.ts"],
    restoreMocks: true,
  },
});
