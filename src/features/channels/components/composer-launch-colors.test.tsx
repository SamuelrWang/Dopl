// @vitest-environment jsdom
/**
 * **THE COMPOSER'S NEW-AGENT POPUP READS THE ROOM'S TAKEN COLOURS** (2026-09-13;
 * docs/specs/agent-colors.md item 7: *"The taken set comes from the channel's live sessions
 * projection (peer + own), refreshed by the same push the @-picker uses"*).
 *
 * ⚠ **THE PROP WAS DECLARED AND THIS MOUNT DEFAULTED IT TO EMPTY** for the whole of the colours
 * wave — `launch-agent-dialog.tsx`'s own docblock said so, calling it *"a wiring debt, not a design
 * choice"*. An empty taken set is not wrong, it is ADVISORY: the row offers every key and the
 * server's partial unique index answers 409 with the free set. What it costs is the one thing the
 * circles exist for — the operator picking a colour that is visibly already in the room — and the
 * failure is invisible from inside this surface, which is why it needs a case rather than a read.
 *
 * ⚠ **THE SOURCE IS `liveAgents`, THE PEER ∪ OWN UNION, NOT `peerSessions`.** A colour is unique
 * across members AND across one operator's own agents, and the projection alone lags a launch by
 * up to a 30 s poll — the exact defect `lib/live-agents.ts › liveAgentsKey` was written to fix
 * (`composer-live-agents.test.tsx` owns that argument for the @-picker). Its rows carry no `state`,
 * because that function has already dropped every ended one; `agentColorsTaken` reads an absent
 * state as LIVE, which is the same answer.
 *
 * ⚠ MUTATION-VERIFY — MEASURED 2026-09-13, 3 tests baseline, 3 reverts, 0 vacuous:
 *   - `liveSessions` dropped from `composer.tsx`'s `LaunchAgentDialog` mount (its state before
 *     this change) ............................................................ 2 red
 *   - `liveSessions={peerSessions-only}` — i.e. the union narrowed back to the poll, modelled here
 *     by passing `[]` while the room holds a key ............................... 2 red
 *   - `agentColorsTaken`'s `state?:` widened back to a REQUIRED `state` (the union's rows carry
 *     none, so every row would have to be adapted at the call site) ........... typecheck red
 *
 * ⚠ `useThreadWrites` and the templates endpoint are MOCKED — this file is about ONE prop reaching
 * ONE row, not about the write layer or the read.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../hooks/use-thread-writes", () => ({
  useThreadWrites: () => ({
    send: { mutate: vi.fn() },
    fanOutThreads: { mutate: vi.fn() },
    pending: false,
  }),
}));
vi.mock("@/features/agent-templates/hooks/use-agent-templates", () => ({
  useAgentTemplates: () => ({
    templates: [],
    loading: false,
    error: null,
    resolved: true,
    refetch: () => {},
  }),
}));

import { ChannelsComposer } from "./composer";
import { AGENT_COLOR_KEYS } from "../lib/agent-colors";
import type { LiveAgentSession } from "../lib/draft-recipients";
import type { AgentLaunchControls } from "./use-agents-panel";
import { member, CHANNEL_ID, ME } from "./test-fixtures";

/** ⚠ READ OFF THE BANK, NEVER TYPED — `AGENT_COLOR_KEYS`'s ORDER is the assignment policy. */
const [FIRST, SECOND] = AGENT_COLOR_KEYS;

const MEMBERS = [member({ userId: ME, displayName: "Sam Wang" })];
const MINTED = "k3v7d2mq";
const mintAgentId = vi.fn();

function launcher(): AgentLaunchControls {
  return {
    canLaunch: true,
    launchBusy: false,
    launchError: null,
    launchAgent: vi.fn().mockResolvedValue({ ok: true, agentId: MINTED }),
    approveTemplate: vi.fn().mockResolvedValue({ ok: true }),
  };
}

beforeEach(() => {
  mintAgentId.mockReset().mockResolvedValue({ ok: true, agentId: MINTED });
  // ⚠ `apiRequest` IS THE SPA MARKER (`spa-bridge.ts › getSpaBridge`) — without it the bridge
  // reads as absent and the Bot icon never renders.
  (window as { dopl?: unknown }).dopl = {
    apiRequest: () => Promise.resolve({ status: 200, statusText: "OK", hasBody: false }),
    sessions: {
      mintAgentId,
      rename: vi.fn().mockResolvedValue({ ok: true }),
      describe: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
});
afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

/** Open the Bot popup over a given live-agent union. */
async function openPopup(liveAgents: readonly LiveAgentSession[]) {
  render(
    <ChannelsComposer
      channelId={CHANNEL_ID}
      workspaceId="ws-1"
      members={MEMBERS}
      currentUserId={ME}
      gate={{ begin: vi.fn(), end: vi.fn() }}
      newAgent={launcher()}
      liveAgents={liveAgents}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "New Agent" }));
  await waitFor(() =>
    expect((screen.getByLabelText("Agent name") as HTMLInputElement).value).toBe(`#${MINTED}`)
  );
}

const circle = (key: string) => screen.getByRole("radio", { name: key });
const checkedKey = () =>
  screen
    .getAllByRole("radio")
    .find((el) => el.getAttribute("aria-checked") === "true")
    ?.getAttribute("data-agent-color") ?? null;

describe("the composer's colour row", () => {
  it("fences a key the room already holds, and names the agent holding it", async () => {
    await openPopup([{ name: "ab12cd34", displayName: "Scout", color: FIRST }]);
    expect(circle(FIRST).getAttribute("aria-disabled")).toBe("true");
    expect(circle(FIRST).getAttribute("title")).toBe("In use by Scout");
  });

  it("preselects the first FREE key, not the first key", async () => {
    // 🔒 THE HALF THAT INVERTS ON THE OLD WIRING. With `liveSessions` absent the row would offer
    // `FIRST` and preselect it — a colour the operator can see on another agent in the transcript.
    await openPopup([{ name: "ab12cd34", displayName: "Scout", color: FIRST }]);
    expect(checkedKey()).toBe(SECOND);
  });

  it("offers every key when the room holds none — empty is not full", async () => {
    await openPopup([]);
    expect(circle(FIRST).getAttribute("aria-disabled")).not.toBe("true");
    expect(checkedKey()).toBe(FIRST);
  });
});
