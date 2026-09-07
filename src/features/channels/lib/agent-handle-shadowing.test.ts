/**
 * 🔒 A NAME CANNOT TAKE AN AGENT'S ID HANDLE AWAY FROM IT (2026-09-07).
 *
 * ⚠ THE DEFECT. `buildAgentMentionIndex` claimed, per candidate, the id form and then the name —
 * which reads as "the id form first" and is not. The id form was claimed before THAT candidate's
 * own name, never before every OTHER candidate's. So an agent named `Agent K3v7d2mq` slugs to
 * `agent-k3v7d2mq`, contests the permanent handle of the agent whose id that actually is, and
 * ambiguity-fails-closed resolved the id form to NOBODY.
 *
 * ⚠ WHY THAT IS A DEFECT AND NOT A TRADE-OFF. This module's header states the invariant it
 * breaks in as many words: the id form "is the handle that cannot stop working, so it is never
 * withdrawn — a rename must not silently break an address somebody already wrote down." A rename
 * did exactly that.
 *
 * ⚠ AND IT CROSSED MEMBERS. The server builds this same index over the room's live session rows
 * whoever runs them (`server/service-wake-verdict-handles.ts`), so one member could withdraw
 * ANOTHER member's agent from addressing by naming their own agent after it — and the refusal
 * that came back, `ChannelAgentHandleAmbiguousError`, lists its claimants AS THEIR ID FORMS. It
 * told the writer to retry with the very handle it had just refused. An unactionable error is
 * how a denial-of-addressing looks from the inside.
 *
 * ⚠ **THE LAST BLOCK CHANGED ITS ANSWER ON 2026-09-07 AND THE RED WAS THE RULING ARRIVING.** It
 * used to assert that two agents genuinely sharing a NAME fail closed — "not shadowing, real
 * ambiguity, the rule this file has always had". Samuel then ruled the other way, verbatim: *"if
 * coder exists, then other slugs will be coder-1, coder-2, coder-3"*. Failing closed cost an
 * address that a rename could take from an agent never renamed, so the shared name now MINTS:
 * first claimant keeps the bare slug, the second wears `-1`, and both stay reachable. What the
 * fix still may not cost is the id form, which is the first three blocks and is unmoved.
 */

import { describe, expect, it } from "vitest";
import {
  agentIdHandle,
  buildAgentMentionIndex,
  resolveAgentHandle,
} from "./agent-mentions";

const OWNER = "k3v7d2mq";
const IMPOSTOR = "m4x8p1qr";

const index = (...candidates: { agentId: string; displayName?: string | null }[]) =>
  buildAgentMentionIndex(candidates);

describe("an id form survives a name that spells it", () => {
  const shadowed = index(
    { agentId: OWNER, displayName: null },
    { agentId: IMPOSTOR, displayName: "Agent K3v7d2mq" }
  );

  it("still resolves to the agent whose id it is", () => {
    expect(resolveAgentHandle(agentIdHandle(OWNER), shadowed)).toBe(OWNER);
  });

  it("does not resolve to the agent that merely named itself so", () => {
    expect(resolveAgentHandle(agentIdHandle(OWNER), shadowed)).not.toBe(IMPOSTOR);
  });

  it("leaves the namer reachable by their OWN id form — the fallback that never fails", () => {
    expect(resolveAgentHandle(agentIdHandle(IMPOSTOR), shadowed)).toBe(IMPOSTOR);
  });

  it("and the name they chose is MINTED around the id form rather than dropped", () => {
    // ⚠ THE OLD ANSWER DROPPED IT, so the namer's chosen name reached nobody at all. Under the
    // suffix ruling the collision costs a spelling, not an address.
    expect(resolveAgentHandle(`${agentIdHandle(OWNER)}-1`, shadowed)).toBe(IMPOSTOR);
  });

  it("holds regardless of which order the candidates arrive in", () => {
    // ⚠ THE ONE-LOOP VERSION PASSED OR FAILED ON FEED ORDER, which is why this is asserted both
    // ways round: a live-session feed has no guaranteed order, so the old behaviour was not even
    // consistently wrong.
    const reversed = index(
      { agentId: IMPOSTOR, displayName: "Agent K3v7d2mq" },
      { agentId: OWNER, displayName: null }
    );
    expect(resolveAgentHandle(agentIdHandle(OWNER), reversed)).toBe(OWNER);
  });

  it("is unaffected when the owner has a name of its own", () => {
    const both = index(
      { agentId: OWNER, displayName: "Research Bot" },
      { agentId: IMPOSTOR, displayName: "Agent K3v7d2mq" }
    );
    expect(resolveAgentHandle(agentIdHandle(OWNER), both)).toBe(OWNER);
    expect(resolveAgentHandle("research-bot", both)).toBe(OWNER);
  });
});

describe("an agent named after its own id keeps working", () => {
  it("resolves to itself rather than colliding with itself", () => {
    const self = index({ agentId: OWNER, displayName: `Agent ${OWNER}` });
    expect(resolveAgentHandle(agentIdHandle(OWNER), self)).toBe(OWNER);
  });
});

describe("a shared NAME mints a suffix — claim order decides who keeps the bare slug", () => {
  const shared = index(
    { agentId: OWNER, displayName: "Bug Reviewer" },
    { agentId: IMPOSTOR, displayName: "Bug Reviewer" }
  );

  it("gives the FIRST claimant the bare slug", () => {
    expect(resolveAgentHandle("bug-reviewer", shared)).toBe(OWNER);
  });

  it("mints `-1` for the second instead of resolving to neither", () => {
    expect(resolveAgentHandle("bug-reviewer-1", shared)).toBe(IMPOSTOR);
  });

  it("and both are still reachable by their id forms", () => {
    expect(resolveAgentHandle(agentIdHandle(OWNER), shared)).toBe(OWNER);
    expect(resolveAgentHandle(agentIdHandle(IMPOSTOR), shared)).toBe(IMPOSTOR);
  });
});

/**
 * 🔒 **MEMBERS OUTRANK AGENTS** — the reserved set, and the second half of the precedence line
 * "id forms, then members, then agents by claim order" (2026-09-07).
 *
 * ⚠ **IT IS SHADOWING BY ANOTHER ROUTE, WHICH IS WHY IT BELONGS IN THIS FILE.** An operator who
 * names their agent after a person in the room would otherwise claim `@diana` in the AGENT
 * namespace while the member keeps it in the MEMBER one — one token, two resolvers, and which
 * answer a reader got decided by which loop ran first.
 */
describe("an agent named after a member does not take the member's tag", () => {
  const reserved = buildAgentMentionIndex(
    [{ agentId: OWNER, displayName: "Diana" }],
    ["diana"]
  );

  it("leaves the bare tag to the member", () => {
    expect(resolveAgentHandle("diana", reserved)).toBeNull();
  });

  it("keeps the agent addressable at its minted spelling", () => {
    expect(resolveAgentHandle("diana-1", reserved)).toBe(OWNER);
  });

  it("and its id form is untouched by any of it", () => {
    expect(resolveAgentHandle(agentIdHandle(OWNER), reserved)).toBe(OWNER);
  });
});
