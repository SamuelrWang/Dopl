// @vitest-environment jsdom
/**
 * 🔒 A DEAD AGENT'S TAG DOES NOT TINT, AND THE UN-TINT IS THE SIGNAL (Samuel, 2026-09-06).
 *
 * ⚠ THE DEFECT THIS PINS, and why it was believed fixed when it was not. The ruling was that a
 * user typing an agent name that can no longer be reached should simply see no blue and learn
 * from the absence — and everyone assumed that already happened, because
 * `lib/agent-mentions.ts` said so in a docblock. It was wrong about THIS machine:
 * `main/session-summary.js › reportList` is the live registry PLUS `retainedEnded()`, seven days
 * of ended cards, each row carrying a real `agentId` and a live `displayName`. So the operator's
 * OWN dead agent stayed in the identity map, resolved, and tinted exactly like a live one for a
 * week. (A PEER's ended agent really did render plain — the server projection drops stopped rows
 * — which is where the belief came from.)
 *
 * ⚠ WHAT THE FIX MAY NOT COST, and half of what is asserted here: ATTRIBUTION. The identity map
 * is not filtered, because a session that has stopped still WROTE what it wrote and the
 * transcript must go on naming it. Only the HANDLE namespace narrows
 * (`lib/agent-mentions.ts › addressableAgents`). A test that only checked the tint would pass
 * for a fix that blanked every dead agent's name across the whole transcript.
 *
 * ⚠ AND THE MEMO KEY, which is the silent way this regresses. The map the transcript reads is
 * REBUILT from `agentIndexKey` (the 2026-08-28 re-render fix), so a flag that does not ride that
 * string is a flag that does not exist by the time anything renders — and nothing would fail
 * except the blue coming back.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MessageMarkdown } from "./message-markdown";
import { agentIndexFromKey, agentIndexKey, indexAgents, indexMembers } from "./view-model";
import { addressableAgents, agentMentionFace } from "../../lib/agent-mentions";
import { member, ME, PEER } from "./test-fixtures";

afterEach(cleanup);

const AGENT = "k3v7d2mq";
const LIVE = "m4x8p1qr";

/** THE WHOLE PIPELINE, exactly as the hook runs it: feed → index → memo key → map. Testing
 *  `indexAgents` alone would miss the round trip, which is where the flag can silently vanish. */
const identities = (feed: Parameters<typeof indexAgents>[0]) =>
  agentIndexFromKey(agentIndexKey(indexAgents(feed)));

const indexFor = (feed: Parameters<typeof indexAgents>[0]) =>
  indexMembers(
    [
      member({ userId: ME, displayName: "Sam Wang" }),
      member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
    ],
    ME,
    identities(feed)
  );

const tinted = (text: string, feed: Parameters<typeof indexAgents>[0]) => {
  const view = render(
    <MessageMarkdown text={text} index={indexFor(feed)} mentionsMe={false} />
  );
  return [...view.container.querySelectorAll("span.text-link")].map((n) => n.textContent);
};

describe("an ENDED agent's tag renders as plain prose", () => {
  it("does not tint the id form — the address every agent always answered to", () => {
    expect(
      tinted(`hey @agent-${AGENT} take this`, [
        { agentId: AGENT, displayName: null, description: null, state: "ended" },
      ])
    ).toEqual([]);
  });

  it("does not tint the agent's slugged NAME either", () => {
    // ⚠ BOTH HANDLES OR NEITHER. `buildAgentMentionIndex` claims the id form AND the slugged
    // name, so a filter that dropped only one would leave the rename still tinting blue.
    expect(
      tinted("ping @research-bot please", [
        { agentId: AGENT, displayName: "Research Bot", description: null, state: "ended" },
      ])
    ).toEqual([]);
  });

  it("still tints a LIVE agent, in both of its states", () => {
    // ⚠ THE FLAG IS TERMINAL, NOT THE THREE-VALUED PILL: `working` and `idle` are both reachable
    // and both tint. An idle agent is addressable — that was settled on 2026-09-05, when a clock
    // baked into the server's caller stopped one being addressable at all.
    for (const state of ["working", "idle"]) {
      const out = tinted(`hey @agent-${LIVE} take this`, [
        { agentId: LIVE, displayName: null, description: null, state },
      ]);
      expect(out).toEqual([`@agent-${LIVE}`]);
      cleanup();
    }
  });

  it("drops ONLY the ended one when both are in the room", () => {
    const out = tinted(`@agent-${AGENT} is gone, @agent-${LIVE} is here`, [
      { agentId: AGENT, displayName: null, description: null, state: "ended" },
      { agentId: LIVE, displayName: null, description: null, state: "working" },
    ]);
    expect(out).toEqual([`@agent-${LIVE}`]);
  });
});

