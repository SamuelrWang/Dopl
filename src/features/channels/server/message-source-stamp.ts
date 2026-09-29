import { platformInfo } from "@/features/glasses/platforms/info";

/** The `metadata.source` shape and the pure half of `message-source.ts` (no server imports, so
 *  the glasses voice handlers can build one). docs/specs/device-aware-messages.md. */

type MessageSourceKind = "glasses" | "computer" | "web" | "phone";

export interface MessageSourceStamp {
  kind: MessageSourceKind;
  device_id?: string;
  /** The device name at write time; the UI prefers the live name when `device_id` resolves. */
  label: string;
  platform?: string;
}

export const WEB_SOURCE: MessageSourceStamp = { kind: "web", label: "Web" };
export const UNREGISTERED_COMPUTER: MessageSourceStamp = { kind: "computer", label: "Computer" };

export function glassesMessageSource(device: { id: string; name: string; platform: string }): MessageSourceStamp {
  const label = device.name.trim() || platformInfo(device.platform)?.label || "Glasses";
  return { kind: "glasses", device_id: device.id, label, platform: device.platform };
}

