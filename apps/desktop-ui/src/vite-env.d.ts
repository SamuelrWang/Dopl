/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Dev-in-browser only: the API origin `fetch` falls back to when the Electron
   * bridge is absent (e.g. `VITE_API_BASE_URL=https://www.usedopl.com`). Empty
   * = same-origin. Inside Electron this is ignored — main owns the origin.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * The renderer build's identity (`v1.2.3`, or `"dev"` outside a packaged
 * build), inlined by `vite.config.ts`. Consumed by the persisted query
 * cache's buster — see `src/lib/query-client.ts`.
 */
declare const __DOPL_RENDERER_BUILD__: string;
