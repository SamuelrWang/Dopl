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
  resolveMentions,
} from "@/features/channels/lib/mentions";
import type { ChannelMessage } from "@/features/channels/types";
import {
  AGENT_IDS,
  AGENT_INDEX,
  MEMBERS,
  citedMessage,
  mentionMetadata,
  messagesAt,
} from "./demo-data";
import { narrationAt } from "./demo-narration";
import { mentionsAt } from "./demo-info-data";
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

/** `agentPost` stamps `agent-<id>-<n>`; these are the writer's two channel posts. */
const WRITER_FIRST_POST = `agent-${AGENT_IDS.writer}-1`;
const WRITER_SECOND_POST = `agent-${AGENT_IDS.writer}-2`;

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

  it("keeps its white keyline, which the banner cursor does not need", () => {
    // Approved deviation: this cursor rides /home's dark slab.
    expect(demo).toContain('stroke="#ffffff"');
    expect(banner).not.toContain('stroke="#ffffff"');
  });
});

describe("2. every agent has its own colour", () => {
  const entries = [...AGENT_INDEX.entries()];

  it("indexes all three agents", () => {
    expect(entries).toHaveLength(3);
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
    const samuel = MEMBERS.find((m) => (m.displayName ?? "").startsWith("Samuel"));
    if (!samuel) throw new Error("no Samuel in the demo roster");

    it("resolves a tagged member to their id", () => {
      expect(mentionMetadata("@Grace can you take a look?", samuel.userId)).toEqual({
        [MENTIONS_METADATA_KEY]: [grace.userId],
      });
    });

    it("excludes the author, so tagging yourself lights nobody's inbox", () => {
      expect(mentionMetadata("@Samuel reminding myself", samuel.userId)).toEqual({});
    });

    /**
     * ⚠ **AND THE CALL SITE IS ASSERTED ON THE SOURCE, because neither probe above can
     * see it.** Driving the function proves the function; it says nothing about whether
     * `msg()` still calls it. With no `@` in today's copy, cutting the call site back to
     * `metadata: {}` left all twenty-four of these green — measured, not assumed — so the
     * wiring is pinned the only way it can be until the new lines land.
     */
    it("is wired into every scripted message, not merely available", () => {
      const text = source("demo-data.ts");
      expect(text).toContain("metadata: mentionMetadata(body, authorUserId)");
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

  it("shows both banner faces: one from a member, one from an agent", () => {
    // The human-versus-agent colouring is `ui/received-banner-color`'s; the scene has to
    // feed it one of each or only half of it is ever visible here.
    const senders = entries
      .filter((e) => e.lane === "inbound")
      .map((e) => e.senderName);
    const people = new Set(MEMBERS.map((m) => m.displayName));
    const agents = new Set([...AGENT_INDEX.values()].map((a) => a.displayName));
    expect(senders.some((s) => people.has(s ?? ""))).toBe(true);
    expect(senders.some((s) => agents.has(s ?? ""))).toBe(true);
  });

  it("stamps each arrival no earlier than the agent's first post", () => {
    const first = epoch(post(WRITER_FIRST_POST).createdAt);
    for (const entry of entries.filter((e) => e.lane === "inbound")) {
      expect(entry.at).toBeGreaterThanOrEqual(first);
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

  it("reveals each row on the beat of the post it cites, and not before", () => {
    for (const row of full) {
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
    for (const row of full) {
      const { message, agentColor } = citedMessage(row.messageId);
      expect(row.authorUserId).toBe(message.authorUserId);
      expect(row.seq).toBe(message.seq);
      expect(row.createdAt).toBe(message.createdAt);
      expect(row.authorKind).toBe(message.authorKind);
      expect(row.authorAgentColor).toBe(agentColor);
    }
  });
});

describe("6. the second posted box lands after the private exchange", () => {
  const stepOf = (clientMsgId: string): StepId =>
    citedMessage(post(clientMsgId).id).step;

  it("reveals the first post before the agent view opens", () => {
    expect(stepIndex(stepOf(WRITER_FIRST_POST))).toBeLessThan(
      stepIndex("agent-open")
    );
  });

  it("reveals the second post only after the last private turn", () => {
    expect(stepIndex(stepOf(WRITER_SECOND_POST))).toBeGreaterThan(
      stepIndex("dm-agent-2")
    );
  });

  it("stamps the second post after every narration entry, so the stream sorts it last", () => {
    // `agent-stream-model.ts › buildAgentStream` orders on `at`; the reveal and the
    // stamp have to agree or the box pops in above the conversation.
    const second = epoch(post(WRITER_SECOND_POST).createdAt);
    const latest = Math.max(...narrationAt(LAST_STEP).map((e) => e.at));
    expect(second).toBeGreaterThan(latest);
  });

  it("keeps the first post earlier than the second on both axes", () => {
    expect(epoch(post(WRITER_FIRST_POST).createdAt)).toBeLessThan(
      epoch(post(WRITER_SECOND_POST).createdAt)
    );
  });
});
