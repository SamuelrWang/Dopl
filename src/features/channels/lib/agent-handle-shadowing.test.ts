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
 * ⚠ **THE LAST TWO BLOCKS HAVE CHANGED THEIR ANSWER THREE TIMES, AND EVERY RED WAS A RULING
 * ARRIVING.** Fail-closed ambiguity until 2026-09-07; a MINTED suffix (*"if coder exists, then
 * other slugs will be coder-1, coder-2, coder-3"*) until 2026-09-15; fail-closed again for part
 * of that day; and now **neither**, because Samuel moved the rule off this layer entirely:
 * *"I think we should enforce a rule where no two agents that are addressable can have the same
 * name … it will automatically auto-resolve to coder-1 … coder-2 and so on and so forth."*
 *
 * ⚠ **THE SUFFIX IS STORED AT COMMIT NOW, NOT COMPUTED AT RESOLVE** — `main/agent-name-unique.js`,
 * through `main/agent-identity-commit.js › commitRename`, the one door every rename and launch
 * path shares. That is what makes it DURABLE: the 2026-09-07 mint was positional over the live
 * set, so when the agent holding `coder` ended the next one moved up and `@coder-1` came to name
 * a different agent than it did an hour ago. `docs/specs/agent-id-visibility.md` carries the arc.
 *
 * ⚠ **SO THIS FILE'S SUBJECT NARROWS BACK TO SHADOWING, WHICH IS WHAT ITS NAME SAYS.** The id
 * form must survive a name that spells one; whether two agents may share a name is now answered
 * before anything reaches this index.
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

  it("and the name they chose is DROPPED — it may not take or contest a permanent handle", () => {
    // ⚠ **THE MINTED `-1` SPELLING IS GONE WITH THE MINT (2026-09-15) AND NOTHING REPLACES IT.**
    // A name that spells another agent's id form claims nothing: `buildAgentMentionIndex`'s
    // `idForms` guard keeps pass 2 off those keys entirely, so the handle this whole file exists
    // to protect can be neither overwritten nor withdrawn by a rename.
    expect(resolveAgentHandle(`${agentIdHandle(OWNER)}-1`, shadowed)).toBeNull();
    // ⚠ AND THE COST IS A SPELLING, NEVER AN ADDRESS — the namer's own id form still works,
    // which is the assertion two cases up.
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

/**
 * 🔒 **A SHARED NAME IS NOT SUPPOSED TO REACH THIS INDEX, AND IF IT DOES THE FIRST CLAIMANT KEEPS
 * IT** (Samuel, 2026-09-15).
 *
 * ⚠ **PINNED IN BOTH DIRECTIONS**, because half of it would pass over either predecessor: "the
 * first claimant is reached" is the answer, and "nothing was minted in its place" is what keeps
 * the 2026-09-07 suffix from growing back at resolve time.
 *
 * ⚠ **WHAT MAKES FIRST-COME SAFE IS THAT THE COLLISION IS PREVENTED UPSTREAM.** A second "Coder"
 * is STORED as `Coder-1` (`main/agent-name-unique.js`), so this branch is reachable only by a
 * legacy row, a PEER's agent (names are minted on the machine that owns them), or a push this
 * build has not received yet. For those, naming the first claimant never re-points an address and
 * never withdraws one — where "neither" silently drops a message the author watched tint.
 */
describe("a shared NAME names the FIRST claimant, and mints nothing", () => {
  const shared = index(
    { agentId: OWNER, displayName: "Bug Reviewer" },
    { agentId: IMPOSTOR, displayName: "Bug Reviewer" }
  );

  it("resolves the bare slug to the first claimant", () => {
    expect(resolveAgentHandle("bug-reviewer", shared)).toBe(OWNER);
  });

  it("mints NO suffixed spelling — the suffix is a STORED name, not a resolve-time one", () => {
    expect(resolveAgentHandle("bug-reviewer-1", shared)).toBeNull();
    expect(resolveAgentHandle("bug-reviewer-2", shared)).toBeNull();
  });

  it("resolves a name that was SUFFIXED AT LAUNCH like any other name", () => {
    // ⚠ THIS IS WHAT THE RULING ACTUALLY PRODUCES, and nothing here knows about `-1`: the second
    // agent's `displayName` IS `Bug Reviewer-1`, and it slugs by the ordinary rule.
    const stored = index(
      { agentId: OWNER, displayName: "Bug Reviewer" },
      { agentId: IMPOSTOR, displayName: "Bug Reviewer-1" }
    );
    expect(resolveAgentHandle("bug-reviewer", stored)).toBe(OWNER);
    expect(resolveAgentHandle("bug-reviewer-1", stored)).toBe(IMPOSTOR);
  });

  it("leaves both reachable by their id forms — the handle that is never withdrawn", () => {
    expect(resolveAgentHandle(agentIdHandle(OWNER), shared)).toBe(OWNER);
    expect(resolveAgentHandle(agentIdHandle(IMPOSTOR), shared)).toBe(IMPOSTOR);
  });

  it("is not disturbed by the SAME agent reported twice", () => {
    const twice = index(
      { agentId: OWNER, displayName: "Bug Reviewer" },
      { agentId: OWNER, displayName: "Bug Reviewer" }
    );
    expect(resolveAgentHandle("bug-reviewer", twice)).toBe(OWNER);
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

  it("mints the agent NO spelling around the member's tag", () => {
    // ⚠ CHANGED 2026-09-15 WITH THE MINT'S WITHDRAWAL. A reserved handle is one somebody else
    // owns; the agent loses the NAME door here and keeps the id form, which is the case below.
    // ⚠ **THE COMMIT-TIME RULE DOES NOT COVER THIS CASE AND IS NOT MEANT TO** — it makes agent
    // names unique among AGENTS, and the member namespace is not its to rewrite. `@diana-1` would
    // still be a handle no human agreed to wear.
    expect(resolveAgentHandle("diana-1", reserved)).toBeNull();
  });

  it("and its id form is untouched by any of it", () => {
    expect(resolveAgentHandle(agentIdHandle(OWNER), reserved)).toBe(OWNER);
  });
});
