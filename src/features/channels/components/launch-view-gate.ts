"use client";

/**
 * Whether the Agents tab shows its launch control for THIS view (2026-09-08).
 * With NO thread open the launch is channel-level and the capability alone decides
 * (Samuel, 2026-08-24: the button is on the tab whether or not a thread is open;
 * 2026-09-08: "i dont see the new agent button" — the gate had required a thread).
 * With a thread open the caller must be a PARTY to it, as before.
 */
export function launchAllowedInView(
  canLaunch: boolean,
  openThread: { createdBy: string; targetUserId: string | null } | null | undefined,
  currentUserId: string
): boolean {
  if (!canLaunch) return false;
  if (!openThread) return true;
  return openThread.createdBy === currentUserId || openThread.targetUserId === currentUserId;
}
