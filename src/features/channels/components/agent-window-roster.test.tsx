// @vitest-environment jsdom
/**
 * 🔒 **THE AGENT WINDOW HANDS ITS STREAM A REAL ROSTER** (Samuel, 2026-10-12, ruling 2a: *give
 * both agent hosts a real roster* — so `@samuel-wang` and `@cleanup-orchestrator` stop rendering
 * as plain black text in the agent view).
 *
 * ⚠ **THIS FILE IS THE HOST HALF, AND THE HOST IS WHAT SILENTLY GOES MISSING.** What a tinted
 * handle MEANS, which strings reach the mention leaf, and why an email and a code span may never
 * tint are `agent-stream-mentions.test.tsx`'s, over the stream. What is asserted here is the one
 * thing only this window can get wrong: that it ASKS for the roster and PASSES it down. That exact
 * failure — a field riding every layer but the last one — has shipped twice in this card's family
 * (the 2026-10-11 `fromOperator` review).
 *
 * ⚠ **A SEPARATE FILE because `agent-window.test.tsx` is at the §1 cap**, the seam that file was
 * split on; the harness is shared and the `vi.mock` calls are per-file by necessity.
 *
 * ⚠ **THE MEMBERS FAKE IS MUTABLE HERE AND NOWHERE ELSE.** Every other window suite mounts with an
 * EMPTY roster — what this surface had before this wave — so none of them can accidentally depend
 * on a resolution.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { ME, member } from "./test-fixtures";
import { installBridge, mount, summary } from "./agent-window-harness";

const { rosterFake } = vi.hoisted(() => ({ rosterFake: { members: [] as unknown[] } }));

// The window's three server reads are real hooks over TanStack; this suite mounts with no
// QueryClient, exactly as its siblings do.
vi.mock("../hooks/use-channel-messages", () => ({
  useChannelMessages: () => ({ messages: [], loading: false, refetch: () => {} }),
}));
vi.mock("./live", () => ({ useChannelsLive: () => ({ gate: {} }) }));
vi.mock("../hooks/use-channel-members", () => ({
  useChannelMembers: () => ({ members: rosterFake.members, stale: false, refetch: () => {} }),
}));
vi.mock("../hooks/use-consent-inbox", () => ({
  useConsentInbox: () => ({ requests: [], outbound: [], refetch: () => {} }),
}));
vi.mock("../hooks/use-channel-preference-writes", () => ({
  useChannelPreferenceWrites: () => ({
    consent: { mutate: () => {}, pending: false },
    unaddressedResponder: { mutate: () => {}, pending: false },
  }),
}));

/** One arriving message naming the operator — the lane whose body a member actually wrote. */
const MENTION_FRAME = {
  at: 1_000,
  kind: "inbound",
  lane: "inbound",
  text: "@samuel-wang please review",
  senderName: "Diana Taylor",
};

beforeEach(() => {
  rosterFake.members = [];
});
afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

describe("the window's @-handles can resolve", () => {
  it("tints a member's handle in the work stream once the roster is in hand", async () => {
    rosterFake.members = [member({ userId: ME, displayName: "Samuel Wang" })];
    installBridge({
      sessions: [summary()],
      entries: [MENTION_FRAME],
    });
    await mount();
    const tinted = document.querySelectorAll("span.text-link");
    expect([...tinted].map((n) => n.textContent)).toEqual(["@samuel-wang"]);
  });

  it("tints nothing when the roster answers nobody — an unresolved handle addresses nobody", async () => {
    // ⚠ THE CONTROL FOR THE CASE ABOVE: the SAME body with the suite's empty roster, so the case
    // above is a claim about the roster ARRIVING rather than about any token turning blue.
    installBridge({
      sessions: [summary()],
      entries: [MENTION_FRAME],
    });
    await mount();
    expect(document.querySelector("span.text-link")).toBeNull();
  });
});
