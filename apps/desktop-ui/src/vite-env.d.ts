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
