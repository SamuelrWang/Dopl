/**
 * A `local_bridge` device's DELIVERY: a validated capability call → a row on the device's own queue
 * (`dev_device_messages`), which the bridge on the user's network pulls (`bridge/handlers.ts`). The row
 * is a `notify` because the queue's CHECK needs no new kind for one line of text; the adapter's only
 * output decides what it means. 🔒 D3: text is refused when too long, never shortened.
 *
 * `result.lens_message_id` is the same link an even_g2 uses, so `lens-actions.ts` moves the action.
 */
import type { GlassesStore } from "@/features/glasses/core/messages/types";

import { GOOGLE_HOME_SPEAK_MAX_CHARS } from "../../adapters/google-home";
import { failed, type Dispatcher } from "../../adapters/shared";

/** A spoken line is worth nothing a minute late: the row expires rather than talk over the room later. */
export const BRIDGE_MESSAGE_TTL_S = 60;

export function createBridgeDispatcher(deps: { store: Pick<GlassesStore, "insert">; now?: () => number }): Dispatcher {
  const now = deps.now ?? Date.now;
  return async (device, capability, args) => {
    if (capability === "presence.read") {
      return { status: "done", result: { online: device.online, last_seen_at: device.last_seen_at }, error: null };
    }
    if (capability !== "present.speak") return failed("capability_unsupported", `${device.adapter_id} cannot run ${capability}`, device.kind);
    const text = typeof args.text === "string" ? args.text.trim() : "";
    if (!text) return failed("invalid_request", "present.speak: text is required", device.kind);
    if (text.length > GOOGLE_HOME_SPEAK_MAX_CHARS) {
      return failed("invalid_request", `present.speak: text is ${text.length} characters; this device speaks at most ${GOOGLE_HOME_SPEAK_MAX_CHARS}`, device.kind);
    }
    const t = now();
    const row = await deps.store.insert(device.id, {
      kind: "notify",
      card_id: null,
      payload: { title: "", body: text },
      now: new Date(t).toISOString(),
      expires_at: new Date(t + BRIDGE_MESSAGE_TTL_S * 1000).toISOString(),
    });
    return { status: "queued", result: { lens_message_id: row.id }, error: null };
  };
}
