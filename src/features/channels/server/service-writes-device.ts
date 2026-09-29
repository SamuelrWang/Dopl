import { displayFromEscalation } from "@/features/display/core/adapt";
import {
  DISPLAY_METADATA_KEY,
  DISPLAY_SPEC_VERSION,
  newDisplayId,
  type DisplayEnvelopeV2,
} from "@/features/display/core/types";
import type { ChannelMessageCreateInput } from "../schema";
import type { ChannelContext } from "./service-shared";

/**
 * **THE TWO DEVICE-AWARE KEYS** (docs/specs/device-aware-messages.md, docs/specs/unified-display.md):
 * `metadata.source` (which device a MEMBER posted from) and `metadata.display` (a display). Both
 * reserved: `service-writes-metadata.ts` strips any caller copy, and they are re-stamped here, after
 * the fold, because `source` needs the SETTLED author kind (an agent never carries one).
 *
 * `display` is written by two doors: a validated `display` input (the display service), and an
 * `escalation` (`dopl_request_decision`), whose display is BUILT from it — every decision is a display.
 */

export const SOURCE_METADATA_KEY = "source";
export const SERVER_STAMPED_DEVICE_KEYS = [SOURCE_METADATA_KEY, DISPLAY_METADATA_KEY] as const;

/** The server-owned half of a display envelope (never caller input): `PostMessageOptions.display`. */
export type DisplayStampOptions = Partial<Pick<DisplayEnvelopeV2, "display_id" | "wait_until" | "glasses_message_id" | "origin">>;

export function displayEnvelope(
  input: Pick<ChannelMessageCreateInput, "display" | "escalation">,
  opts: DisplayStampOptions = {}
): DisplayEnvelopeV2 | null {
  const display = input.display
    ? { blocks: input.display.blocks, layout: input.display.layout, origin: opts.origin ?? ("dopl_show" as const) }
    : input.escalation
      ? { blocks: displayFromEscalation(input.escalation), layout: "stack" as const, origin: "dopl_request_decision" as const }
      : null;
  if (!display) return null;
  return {
    spec_version: DISPLAY_SPEC_VERSION,
    display_id: opts.display_id ?? newDisplayId(),
    blocks: display.blocks,
    ...(display.layout === "absolute" && { layout: "absolute" as const }),
    ...(opts.wait_until && { wait_until: opts.wait_until }),
    ...(opts.glasses_message_id && { glasses_message_id: opts.glasses_message_id }),
    origin: display.origin,
  };
}

export function deviceStamps(
  ctx: ChannelContext,
  input: Pick<ChannelMessageCreateInput, "display" | "escalation">,
  authorKind: "user" | "agent",
  display?: DisplayStampOptions
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (authorKind === "user" && ctx.messageSource) out[SOURCE_METADATA_KEY] = ctx.messageSource;
  const envelope = displayEnvelope(input, display);
  if (envelope) out[DISPLAY_METADATA_KEY] = envelope;
  return out;
}
