// @vitest-environment jsdom
/**
 * **AN AGENT YOU JUST LAUNCHED IS ADDRESSABLE *NOW*** (Samuel, 2026-09-13: *"when I
 * launch an agent, let's say I launch it right in the channel, and I type @, it
 * doesn't immediately pop up … I have to wait a minute"*).
 *
 * ⚠ **THE DEFECT WAS NOT IN THE PICKER AND THAT IS WHY THIS FILE EXISTS.**
 * `composer-mentions.test.tsx` has always passed: given a candidate, the popover
 * offers it and inserts a resolvable handle. What was wrong is WHICH SET the surface
 * handed it — `use-agents-panel.ts › peerSessions` alone, an HTTP read of an
 * unpublished table on a 30 s poll (INVARIANTS §7). A just-launched agent is
 * spawn-idle (§5), so it rings no message doorbell either, and the launcher's own
 * `void refetch()` fires before main's push has landed the row — it re-reads the old
 * set and RESTARTS the interval. So the wait was one full poll period by
 * construction, and two whenever the push landed just after a tick. The machine that
 * spawned the agent had it in `useDesktopSessions` within 200 ms throughout.
 *
 * So the assertion here is the WIRING, driven through the REAL picker: with the poll
 * still answering `[]` and the desktop feed carrying the new agent, typing `@` must
 * offer it. The composer is replaced by a HARNESS rather than a stub — it runs
 * `use-composer-mentions.ts` and `MentionPopover` over the `liveAgents` prop the
 * surface actually gave it — because a stub cannot show that the set arrived.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import {
  liveAgentsFromKey,
  liveAgentsKey,
  type OwnAgentSessionRow,
} from "../lib/live-agents";
import type { LiveAgentSession } from "../lib/draft-recipients";
import type { ChannelMember } from "../types";
import { channel, member, message, thread, CHANNEL_ID, ME, PEER, WS } from "./test-fixtures";

/** THE JUST-LAUNCHED AGENT, as `main/session-summary.js` projects it 200 ms after
 *  the spawn — and as the SERVER has not heard of it yet. */
const LAUNCHED: DesktopSessionSummary = {
  sessionId: "s-1",
  channelId: CHANNEL_ID,
  taskId: "t-1",
  agentId: "ab12cd34",
  name: "flint",
  displayName: "Scout",
  state: "working",
  channelName: "Website",
  threadTitle: "UI-kit design",
};

const feed = vi.hoisted(() => ({ sessions: [] as DesktopSessionSummary[] | null }));

