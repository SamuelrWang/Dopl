import { describe, expect, it } from "vitest";
import { activityVersion, channelActivity } from "./channel-activity";
import type { MenuSession } from "./menu-types";

const OWNER = "owner";
const NOW = Date.parse("2026-09-27T12:00:00Z");
const s = (agentId: string, over: Partial<MenuSession>): MenuSession => ({
  agentId,
  displayName: null,
  channelId: "c",
  state: "working",
  detail: null,
  model: null,
  lastActivity: null,
  updatedAt: "2026-09-27T11:59:50Z",
  userId: OWNER,
  toolLabel: null,
  ...over,
});

describe("channel activity", () => {
  it("maps live session detail to the lens states and omits the rest", () => {
    const out = channelActivity(
      [
        s("aaaaaaaa", { detail: "thinking", displayName: "Planner" }),
        s("bbbbbbbb", { detail: "tool", toolLabel: "Edit" }),
        s("cccccccc", { detail: "posting" }),
        s("dddddddd", { detail: "permission", state: "idle" }),
        s("eeeeeeee", { detail: "awaiting_peer" }),
        s("ffffffff", { detail: "awaiting_inbound" }),
        s("gggggggg", { state: "idle" }),
        s("hhhhhhhh", { state: "ended", detail: "thinking" }),
        s("iiiiiiii", { detail: "thinking", updatedAt: "2026-09-27T11:57:00Z" }),
        s("jjjjjjjj", { detail: "tool", toolLabel: "Secret", userId: "someone-else" }),
      ],
      OWNER,
      NOW,
    );
    expect(out).toEqual([
      { session_id: "aaaaaaaa", name: "Planner", state: "thinking" },
      { session_id: "bbbbbbbb", name: "agent-bbbbbbbb", state: "working", detail: "Edit" },
      { session_id: "cccccccc", name: "agent-cccccccc", state: "replying" },
      { session_id: "dddddddd", name: "agent-dddddddd", state: "waiting", detail: "needs approval" },
      { session_id: "eeeeeeee", name: "agent-eeeeeeee", state: "waiting", detail: "waiting on an agent" },
      { session_id: "jjjjjjjj", name: "agent-jjjjjjjj", state: "working" },
    ]);
  });

  it("versions the set independent of row order", () => {
    const a = channelActivity([s("aaaaaaaa", { detail: "thinking" }), s("bbbbbbbb", {})], OWNER, NOW);
    const b = channelActivity([s("bbbbbbbb", {}), s("aaaaaaaa", { detail: "thinking" })], OWNER, NOW);
    expect(activityVersion(a)).toBe(activityVersion(b));
    expect(activityVersion(a)).not.toBe(activityVersion([]));
  });
});
