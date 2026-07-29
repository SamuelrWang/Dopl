import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ReopenWindowButton,
  SessionCard,
  reopenSessionWindow,
} from "./session-card";
import { getDesktopSessions } from "@/shared/lib/desktop";
import type { SessionGroup } from "../lib/group-thread";
import type { ChannelMessage } from "../types";

const CHANNEL_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "task-11111111-1111-4111-8111-111111111111-7";

function head(): ChannelMessage {
  return {
    id: "m1",
    seq: 7,
    channelId: CHANNEL_ID,
    authorUserId: "u-agent",
    authorKind: "agent",
    kind: "task_started",
    body: "Started working",
    metadata: { taskId: TASK_ID },
    clientMsgId: null,
    createdAt: "2026-07-28T00:00:00.000Z",
    authorName: "Ada",
    authorAvatarUrl: null,
  };
}

function session(): SessionGroup {
  return {
    taskId: TASK_ID,
    status: "active",
    title: "Ship the fix",
    mode: null,
    head: head(),
    entries: [],
    summary: "Ship the fix",
    outcomeSummary: null,
    createdAt: "2026-07-28T00:00:00.000Z",
  };
}

// Each test that defines `window` cleans it up so the server-render tests see
// the true "no bridge on the server" state (getDesktopSessions -> null).
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe("getDesktopSessions gate (the reopen button's visibility source)", () => {
  it("returns the bridge only when window.dopl.sessions.reopen is a function", () => {
    (globalThis as { window?: unknown }).window = {
      dopl: { sessions: { reopen: vi.fn() } },
    };
    expect(getDesktopSessions()).not.toBeNull();
  });

  it("returns null in a plain browser (no window.dopl)", () => {
    (globalThis as { window?: unknown }).window = {};
    expect(getDesktopSessions()).toBeNull();
  });

  it("returns null on an older desktop build (marker but no sessions API)", () => {
    (globalThis as { window?: unknown }).window = {
      dopl: { isDesktop: true },
    };
    expect(getDesktopSessions()).toBeNull();
  });
});

describe("reopenSessionWindow (the click action)", () => {
  it("calls the bridge with exactly (channelId, taskId) and maps ok:true", async () => {
    const reopen = vi.fn().mockResolvedValue({ ok: true });
    const ok = await reopenSessionWindow({ reopen }, CHANNEL_ID, TASK_ID);
    expect(reopen).toHaveBeenCalledTimes(1);
    expect(reopen).toHaveBeenCalledWith(CHANNEL_ID, TASK_ID);
    expect(ok).toBe(true);
  });

  it("maps a settled session's {ok:false} to the 'no live session' path", async () => {
    const reopen = vi.fn().mockResolvedValue({ ok: false });
    const ok = await reopenSessionWindow({ reopen }, CHANNEL_ID, TASK_ID);
    expect(ok).toBe(false);
  });
});

describe("ReopenWindowButton render gating", () => {
  it("renders nothing on the server / plain browser (no bridge)", () => {
    const markup = renderToStaticMarkup(
      <ReopenWindowButton channelId={CHANNEL_ID} taskId={TASK_ID} />
    );
    expect(markup).toBe("");
  });
});

describe("SessionCard render", () => {
  it("renders the card, and the desktop-only reopen button is absent on the server", () => {
    const markup = renderToStaticMarkup(<SessionCard session={session()} />);
    expect(markup).toContain("Ship the fix");
    // The reopen button is feature-detected after mount, so it never appears in
    // the server / first-paint markup — proving the hydration-safe gating.
    expect(markup).not.toContain("Reopen window");
  });
});