vi.mock("./live", () => ({ useChannelsLive: () => ({ gate: {} }) }));
vi.mock("./settings-agent", () => ({
  ChannelAgentSettings: () => <div data-testid="agent-settings" />,
}));
vi.mock("./invite-dialog", () => ({ InviteDialog: () => null }));
vi.mock("./go-public-dialog", () => ({
  GoPublicDialog: () => null,
  needsGoPublicConfirm: () => false,
}));
vi.mock("../hooks/use-channel-messages", () => ({
  useChannelMessages: () => ({
    messages: [message({ id: "m-1", seq: 1, body: "on the record" })],
    loading: false,
    refetch: () => {},
  }),
}));
vi.mock("../hooks/use-channel-members", () => ({
  useChannelMembers: () => ({
    members: [
      member({ userId: ME }),
      member({ userId: PEER, role: "member", displayName: "Diana Taylor" }),
    ],
    refetch: () => {},
  }),
}));
vi.mock("../hooks/use-channel-threads", () => ({
  useChannelThreads: () => ({
    threads: [thread()],
    truncated: false,
    loading: false,
    refetch: () => {},
  }),
}));
vi.mock("../hooks/use-channel-mentions", () => ({
  useChannelMentions: () => ({
    mentions: [],
    truncated: false,
    loading: false,
    refetch: () => {},
  }),
}));
vi.mock("../hooks/use-consent-inbox", () => ({
  useConsentInbox: () => ({ requests: [], outbound: [], refetch: () => {} }),
}));
vi.mock("../hooks/use-mention-writes", () => ({
  useMentionWrites: () => ({ markRead: { mutate: () => {} }, pending: false }),
}));
vi.mock("../hooks/use-channel-preference-writes", () => ({
  useChannelPreferenceWrites: () => ({
    favorite: { mutate: () => {} },
    consent: { mutate: () => {}, pending: false },
    toolProfile: { mutate: () => {}, pending: false },
    unaddressedResponder: { mutate: () => {}, pending: false },
  }),
}));
vi.mock("../hooks/use-channel-lifecycle-writes", () => ({
  useChannelLifecycleWrites: () => ({
    toggleArchive: () => {},
    toggleVisibility: () => {},
    remove: () => {},
    join: () => {},
    leave: () => {},
  }),
}));
// 🔒 THE POLL HAS NOT CAUGHT UP — `peerSessions: []` is the state the operator is in
// for the whole 30 s after a launch, and the state the old wiring could say nothing in.
vi.mock("./use-agents-panel", () => ({
  PEER_SESSIONS_POLL_MS: 30_000,
  useAgentsPanel: () => ({
    peerSessions: [],
    canLaunch: true,
    launchBusy: false,
    launchError: null,
    launchAgent: async () => ({ ok: true, agentId: LAUNCHED.agentId }),
    approveTemplate: async () => ({ ok: true }),
    refetch: () => {},
  }),
}));
vi.mock("./use-desktop-sessions", () => ({
  useDesktopSessions: () => ({ sessions: feed.sessions, refresh: () => {} }),
}));
/** ⚠ A HARNESS, NOT A STUB — the real hook and the real popover over the prop the
 *  surface handed down, so what is under test is the SET and not the picker. */
vi.mock("./composer", async () => {
  const { useState } = await import("react");
  const { useComposerMentions } = await import("./use-composer-mentions");
  const { MentionPopover } = await import("./composer-mentions");
  return {
    ChannelsComposer: (props: {
      members: ChannelMember[];
      currentUserId: string;
      liveAgents?: readonly LiveAgentSession[];
    }) => {
      const [draft, setDraft] = useState("");
      const mentions = useComposerMentions({
        draft,
        setDraft,
        members: props.members,
        sessions: props.liveAgents ?? [],
        currentUserId: props.currentUserId,
      });
      return (
        <div data-testid="composer">
          <textarea
            aria-label="Message"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          {mentions.query !== null ? (
            <MentionPopover
              suggestions={mentions.suggestions}
              active={mentions.active}
              onPick={mentions.pick}
            />
          ) : null}
        </div>
      );
    },
  };
});

// Imported AFTER the mock declarations for readability; `vi.mock` is hoisted.
import { StandaloneChannelSurface } from "./channel-surface-standalone";

const CHANNEL = channel();

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <StandaloneChannelSurface
        workspaceId={WS}
        workspaceSlug="acme"
        channel={CHANNEL}
        currentUserId={ME}
      />
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  feed.sessions = [];
});

describe("the @-picker over a just-launched agent", () => {
  /** Type `@` the way an operator does the moment the launch dialog closes. */
  function typeAt() {
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "@" } });
  }

  it("OFFERS IT IMMEDIATELY, with the poll still answering nothing", () => {
    // 🔒 THE REGRESSION PIN. Revert `channel-surface.tsx`'s `liveAgents={liveAgents}`
    // to `agentsPanel.peerSessions` and this is "No matches" — the exact minute
    // Samuel waited.
    feed.sessions = [LAUNCHED];
    mount();
    typeAt();
    const row = screen.getByRole("option", { name: /Scout/ });
    // The HANDLE, beside the name: the string the row inserts, so the offer is a
    // token the resolver accepts (F-210's whole lesson).
    expect(row.textContent).toContain("@scout");
  });

  it("inserts the handle it showed, into the draft", () => {
    feed.sessions = [LAUNCHED];
    mount();
    typeAt();
    fireEvent.mouseDown(screen.getByRole("option", { name: /Scout/ }));
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(
      "@scout "
    );
  });

  it("offers nothing when the machine has no feed AND the poll is empty — `null` is not `[]`", () => {
    // A plain browser: the old behaviour is the ONLY behaviour available, and this
    // change must not invent a candidate out of "could not ask".
    feed.sessions = null;
    mount();
    typeAt();
    expect(screen.queryByRole("option", { name: /Scout/ })).toBeNull();
  });
});

