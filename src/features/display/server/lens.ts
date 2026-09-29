import { iso, nowOf } from "@/features/glasses/core/clock";
import { isOnline } from "@/features/glasses/core/devices/service";
import { platformOf, RESERVED_CARD_PREFIX, type GlassesDeps } from "@/features/glasses/core/messages/service";
import type { GlassesMessage, GlassesStatus, ScreenPayload } from "@/features/glasses/core/messages/types";
import type { ScreenError } from "@/features/glasses/core/screens/spec";
import { GLASSES_LIMITS as GL, cleanField, cleanList } from "@/features/glasses/core/validation";
import { fitLens, type FitResult } from "../core/degrade";
import type { DisplayBlock, DisplayLayout, Positioned } from "../core/types";

/**
 * **THE LENS COPY OF A DISPLAY** — the caller's own `glasses_messages` row (spec §4.2: always the
 * CALLER's glasses, never a mentioned member's). A display is compiled for the platform through
 * the degradation ladder, then inserted or refreshed by its id (`card_id`); `glasses_ask` keeps
 * its own lens kind (`ask`, the plugin's ask page has priority). Pure over {@link GlassesDeps}.
 */

/** A screen that took a tap is still the screen on the glasses, so it stays replaceable. */
const LIVE: GlassesStatus[] = ["pending", "delivered", "answered"];

export type LensFit = FitResult<ScreenPayload, ScreenError>;

export function compileForLens(deps: GlassesDeps, blocks: Positioned<DisplayBlock>[], layout: DisplayLayout, displayId: string): LensFit {
  const platform = platformOf(deps);
  return fitLens(blocks, layout, { mode: "screen", itemBytes: platform.screenLimits.list_item_bytes }, (p) => {
    const res = platform.compileScreen({ blocks: p.blocks, layout }, displayId);
    return res.ok ? { ok: true, payload: res.payload } : { ok: false, errors: res.errors };
  });
}

export const isReservedLensId = (id: string) => id.startsWith(RESERVED_CARD_PREFIX);

/** Devices: paired at all, and any seen in the last 60s. */
export async function lensState(deps: GlassesDeps, userId: string): Promise<{ paired: boolean; online: boolean }> {
  const devices = await deps.devices.listDevices(userId);
  const now = nowOf(deps);
  return { paired: devices.length > 0, online: devices.some((d) => isOnline(d, now)) };
}

/** Insert the screen, or refresh the live one with the same id (a new screen when it expired). */
export async function pushScreen(
  deps: GlassesDeps,
  userId: string,
  a: { displayId: string; payload: ScreenPayload; spec: unknown; ttlSec: number }
): Promise<GlassesMessage> {
  const now = nowOf(deps);
  const expires = iso(now + a.ttlSec * 1000);
  const existing = await deps.store.findActiveCard(userId, a.displayId, iso(now), "screen", LIVE);
  if (existing) return deps.store.refreshCard(userId, existing.id, a.payload, expires, iso(now), a.spec);
  return deps.store.insert(userId, { kind: "screen", card_id: a.displayId, payload: a.payload, spec: a.spec, expires_at: expires, now: iso(now) });
}

/** `glasses_ask`'s lens row: its own card budgets (question ≤120 B, 2-4 options ≤40 B each). */
export async function pushAsk(
  deps: GlassesDeps,
  userId: string,
  a: { question: string; options: string[]; timeoutSec: number }
): Promise<GlassesMessage> {
  const sanitize = platformOf(deps).sanitizeText;
  const question = cleanField(sanitize, "question", a.question, GL.question);
  const options = cleanList(sanitize, "options", a.options, GL.options, GL.option);
  const now = nowOf(deps);
  return deps.store.insert(userId, {
    kind: "ask",
    card_id: null,
    payload: { question, options },
    expires_at: iso(now + a.timeoutSec * 1000),
    now: iso(now),
  });
}
