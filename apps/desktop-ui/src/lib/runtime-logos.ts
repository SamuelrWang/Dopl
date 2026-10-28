import type { RuntimeLogoResolver } from "@/shared/ui/runtime-logo";

// `?inline` data URIs: the packaged renderer is a `file://` document with no `/img/` root.
const LOGOS = import.meta.glob<string>("../assets/*-logo.svg", {
  eager: true,
  query: "?inline",
  import: "default",
});

/** The SPA's half of `shared/ui/runtime-logo.tsx`: a badge file → its bundled data URI. */
export const spaRuntimeLogo: RuntimeLogoResolver = (file) => LOGOS[`../assets/${file}`] ?? null;
