/**
 * The launch lane's presence gate (`operatorIsOnline`) reads the heartbeat STAMP, never the posture
 * word. A locked-but-awake Mac now keeps beating as `away` (2026-10-11, Samuel; KB codebase-cleanup
 * "Launch Stall Investigation"), and it must stay launchable: `away` is a status the roster shows,
 * not evidence the machine is gone. The projection below is the real one's shape for an `away` row —
 * `online:false` (the roster's dot) with a fresh `lastSeenAt` — so a gate that read `online` would
 * refuse exactly the machines this fix keeps alive.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository-collab", () => ({ presenceForWorkspace: vi.fn() }));

import * as collab from "./repository-collab";
import { operatorIsOnline } from "./service-launch-presence";
import { PRESENCE_ONLINE_WINDOW_MS } from "../constants";

const ctx = { userId: "u1", workspaceId: "w1" } as never;
const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
function seen(row: { online: boolean; lastSeenAt: string | null } | undefined) {
  vi.mocked(collab.presenceForWorkspace).mockResolvedValue(
    new Map(row ? [["u1", row]] : []) as never
  );
}

beforeEach(() => vi.clearAllMocks());

describe("operatorIsOnline — the stamp, not the posture", () => {
  it("a FRESH `away` heartbeat (locked, awake Mac) is launchable", async () => {
    seen({ online: false, lastSeenAt: at(30_000) });
    expect(await operatorIsOnline(ctx)).toBe(true);
  });

  it("control: a STALE heartbeat (suspended / gone) is not", async () => {
    seen({ online: false, lastSeenAt: at(PRESENCE_ONLINE_WINDOW_MS + 1_000) });
    expect(await operatorIsOnline(ctx)).toBe(false);
  });

  it("control: no row at all is not", async () => {
    seen(undefined);
    expect(await operatorIsOnline(ctx)).toBe(false);
  });
});
