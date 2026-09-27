import { createHash } from "node:crypto";
import type { MenuSession } from "./menu-types";
import { sanitizeGlassesText } from "./text";

/**
 * The "who is working right now" strip under the wearer's last message — the
 * glasses twin of the channel page's agent bar. Built from the same live
 * session rows (`channel_sessions.state` / `detail`, pushed by each operator's
 * desktop) and the same vocabulary as `dopl_read_channel`'s session line
 * (`packages/mcp-server/src/tools/channel-session-render.ts › detailPhrase`):
 *
 *   detail `thinking`                    → `thinking`
 *   detail `tool` (or none, while working) → `working` (detail = tool name, own sessions only)
 *   detail `posting`                     → `replying`
 *   detail `permission`                  → `waiting` (detail "needs approval")
 *   detail `awaiting_peer`               → `waiting` (detail "waiting on an agent")
 *
 * Omitted: `idle` / `ended` sessions, a working session merely holding an
 * inbound reply (`awaiting_inbound` — listening, not working), and any row
 * older than the 120s staleness window (`SESSION_STALE_WINDOW_MS`), which no
 * longer asserts a live state.
 */

export type ActivityState = "thinking" | "working" | "replying" | "waiting";

export interface ChannelActivity {
  session_id: string;
  name: string;
  state: ActivityState;
  detail?: string;
}

export const ACTIVITY_STALE_MS = 120_000;
const NAME_MAX = 40;

function stateOf(s: MenuSession): { state: ActivityState; detail?: string } | null {
  if (s.state === "ended") return null;
  if (s.detail === "permission") return { state: "waiting", detail: "needs approval" };
  if (s.state !== "working") return null;
  switch (s.detail) {
    case "thinking":
      return { state: "thinking" };
    case "posting":
      return { state: "replying" };
    case "awaiting_peer":
      return { state: "waiting", detail: "waiting on an agent" };
    case "awaiting_inbound":
      return null;
    default:
      return { state: "working" };
  }
}

export function channelActivity(sessions: MenuSession[], ownerId: string, now: number): ChannelActivity[] {
  const out: ChannelActivity[] = [];
  for (const s of sessions) {
    const at = s.updatedAt ? Date.parse(s.updatedAt) : NaN;
    if (!Number.isFinite(at) || now - at >= ACTIVITY_STALE_MS) continue;
    const st = stateOf(s);
    if (!st) continue;
    const name = (sanitizeGlassesText(s.displayName ?? "") || `agent-${s.agentId}`).slice(0, NAME_MAX);
    // The tool name is operator telemetry: only for the wearer's own sessions.
    const tool = st.state === "working" && s.userId === ownerId && s.toolLabel ? sanitizeGlassesText(s.toolLabel).slice(0, NAME_MAX) : "";
    const detail = st.detail ?? (tool || undefined);
    out.push({ session_id: s.agentId, name, state: st.state, ...(detail ? { detail } : {}) });
  }
  return out.sort((a, b) => a.session_id.localeCompare(b.session_id));
}

/** A short fingerprint of the set; the plugin echoes it as `&activity=` to hold until it changes. */
export function activityVersion(activity: ChannelActivity[]): string {
  return createHash("sha1").update(JSON.stringify(activity)).digest("hex").slice(0, 12);
}
