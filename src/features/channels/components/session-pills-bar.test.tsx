/**
 * The SESSION PILLS BAR (rollback plan §3.3) — the WEB half of its contract.
 *
 * WHERE THE OTHER HALF IS, and why it is split. This component is desktop-only:
 * every fact it shows is about the operator's own machine, reached over the SPA
 * bridge. The DOM cases — a pill rendering from a pushed frame, the dropdown, the
 * reopen call — therefore live in the SPA suite
 * (`apps/desktop-ui/src/features/channels/session-pills-bar.test.tsx`), which is
 * the app that has jsdom and testing-library and is the only place the bridge is
 * ever real. That is the same split `use-bridged-image-src` already uses.
 *
 * WHAT IS PINNED HERE is what the WEB app is responsible for: that this component
 * renders NOTHING when it is server-rendered (it is bundled into the web tree and
 * SSR'd, so reading a window global during render would break hydration), and the
 * pure per-channel filter every consumer slices the feed with.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import {
  SESSION_PILL_HINT,
  SESSION_PILL_LABEL,
  SessionPillsBar,
  sessionsForChannel,
} from "./session-pills-bar";

const CHANNEL = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

function summary(over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    sessionId: "sess-1",
    channelId: CHANNEL,
    taskId: "task-1",
    name: "quartz",
    state: "working",
    channelName: "general",
    threadTitle: "Ship the thing",
    ...over,
  };
}

describe("the web app never renders a pill", () => {
  it("renders nothing when server-rendered", () => {
    // There is no bridge on the server and there never will be one in a browser,
    // so the bar is absent rather than empty — and the bridge is read only AFTER
    // mount, so the server and the first client render agree.
    expect(renderToStaticMarkup(<SessionPillsBar channelId={CHANNEL} />)).toBe("");
  });
});

describe("sessionsForChannel", () => {
  // Main pushes EVERY session on the machine — the list is bounded by the desktop's
  // window budget, so there is nothing to page and no per-channel watch handshake to
  // fall out of step. This is the only filter, and it is the whole of "per channel /
  // DM, not global" from plan §3.3.
  it("keeps this channel's sessions and drops every other", () => {
    const mine = summary({ sessionId: "a" });
    const theirs = summary({ sessionId: "b", channelId: OTHER });
    expect(sessionsForChannel([mine, theirs], CHANNEL)).toEqual([mine]);
    expect(sessionsForChannel([mine, theirs], OTHER)).toEqual([theirs]);
  });

  it("preserves the order main sent", () => {
    const a = summary({ sessionId: "a", name: "quartz" });
    const b = summary({ sessionId: "b", name: "onyx" });
    expect(sessionsForChannel([a, b], CHANNEL).map((s) => s.name)).toEqual([
      "quartz",
      "onyx",
    ]);
  });

  it("answers nothing for a channel with no sessions", () => {
    expect(sessionsForChannel([summary()], "nope")).toEqual([]);
    expect(sessionsForChannel([], CHANNEL)).toEqual([]);
  });

  it("a DM is just another channel id — there is no global bucket", () => {
    const dm = summary({ sessionId: "dm", channelId: OTHER, name: "onyx" });
    expect(sessionsForChannel([summary(), dm], OTHER)).toEqual([dm]);
  });
});

describe("the copy", () => {
  it("names all three pill states, and only those three", () => {
    expect(Object.keys(SESSION_PILL_LABEL)).toEqual(["working", "idle", "ended"]);
    expect(Object.keys(SESSION_PILL_HINT)).toEqual(["working", "idle", "ended"]);
  });

  it("gives every state a word, so the dot is never the only carrier", () => {
    for (const state of ["working", "idle", "ended"] as const) {
      expect(SESSION_PILL_LABEL[state]).toMatch(/\S/);
      expect(SESSION_PILL_HINT[state]).toMatch(/\S/);
    }
  });

  it("says what IDLE covers, because it covers three different things", () => {
    // Between turns, awaiting the peer, and parked all read as idle (the mapping
    // lives in dopl-desktop-app/main/session-summary.js). A one-word pill cannot
    // carry that, so the dropdown line does.
    expect(SESSION_PILL_HINT.idle).toContain("parked");
  });

  it("says an ended session still has something to open", () => {
    // The retention rule keeps an ended pill ONLY where its window survived, so
    // the hint has to be true of every ended pill that can exist.
    expect(SESSION_PILL_HINT.ended).toContain("window");
  });
});
