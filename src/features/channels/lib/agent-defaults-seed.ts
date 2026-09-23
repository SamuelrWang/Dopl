"use client";

/**
 * A just-created channel takes the operator's default agent settings, once. Called from every
 * renderer creation path (home-writes.ts, create-channel-dialog.tsx, direct-message-dialog.tsx);
 * MCP-created channels are seeded by `main/channel-seed-watch.js`.
 * ⚠ A one-time seed, never a launch-time fallback: that would re-point every unconfigured room.
 * Failure is silent by design (the channel already exists); no-op without a desktop bridge.
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

/** Idempotent on main's side: `channels:applyAgentDefaults` refuses a channel that already has a posture. */
export function seedAgentDefaults(channelId: string): void {
  if (!channelId) return;
  const bridge = seedBridge();
  if (!bridge) return;
  void bridge.applyAgentDefaults(channelId).catch(() => {});
}
