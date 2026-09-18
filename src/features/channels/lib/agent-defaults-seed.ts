"use client";

/**
 * THE INHERITANCE POINT — a channel that was JUST CREATED takes the operator's default agent
 * settings as its own (Samuel, 2026-09-18).
 *
 * ⚠ **ONE FUNCTION, CALLED FROM EVERY CREATION SUCCESS PATH, AND NOWHERE ELSE.** The three
 * callers are the three ways a channel comes into existence in this app: the account surface's
 * "New channel" (`apps/desktop-ui/src/pages/home/home-writes.ts`), the workspace channel dialog
 * (`components/create-channel-dialog.tsx`) and the DM dialog (`components/direct-message-dialog.tsx`).
 * A fourth creation surface needs this line; a reader adding one should grep for this module.
 *
 * ⚠ **IT IS A SEED, NOT A FALLBACK, AND THE DISTINCTION IS THE REQUIREMENT.** It COPIES the
 * defaults into the new channel's own local records, once. It does not make an unconfigured
 * channel read the defaults at launch time — that would re-point every room the operator has
 * never opened Settings for, which is precisely what "existing channels untouched" rules out, and
 * `main/agent-defaults.js` states the second reason (it would be an ambient posture read at a
 * spawn no human is attending, which is what H2 forbids).
 *
 * ⚠ **FIRE AND FORGET, AND A FAILURE IS SILENT ON PURPOSE.** The channel is already created and
 * the operator is already looking at it; a toast about a local preference that did not copy would
 * report a problem nobody can act on, and a rejected promise here must never fail a creation that
 * the server has already accepted. An unseeded channel is simply a channel at manual/ask — the
 * value it had before this feature existed.
 *
 * ⚠ **NOT AVAILABLE IN A PLAIN BROWSER, AND THAT IS NOT AN ERROR.** The record is local to the
 * desktop, so the web build feature-detects to null and this is a no-op there.
 */

interface DoplAgentDefaultsSeedBridge {
  applyAgentDefaults: (
    channelId: string
  ) => Promise<{ ok: boolean; seeded?: boolean }>;
}

function seedBridge(): DoplAgentDefaultsSeedBridge | null {
  if (typeof window === "undefined") return null;
  // ⚠ Local cast, not a `Window` augmentation — see `@/shared/lib/desktop`.
  const channels = (window as unknown as { dopl?: { channels?: unknown } }).dopl
    ?.channels as Partial<DoplAgentDefaultsSeedBridge> | undefined;
  if (!channels) return null;
  return typeof channels.applyAgentDefaults === "function"
    ? (channels as DoplAgentDefaultsSeedBridge)
    : null;
}

/**
 * Copy the operator's default agent settings into a channel that was just created.
 *
 * ⚠ IDEMPOTENT ON MAIN'S SIDE: `channels:applyAgentDefaults` refuses a channel that already has a
 * posture, so a retry, a double-mounted dialog or a second window racing the same creation cannot
 * rewrite a room. Callers do not have to guard.
 */
export function seedAgentDefaults(channelId: string): void {
  if (!channelId) return;
  const bridge = seedBridge();
  if (!bridge) return;
  void bridge.applyAgentDefaults(channelId).catch(() => {});
}