/**
 * THE MERGE ITSELF (`lib/live-agents.ts`). ⚠ The DEDUPE case is the one that would
 * ship a new defect rather than leave the old one: `lib/agent-mentions.ts` MINTS a
 * suffix per candidate, so one agent listed twice is offered as `@scout` AND
 * `@scout-1`, and the second reaches nothing.
 */
describe("liveAgentsKey — the poll UNION this machine's own feed", () => {
  const peer = { name: "ab12cd34", displayName: "Scout" };
  const own = (over: Partial<OwnAgentSessionRow> = {}): OwnAgentSessionRow => ({
    channelId: CHANNEL_ID,
    agentId: "ab12cd34",
    displayName: "Scout",
    state: "working",
    ...over,
  });
  /**
   * ⚠ **`color: null` NOW APPEARS ON EVERY EXACT-SHAPE EXPECTATION BELOW, AND THAT IS THIS
   * ASSERTION WORKING RATHER THAN BEING WORKED AROUND** (2026-09-13, agent colours). These
   * are `toEqual` over the DECODED row, so a field added to the key's round trip shows up
   * here and has to be stated — which is exactly the guard that would have caught a colour
   * silently dropped between {@link liveAgentsKey} and {@link liveAgentsFromKey}. ⚠ They
   * are `null` rather than absent because the decoder always writes the field: a key whose
   * field count varies per row is a key whose `split` shifts every later field.
   */
  const merged = (
    peers: Array<{ name: string; displayName?: string | null; color?: unknown }>,
    rows: OwnAgentSessionRow[] | null
  ) => liveAgentsFromKey(liveAgentsKey(peers, rows, CHANNEL_ID));

  it("counts an agent ONCE when both sources carry it", () => {
    expect(merged([peer], [own()])).toEqual([
      { name: "ab12cd34", displayName: "Scout", color: null },
    ]);
  });

  it("keeps the LOCAL name, which is the fresher one after a rename", () => {
    expect(merged([peer], [own({ displayName: "Bug Reviewer" })])).toEqual([
      { name: "ab12cd34", displayName: "Bug Reviewer", color: null },
    ]);
  });

  it("does not let an UNNAMED local row delete the name the projection carries", () => {
    expect(merged([peer], [own({ displayName: null })])).toEqual([
      { name: "ab12cd34", displayName: "Scout", color: null },
    ]);
  });

  it("drops an ENDED own row — that feed retains seven days of them", () => {
    expect(merged([], [own({ state: "ended" })])).toEqual([]);
  });

  it("drops an own row from ANOTHER channel", () => {
    expect(merged([], [own({ channelId: "ch-other" })])).toEqual([]);
  });

  it("falls back to the legacy `name` when a main reports no agent id", () => {
    expect(merged([], [own({ agentId: null, name: "flint" })])).toEqual([
      { name: "flint", displayName: "Scout", color: null },
    ]);
  });

  it("is REFERENTIALLY STABLE across telemetry churn — the key is the content", () => {
    // The own feed hands the renderer a new array ~5×/s while an agent works; the
    // @-shortlist and the tint index must not re-derive at that rate.
    const a = liveAgentsKey([peer], [own()], CHANNEL_ID);
    const b = liveAgentsKey([{ ...peer }], [own()], CHANNEL_ID);
    expect(b).toBe(a);
    expect(liveAgentsFromKey("")).toBe(liveAgentsFromKey(""));
  });

  it("answers the projection alone off-desktop (`null` own feed)", () => {
    expect(merged([peer], null)).toEqual([
      { name: "ab12cd34", displayName: "Scout", color: null },
    ]);
  });
});
