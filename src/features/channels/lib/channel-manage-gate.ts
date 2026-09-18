import { meetsMinRole, type Role } from "@/features/workspaces/types";
import type { Channel } from "../types";

/**
 * Client mirror of `server/service-shared.ts › canManageChannel` — channel
 * owner, or workspace admin.
 *
 * ⚠ ONE DECLARATION (wave 1 review, 2026-09-17). The expression was spelled at
 * three call sites plus a test stub; mirroring a server gate in four places is
 * how an affordance comes to disagree with the route behind it.
 * ⚠ A PICTURE, NOT A FENCE — the route's own check is the fence. This exists so
 * a control that would always 403 is never drawn (INVARIANTS §5).
 */
export function canManageChannelHere(
  channel: Pick<Channel, "role">,
  role: Role
): boolean {
  return channel.role === "owner" || meetsMinRole(role, "admin");
}