describe("ATTRIBUTION is untouched — the half a tint-only fix would break", () => {
  const ENDED_FEED = [
    { agentId: AGENT, displayName: "Research Bot", description: null, state: "ended" },
  ];

  it("keeps the ended agent IN the identity map, still wearing its name", () => {
    // ⚠ THIS IS WHAT NAMES A DEAD AGENT ON ITS OWN PAST MESSAGES (`transcript.tsx` reads
    // `index.agents.get(agentId)?.displayName`). Filtering the MAP would blank every one of them.
    const agents = identities(ENDED_FEED);
    expect(agents.get(AGENT)?.displayName).toBe("Research Bot");
    expect(agentMentionFace(AGENT, agents)).toBe("research-bot");
  });

  it("keeps `index.agents.has(...)` true — the openable gate on the retained card", () => {
    // The ended card survives seven days by design; its pill must stay clickable for that week.
    expect(identities(ENDED_FEED).has(AGENT)).toBe(true);
  });

  it("narrows the HANDLE namespace and nothing else", () => {
    expect(addressableAgents(identities(ENDED_FEED))).toEqual([]);
    expect(
      addressableAgents(
        identities([{ agentId: LIVE, displayName: null, description: null, state: "idle" }])
      )
    ).toEqual([{ agentId: LIVE, displayName: null }]);
  });
});

describe("a PEER's agent is not double-handled", () => {
  it("tints a row that reports NO state — absent is live, not ended", () => {
    // ⚠ PEER ROWS CARRY NO PILL INTO THIS INDEX (`derivations.ts` maps the projection to
    // `{agentId, displayName}`), and the projection has ALREADY dropped stopped sessions
    // server-side. Reading absence as "ended" would blank every peer agent tag in the room.
    expect(
      tinted(`hey @agent-${LIVE} take this`, [{ agentId: LIVE, displayName: null }])
    ).toEqual([`@agent-${LIVE}`]);
  });

  it("a peer's ENDED agent is absent from the feed entirely, and so tints nothing", () => {
    expect(tinted(`@agent-${AGENT} are you there`, [])).toEqual([]);
  });
});

describe("the flag survives the memo key — the silent regression path", () => {
  it("round-trips, so the rebuilt map still knows the agent ended", () => {
    expect(identities([{ agentId: AGENT, displayName: "Research Bot", state: "ended" }]).get(AGENT))
      .toEqual({ displayName: "Research Bot", description: null, ended: true });
  });

  it("MOVES when an agent ends, so the transcript re-renders without a refetch", () => {
    const live = [{ agentId: AGENT, displayName: "Research Bot", state: "working" }];
    const ended = [{ agentId: AGENT, displayName: "Research Bot", state: "ended" }];
    expect(agentIndexKey(indexAgents(ended))).not.toBe(agentIndexKey(indexAgents(live)));
  });

  it("does NOT move on working ⇄ idle — the churn the key exists to damp", () => {
    // ⚠ THE REASON THIS IS A BOOLEAN AND NOT `state`. The pill flips constantly on a running
    // agent, and a key that moved with it would re-mint the map and re-lex every message in the
    // channel several times a second — precisely the 2026-08-28 defect
    // (`view-model-agent-index.test.ts`), reintroduced through a new field.
    const working = [{ agentId: AGENT, displayName: "Research Bot", state: "working" }];
    const idle = [{ agentId: AGENT, displayName: "Research Bot", state: "idle" }];
    expect(agentIndexKey(indexAgents(idle))).toBe(agentIndexKey(indexAgents(working)));
  });
});
