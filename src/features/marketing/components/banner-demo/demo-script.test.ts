/**
 * **THE HERO DEMO'S SCRIPT DATA, AS INVARIANTS** (Samuel, 2026-10-12).
 *
 * The scene's components were already covered (`demo-class-coverage.test.tsx` mounts a
 * step, `demo-home-chrome.test.tsx` reads the chrome, `banner-demo-hydration.test.tsx`
 * guards first paint). Its DATA was not, and every one of the six faults this file now
 * pins was a data fault that typechecked, linted and rendered without complaint:
 *
 *   1. two different cursor shapes inside one continuous motion;
 *   2. no colour on any agent, so three agents shared the neutral box;
 *   3. `metadata: {}` on every message, so no `@name` could ever tint or be counted;
 *   4. no `inbound` lane at all, so the agent view showed one side of each exchange;
 *   5. the mentions inbox unaffected by the step, so a row cited a post not yet made;
 *   6. the second posted box revealed ten beats before the talk that produces it.
 *
 * ⚠ **THESE ARE PROPERTY ASSERTIONS, NOT A SNAPSHOT OF TODAY'S LINES.** The scenario copy
 * is being replaced (Samuel is reviewing the new script), so a test keyed to the current
 * wording would have to be rewritten alongside it and would prove nothing about the
 * mechanism. Each probe states the RULE and derives the expected value from the script,
 * so it survives the copy swap and fails if a mechanic regresses.
 *
 * ⚠ **EVERY LOOKUP THROWS ON ABSENCE.** A probe that silently finds nothing is a green
 * test for a broken scene.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isAgentColorKey } from "@/features/channels/lib/agent-colors";
import {
  MENTIONS_METADATA_KEY,
  mentionSlug,
  resolveMentions,
} from "@/features/channels/lib/mentions";
import {
  addressableAgents,
  agentIdHandle,
  buildAgentMentionIndex,
  resolveAgentHandle,
} from "@/features/channels/lib/agent-mentions";
import type { ChannelMessage } from "@/features/channels/types";
import {
  AGENT_IDS,
  AGENT_INDEX,
  MEMBERS,
  OPEN_THREAD,
} from "./demo-data";
import {
  citedMessage,
  mentionMetadata,
  messagesAt,
  threadsAt,
} from "./demo-transcript";
import { narrationAt } from "./demo-narration";
import { PRIOR_MENTION_ID, mentionsAt } from "./demo-info-data";
import { STEPS, stepIndex, type StepId } from "./demo-steps";

const HERE = join(fileURLToPath(new URL(".", import.meta.url)));
const LAST_STEP = STEPS.length - 1;

/** Source of a file in this directory, or its sibling in `marketing/components/`. */
function source(relative: string): string {
  const text = readFileSync(join(HERE, relative), "utf8");
  if (text.trim() === "") throw new Error(`empty source: ${relative}`);
  return text;
}

