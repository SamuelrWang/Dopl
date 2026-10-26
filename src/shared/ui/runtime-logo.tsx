"use client";

import { createContext, useContext } from "react";

/** Runtime id → its badge file. Codex is OpenAI's, so it wears the ChatGPT mark; a runtime with
 *  no entry (Cursor) draws no badge. */
const RUNTIME_LOGO_FILE: Readonly<Record<string, string>> = {
  claude: "claude-logo.svg",
  codex: "chatgpt-logo.svg",
  grok: "grok-logo.svg",
  muse: "muse-logo.svg",
};

/** A file name → the URL this host serves it at. The web serves `public/img/onboarding/`; the
 *  packaged SPA is a `file://` document with its own bundled copies, so it provides its own. */
export type RuntimeLogoResolver = (file: string) => string | null;

const webLogo: RuntimeLogoResolver = (file) => `/img/onboarding/${file}`;

function logoOf(resolve: RuntimeLogoResolver, runtime: string | null | undefined): string | null {
  const file = runtime ? RUNTIME_LOGO_FILE[runtime] : undefined;
  return file ? resolve(file) : null;
}

/** The web's URL for a runtime's badge, for data that is built outside React (the landing demo). */
export function webRuntimeLogo(runtime: string | null | undefined): string | null {
  return logoOf(webLogo, runtime);
}

const RuntimeLogoContext = createContext<RuntimeLogoResolver>(webLogo);

export const RuntimeLogoProvider = RuntimeLogoContext.Provider;

/** The logo URL for a runtime id, or `null` when the runtime is unknown or has no mark. */
export function useRuntimeLogo(): (runtime: string | null | undefined) => string | null {
  const resolve = useContext(RuntimeLogoContext);
  return (runtime) => logoOf(resolve, runtime);
}
