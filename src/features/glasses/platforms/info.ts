import { EVEN_G2_INFO } from "./even-g2/info";

/**
 * Client-safe facts about each glasses platform, for the settings UI (which
 * the desktop SPA also bundles, so nothing here may reach server code).
 */
export interface PlatformInfo {
  /** `glasses_device_links.platform`. */
  id: string;
  /** Display name, and the default name of a newly paired device. */
  label: string;
  /** The platform's own voice assistant, when it can call Dopl with a per-device key. */
  assistant?: { name: string; setupPath: string };
}

const INFO: Record<string, PlatformInfo> = { [EVEN_G2_INFO.id]: EVEN_G2_INFO };

export function platformInfo(id: string): PlatformInfo | null {
  return INFO[id] ?? null;
}
