import { evenG2 } from "./even-g2";
import type { GlassesPlatform } from "./types";

const PLATFORMS: Record<string, GlassesPlatform> = { [evenG2.id]: evenG2 };

/**
 * The platform new pairings get, and the one user-scoped work (MCP screens and
 * cards, queued for every device of the user) is compiled for.
 */
export const DEFAULT_PLATFORM: GlassesPlatform = evenG2;

/** The implementation for a device's `platform`; an unknown id falls back to the default. */
export function glassesPlatform(id: string | null | undefined): GlassesPlatform {
  return (id && PLATFORMS[id]) || DEFAULT_PLATFORM;
}
