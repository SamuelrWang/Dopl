// The addressable handle `op="status"` publishes, and the handle rule in `channelDoctrine()` that must
// travel with it: a tool result is read at the moment a model picks its next action (INVARIANTS §10).

import { describe, expect, it } from "vitest";
import { addressableHandle } from "./channel-session-handle";
import { formatSessionLine } from "./channel-session-render";
import { sessionBlockLines } from "./channel-session-table";
import { channelDoctrine, DOCTRINE_SECTIONS } from "./channel-doctrine";
import type { ChannelSessionStateOwn } from "@dopl/client";

const NOW = Date.parse("2026-08-31T05:00:00.000Z");

const ownRow = (over: Partial<ChannelSessionStateOwn> = {}): ChannelSessionStateOwn => ({
  channelId: "bb0f57db-bb46-4ce6-af96-83eb8e2dbf28",
  threadId: null,
  name: "x2sz1ztt",
  state: "idle",
  detail: null,
  channelName: "Dopl",
  threadTitle: null,
  updatedAt: new Date(NOW - 5_000).toISOString(),
  model: null,
  toolLabel: null,
  contextUsed: null,
  contextWindow: null,
  tokensSpent: null,
  startedAt: null,
  lastActivityAt: null,
  identityName: null,
  ...over,
});

describe("addressableHandle — one form, and a fail-closed recogniser", () => {
  it("answers the PREFIXED form for an agent id", () => {
    // Both forms parse on the desktop (`session-dispatch.js › mentionedAgentIds`), but the app's picker
    // inserts and tints the prefixed one; publishing the other is the F-266 split.
    expect(addressableHandle("x2sz1ztt")).toBe("@agent-x2sz1ztt");
  });

  it("answers NULL for a legacy pool handle rather than inventing an address", () => {
    // `channel_sessions.name`'s CHECK is wider than the id charset, and an older desktop is a supported
    // peer (INVARIANTS §13): its legacy name must print no `@agent-` address.
    expect(addressableHandle("flint")).toBeNull();
    expect(addressableHandle("onyx")).toBeNull();
  });

  it("refuses everything that is not exactly the id charset", () => {
    // The same anchored pattern as `main/agent-id.js` and `schema-launch.ts › LaunchDecideSchema.agentId`.
    for (const bad of [
      "",
      "x2sz1zt", // 7
      "x2sz1ztt9", // 9
      "2xsz1ztt", // does not start with a letter
      "x2sz-ztt", // a dash is legal in a NAME and never in an id
      "X2SZ1ZTT",
      "x2sz1ztt ",
    ]) {
      expect(addressableHandle(bad), `"${bad}" must not read as an id`).toBeNull();
    }
  });
});

describe("the session LINE carries the handle, and only for an own row", () => {
  it("prints it in the HEAD, beside the name", () => {
    // In the head, not the telemetry tail a skimming model drops first.
    const line = formatSessionLine(ownRow(), { handle: true, now: NOW });
    expect(line).toContain("**`x2sz1ztt`** (`@agent-x2sz1ztt`)");
  });

  it("prints NOTHING extra without the flag — the audience decides, not verbosity", () => {
    // An agent id is a wake token, so publishing it is an audience decision, not a verbosity one.
    const line = formatSessionLine(ownRow(), { now: NOW });
    expect(line).toContain("**`x2sz1ztt`**");
    expect(line).not.toContain("@agent-");
  });

  it("prints nothing extra for a legacy name even WITH the flag", () => {
    const line = formatSessionLine(ownRow({ name: "flint" }), {
      handle: true,
      now: NOW,
    });
    expect(line).toContain("**`flint`**");
    expect(line).not.toContain("@agent-");
  });
});

// The handle rule lives in the pulled doctrine; each clause is pinned there and absent from the result.
describe("the handle rule survived the move to the doctrine, clause for clause", () => {
  it("names the form, and says a CUSTOM NAME **is** the address", () => {
    // The name is the address (`channel_sessions.display_name` is peer-visible), and its exclusivity
    // clause travels with it.
    expect(channelDoctrine()).toContain("that tag, in `to`, wakes THAT agent");
    expect(channelDoctrine()).toContain("AND ONLY IN `to`, BY NAME");
    expect(channelDoctrine()).toContain("never without naming one");
    expect(channelDoctrine()).toContain("what people see and what agents tag it by");
    // The id still exists and must not be written into a message.
    expect(channelDoctrine()).toContain("NEVER WRITE AN AGENT ID IN A MESSAGE");
  });

  it("SAYS THE HANDLE WAKES, AND NAMES IT AS A WAKE RATHER THAN A TAG", () => {
    // The MCP caller posts under its operator's account, which is what licenses the wake.
    expect(channelDoctrine()).toContain("wakes THAT agent");
    expect(channelDoctrine()).toContain(
      "Tagging is not addressing and starts no agent",
    );
  });

  it("puts the GOAL first — waking is for redirecting, not for starting", () => {
    // Goal first, wake thereafter: the launch takes the body as its first instruction.
    expect(channelDoctrine()).toContain("its `body` is its FIRST INSTRUCTION");
    expect(channelDoctrine()).toContain(
      'op="manage" action="launch" starts one and answers the name it got; that tag, in `to`, wakes THAT agent',
    );
  });

  it("CARRIES ALL THREE LIMITS — an exception without its boundary is a hole", () => {
    // (1) Addressed only: an unaddressed agent post is exactly what the loop brake refuses.
    expect(channelDoctrine()).toContain(
      "an AGENT-authored UNADDRESSED message starts nobody",
    );
    expect(channelDoctrine()).toContain(
      "YOUR OWN OPERATOR'S AGENTS, AND ONLY THEIR MACHINE",
    );
    expect(channelDoctrine()).toContain("Never another member's agent");
    // (3) The receipt (`delivery=`) is the only ack; the wake itself is decided on a desktop.
    expect(channelDoctrine()).toContain("`delivery=` IS THE ACK AND THE ONLY ONE");
    expect(channelDoctrine()).toContain(
      "`idle` resolved but nothing running, filed until that machine reconciles",
    );
    // The capability and its boundary in one breath, so a reader cannot take the first alone.
    expect(DOCTRINE_SECTIONS.law).toContain(
      "YOUR OWN AGENTS ARE THE ONE EXCEPTION, AND ONLY IN `to`, BY NAME",
    );
  });

  it("never suggests a way AROUND the fence", () => {
    // The loop brake is deliberate (INVARIANTS §11) and must not read as an obstacle with a workaround.
    // Scoped to `manage`: the refusal table says "not something to work around" about the launch
    // toggle, the opposite claim. The ask-is-not-a-grant denial is `posture`'s `.describe()`,
    // pinned in `channel-ops-agent-mode.test.ts`.
    expect(DOCTRINE_SECTIONS.manage).not.toMatch(
      /work ?around|bypass|instead you can post/i,
    );
  });

  it("IS NO LONGER RE-TRANSMITTED PER CALL — the other half of the move", () => {
    // Arrival is the tests above; this is departure, on the phrases the doctrine ships now.
    const page = sessionBlockLines([ownRow({})], NOW).join("\n");
    expect(page).not.toContain("AND ONLY IN `to`, BY NAME");
    expect(page).not.toContain("wakes THAT agent");
    expect(page).not.toContain("reaches no server");
  });
});