/** The one post carrying this `clientMsgId`, at the final step. ⚠ Throws on a miss. */
function post(clientMsgId: string): ChannelMessage {
  const found = messagesAt(LAST_STEP).filter(
    (m) => m.clientMsgId === clientMsgId
  );
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one post with clientMsgId ${clientMsgId}, found ${found.length}`
    );
  }
  return found[0];
}

const epoch = (iso: string): number => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`unparseable stamp: ${iso}`);
  return ms;
};

/** `agentPost` stamps `agent-<id>-<n>`. The opened coder's only channel post. */
const CODER_POST = `agent-${AGENT_IDS.teardown}-1`;
/** The brief that woke it, which its inbound banner carries. */
const BRIEF_POST = `agent-${AGENT_IDS.planner}-3`;
describe("1. the scripted cursor is one shape for the whole demo", () => {
  const demo = source("banner-demo.tsx");
  const banner = source("../hero-banner.tsx");

  /** The pointer path, read off the banner cursor so the two cannot be compared to a
   *  constant that has drifted from both. */
  const pathOf = (text: string): string => {
    const match = text.match(/d="(M0\.75 0\.9[^"]*)"/);
    if (!match) throw new Error("no cursor path found");
    return match[1];
  };

  it("uses the banner cursor's geometry: 13x19, not the old 17x25", () => {
    expect(demo).toContain('width="13"');
    expect(demo).toContain('height="19"');
    // The regression: the same path drawn 1.31x bigger.
    expect(demo).not.toContain('width="17"');
    expect(demo).not.toContain('height="25"');
  });

  it("uses the banner cursor's rotation, pivoted on the tip", () => {
    expect(demo).toContain("rotate(45deg)");
    // Origin-is-tip, or the point lands off the control it presses.
    expect(demo).toContain('transformOrigin: "0.75px 0.9px"');
  });

  it("draws the identical path to the banner cursor", () => {
    expect(pathOf(demo)).toBe(pathOf(banner));
  });

  it("wears the same white keyline as the banner cursor", () => {
    // (Samuel, 2026-10-15) The banner's first cursor now wears it too.
    expect(demo).toContain('stroke="#ffffff"');
    expect(banner).toContain('stroke="#ffffff"');
  });
});

describe("2. every agent has its own colour", () => {
  const entries = [...AGENT_INDEX.entries()];

  it("indexes every agent in the scene: three orchestrators and three coders", () => {
    expect(entries).toHaveLength(6);
  });

  it("gives each one a key from the product's own bank", () => {
    for (const [agentId, entry] of entries) {
      expect(entry.color, `${agentId} has no colour`).toBeTruthy();
      expect(isAgentColorKey(entry.color), `${agentId}: ${entry.color}`).toBe(true);
    }
  });

  it("gives no two agents the same key", () => {
    const keys = entries.map(([, e]) => e.color);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/**
 * **AGENT @-HANDLES, WHICH THE NEW SCENARIO LEANS ON** (Samuel, 2026-10-12: the agents
 * should tag and answer ONE ANOTHER, not just report to the channel).
 *
 * ⚠ **AGENT TAGS ARE A SEPARATE NAMESPACE FROM MEMBER TAGS AND NEVER REACH
 * `metadata.mentionedUserIds`** (`message-markdown-context.ts › BodyContext.agentHandles`:
 * "it decides TINT ONLY"). So the item 3 plumbing above does nothing for them, and
 * whether an agent tag draws a pill is decided entirely by what is in `index.agents`.
 *
 * ⚠ **THIS SCENE PUTS ALL THREE AGENTS IN THAT INDEX**, so all three handles resolve —
 * including two that belong to OTHER members. Worth knowing before the copy lands:
 * `buildAgentMentionIndex`'s header describes an index built from one machine's own feed,
 * where a peer's agent has no entry and cannot be tinted. The transcript builds it from
 * the author index instead (`message-markdown.tsx:126`), which carries peer agents for
 * attribution, so the pills are real here. Flagged rather than assumed.
 */
describe("agent handles resolve in this scene, so agent-to-agent tags can pill", () => {
  const index = buildAgentMentionIndex(addressableAgents(AGENT_INDEX));

  it("resolves every agent by its slugged display name", () => {
    for (const [agentId, entry] of AGENT_INDEX) {
      const handle = mentionSlug(entry.displayName ?? "");
      expect(handle, `${agentId} has no sluggable name`).not.toBe("");
      expect(resolveAgentHandle(handle, index), `@${handle}`).toBe(agentId);
    }
  });

  it("resolves every agent by its id handle too", () => {
    for (const agentId of AGENT_INDEX.keys()) {
      expect(resolveAgentHandle(agentIdHandle(agentId), index)).toBe(agentId);
    }
  });

  it("resolves nothing for a name no agent answers to", () => {
    expect(resolveAgentHandle("nobody-at-all", index)).toBeNull();
  });
});

describe("3. mention metadata is derived from the body, never authored beside it", () => {
  const messages = messagesAt(LAST_STEP);

  it("scripts a transcript at all", () => {
    expect(messages.length).toBeGreaterThan(0);
  });

  it("stamps exactly what the server's own resolver would, author excluded", () => {
    for (const message of messages) {
      const expected = resolveMentions(message.body, MEMBERS).filter(
        (id) => id !== message.authorUserId
      );
      const stamped = message.metadata?.[MENTIONS_METADATA_KEY] ?? [];
      expect(stamped, `message ${message.id}`).toEqual(
        expected.length > 0 ? expected : []
      );
    }
  });

  /**
   * ⚠ **THE DERIVATION IS PROBED DIRECTLY, AND IT HAS TO BE.** Today's copy contains no
   * `@` at all (the new scenario is still with Samuel), so the property assertion above
   * compares `[]` against `[]` and would stay green with the derivation torn out — a
   * fail-open test for the exact mechanic this change adds. These two drive it with a
   * synthetic body instead, so they prove the wiring now and keep proving it after the
   * copy lands.
   */
  describe("the derivation itself, independent of today's copy", () => {
    const grace = MEMBERS.find((m) => (m.displayName ?? "").startsWith("Grace"));
    if (!grace) throw new Error("no Grace in the demo roster");
    const samuel = MEMBERS.find((m) => (m.displayName ?? "").startsWith("Daniel"));
    if (!samuel) throw new Error("no Daniel in the demo roster");

    it("resolves a tagged member to their id", () => {
      expect(mentionMetadata("@Grace can you take a look?", samuel.userId)).toEqual({
        [MENTIONS_METADATA_KEY]: [grace.userId],
      });
    });

    it("excludes the author, so tagging yourself lights nobody's inbox", () => {
      expect(mentionMetadata("@Daniel reminding myself", samuel.userId)).toEqual({});
    });

    /**
     * ⚠ **AND THE CALL SITE IS ASSERTED ON THE SOURCE, because neither probe above can
     * see it.** Driving the function proves the function; it says nothing about whether
     * `msg()` still calls it. With no `@` in today's copy, cutting the call site back to
     * `metadata: {}` left all twenty-four of these green — measured, not assumed — so the
     * wiring is pinned the only way it can be until the new lines land.
     */
    it("is wired into every scripted message, not merely available", () => {
      const text = source("demo-transcript.ts");
      expect(text).toContain("...mentionMetadata(body, authorUserId),");
      expect(text).not.toContain("metadata: {}");
    });
  });

  it("omits the key entirely on a post that tags nobody", () => {
    // The key's own contract: absent means "tags nobody"; `[]` is a shape no stored row has.
    for (const message of messages) {
      const tags = resolveMentions(message.body, MEMBERS).filter(
        (id) => id !== message.authorUserId
      );
      if (tags.length === 0) {
        expect(
          Object.hasOwn(message.metadata ?? {}, MENTIONS_METADATA_KEY),
          `message ${message.id} stamps an empty mention set`
        ).toBe(false);
      }
    }
  });
});

describe("4. the agent view is fed an inbound lane", () => {
  const entries = narrationAt(LAST_STEP);

  it("emits at least one arriving message", () => {
    const inbound = entries.filter((e) => e.lane === "inbound");
    expect(inbound.length).toBeGreaterThan(0);
  });

  it("names a sender on every inbound entry, so the banner is never the anonymous form", () => {
    for (const entry of entries.filter((e) => e.lane === "inbound")) {
      expect(typeof entry.senderName).toBe("string");
      expect((entry.senderName ?? "").trim()).not.toBe("");
    }
  });

  it("still carries the private 1:1 lanes beside it", () => {
    const lanes = new Set(entries.map((e) => e.lane));
    expect(lanes.has("operator")).toBe(true);
    expect(lanes.has("private")).toBe(true);
  });

  it("carries the exact words of a real post, never a retyped copy", () => {
    const bodies = new Set(messagesAt(LAST_STEP).map((m) => m.body));
    for (const entry of entries.filter((e) => e.lane === "inbound")) {
      expect(bodies.has(entry.text ?? ""), `inbound text not in transcript`).toBe(
        true
      );
    }
  });

  /**
   * 🔴 **v3 SHOWS ONLY THE AGENT FACE OF THIS BANNER, AND THAT IS THE STORY, NOT A GAP.**
   * v2 fed one member arrival and one agent arrival, so both paints were on screen. In v3
   * the opened agent is a CODER that its orchestrator launched and briefed, so the only
   * thing that ever arrives in its private lane is another agent's message — which is
   * precisely the "agents hand work to each other" point. There is no human message
   * addressed to it to show, and inventing one to exercise the other paint would be a
   * line nobody approved.
   *
   * ⚠ Reported to @cleanup-orchestrator rather than papered over: the human/black face is
   * no longer exercised by this scene.
   */
  it("shows the agent face, which is the only arrival v3's coder ever gets", () => {
    const senders = entries
      .filter((e) => e.lane === "inbound")
      .map((e) => e.senderName);
    const agents = new Set([...AGENT_INDEX.values()].map((a) => a.displayName));
    expect(senders.length).toBeGreaterThan(0);
    expect(senders.every((s) => agents.has(s ?? ""))).toBe(true);
    // And no member sender, so the claim above is pinned rather than just asserted.
    const people = new Set(MEMBERS.map((m) => m.displayName));
    expect(senders.some((s) => people.has(s ?? ""))).toBe(false);
  });

  /**
   * **THE PAINT CARRIER, NOW ASSERTED ON THE PAINT** (`ui/received-banner-color` merged
   * 2026-10-12).
   *
   * ⚠ **THESE REPLACED THREE SHAPE PROBES, AND THE SHAPE PROBES WERE A STAND-IN FOR THE
   * COMPILER.** The three carrier fields were written before they existed on
   * `DesktopNarrationEntry`, admitted by an `as` cast, so nothing but a test could have
   * caught a misspelled key. The cast is deleted and the type checks the shape now, which
   * frees these to assert the thing that actually matters: which weight the card DRAWS.
   *
   * ⚠ `data-stream-inbound-paint` is the component's own test vocabulary
   * (`agent-stream-inbound-box.tsx`: "read, never styled on"), so this asserts through the
   * contract it publishes rather than by sniffing a colour out of a style attribute.
   */
  describe("the banner's paint", () => {
    const inbound = entries.filter((e) => e.lane === "inbound");

    it("has an arrival to paint at all", () => {
      expect(inbound.length).toBeGreaterThan(0);
    });

    it("says whether every arrival came from a member or an agent", () => {
      for (const entry of inbound) {
        expect(["user", "agent"]).toContain(entry.authorKind);
      }
    });

    it("carries a name and a bank colour on an agent's arrival", () => {
      const fromAgents = inbound.filter((e) => e.authorKind === "agent");
      expect(fromAgents.length).toBeGreaterThan(0);
      for (const entry of fromAgents) {
        expect((entry.senderAgentName ?? "").trim()).not.toBe("");
        expect(isAgentColorKey(entry.senderColor), `${entry.senderColor}`).toBe(true);
      }
    });

    it("would omit both on a member's arrival, mirroring the reader's own gate", () => {
      // ⚠ v3 has no member arrival (see the note above), so this asserts the RULE over
      // whatever arrivals exist rather than requiring one of each: an entry claiming
      // `user` must carry neither agent field. It becomes load-bearing again the moment
      // a human-sent arrival is scripted, which is why it is not deleted.
      for (const entry of inbound.filter((e) => e.authorKind === "user")) {
        expect(entry.senderAgentName).toBeUndefined();
        expect(entry.senderColor).toBeUndefined();
      }
      // The scene must still feed the lane something, or this file proves nothing.
      expect(inbound.length).toBeGreaterThan(0);
    });
  });

  it("stamps each arrival no earlier than the post it carries", () => {
    // An inbound is when a message REACHED this agent, which cannot precede the post.
    for (const entry of entries.filter((e) => e.lane === "inbound")) {
      const origin = messagesAt(LAST_STEP).find((m) => m.body === entry.text);
      expect(origin, "inbound text is not a scripted post").toBeTruthy();
      expect(entry.at).toBeGreaterThanOrEqual(epoch(origin!.createdAt));
    }
  });
});

describe("5. the mentions inbox is live", () => {
  const full = mentionsAt(LAST_STEP);

  it("ends with rows", () => {
    expect(full.length).toBeGreaterThan(0);
  });

  it("grows over the timeline instead of sitting complete from the first frame", () => {
    // ⚠ NOT "empty at step 0": one row cites a `channel-base` post, which lands ON step
    // 0, so an empty assertion there would be testing the script's shape rather than the
    // gate. What "live" means is that the column is not already finished when the scene
    // starts, which is precisely what the ungated array did.
    expect(mentionsAt(0).length).toBeLessThan(full.length);
  });

  it("opens on a prior mention, never the empty inbox", () => {
    expect(mentionsAt(0).some((m) => m.messageId === PRIOR_MENTION_ID)).toBe(true);
  });

  it("reveals each row on the beat of the post it cites, and not before", () => {
    // The prior mention predates the scene and cites no scripted post (by design).
    for (const row of full.filter((m) => m.messageId !== PRIOR_MENTION_ID)) {
      const { step } = citedMessage(row.messageId);
      const at = stepIndex(step);
      expect(
        mentionsAt(at).some((m) => m.messageId === row.messageId),
        `${row.messageId} missing at its own step`
      ).toBe(true);
      expect(
        mentionsAt(at - 1).some((m) => m.messageId === row.messageId),
        `${row.messageId} present a step early`
      ).toBe(false);
    }
  });

  it("agrees with the transcript about who wrote each cited post", () => {
    for (const row of full.filter((m) => m.messageId !== PRIOR_MENTION_ID)) {
      const { message, agentColor } = citedMessage(row.messageId);
      expect(row.authorUserId).toBe(message.authorUserId);
      expect(row.seq).toBe(message.seq);
      expect(row.createdAt).toBe(message.createdAt);
      expect(row.authorKind).toBe(message.authorKind);
      expect(row.authorAgentColor).toBe(agentColor);
    }
  });
});


describe("6. the thread, the private chat and the channel interleave", () => {
  const stepOf = (clientMsgId: string): StepId =>
    citedMessage(post(clientMsgId).id).step;

  it("posts the coder's line inside the thread, before its view is opened", () => {
    // It is history by the time the panel opens, which is what a sent box IS here.
    expect(stepIndex(stepOf(CODER_POST))).toBeLessThan(stepIndex("agent-open"));
  });

  it("🔒 opens the thread before the agent, and closes it while the agent stays open", () => {
    expect(stepIndex("click-thread")).toBeLessThan(stepIndex("click-agent"));
    // The crumb click is the step-8 hinge: thread shut, agent view still up.
    expect(stepIndex("click-crumb")).toBeGreaterThan(stepIndex("click-agent"));
  });

  it("🔒 runs the channel lines BETWEEN the private turns, not after them", () => {
    // This is the concurrency claim. If both concurrent beats sat after `dm-agent-2`
    // the scene would be sequential and the step-8 ask unmet, which no other probe
    // here would notice.
    expect(stepIndex("concurrent-1")).toBeGreaterThan(stepIndex("dm-agent-1"));
    expect(stepIndex("concurrent-1")).toBeLessThan(stepIndex("dm-user-2"));
    expect(stepIndex("concurrent-3")).toBeGreaterThan(stepIndex("dm-agent-2"));
  });

  it("stamps the brief before the first private turn, so the banner reads first", () => {
    const brief = narrationAt(LAST_STEP).find((e) => e.lane === "inbound");
    const firstTurn = narrationAt(LAST_STEP).find((e) => e.lane === "operator");
    expect(brief).toBeTruthy();
    expect(firstTurn).toBeTruthy();
    expect(brief!.at).toBeLessThan(firstTurn!.at);
  });

  it("carries the brief's own words on that banner", () => {
    const brief = narrationAt(LAST_STEP).find((e) => e.lane === "inbound");
    expect(brief?.text).toBe(post(BRIEF_POST).body);
  });
});

describe("7. threads exist only once their opener has landed", () => {
  it("opens none before the first opener", () => {
    expect(threadsAt(stepIndex("split-3"))).toHaveLength(0);
  });

  it("opens one per orchestrator by the time all three have posted", () => {
    expect(threadsAt(stepIndex("thread-3"))).toHaveLength(3);
  });

  it("🔒 includes the thread the cursor opens", () => {
    const ids = threadsAt(stepIndex("thread-3")).map((t) => t.id);
    expect(ids).toContain(OPEN_THREAD.id);
  });

  it("tags the briefs into that thread, so the thread view has a body", () => {
    const inThread = messagesAt(LAST_STEP).filter(
      (m) => m.metadata?.taskId === OPEN_THREAD.id
    );
    // Three launches, three briefs, the opener and the coder's reply.
    expect(inThread.length).toBeGreaterThanOrEqual(7);
  });

  it("🔒 keeps the mention set alongside the thread tag", () => {
    // The two share `metadata`, and an earlier cut of `msg()` spread `extra` whole over
    // it — which would have dropped one silently. Every briefing line carries an agent
    // tag, so the thread's posts are exactly where that would have shown.
    const brief = post(BRIEF_POST);
    expect(brief.metadata?.taskId).toBe(OPEN_THREAD.id);
    expect(brief.body.startsWith("@")).toBe(true);
  });
});
