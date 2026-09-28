import {
  DISPLAY_METADATA_KEY,
  displayStamp,
  newDisplayId,
} from "@/features/glasses/core/screens/display";
import type { ChannelMessageCreateInput } from "../schema";
import type { ChannelContext } from "./service-shared";

/**
 * **THE TWO DEVICE-AWARE KEYS** (docs/specs/device-aware-messages.md): `metadata.source` (which
 * device a MEMBER posted from) and `metadata.display` (an agent-built display). Both reserved:
 * `service-writes-metadata.ts` strips any caller copy, and they are re-stamped here, after the
 * fold, because `source` needs the SETTLED author kind (an agent never carries one).
 */

export const SOURCE_METADATA_KEY = "source";
export const SERVER_STAMPED_DEVICE_KEYS = [SOURCE_METADATA_KEY, DISPLAY_METADATA_KEY] as const;

export function deviceStamps(
  ctx: ChannelContext,
  input: Pick<ChannelMessageCreateInput, "display">,
  authorKind: "user" | "agent"
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (authorKind === "user" && ctx.messageSource) out[SOURCE_METADATA_KEY] = ctx.messageSource;
  if (input.display) out[DISPLAY_METADATA_KEY] = displayStamp(newDisplayId(), input.display);
  return out;
}
