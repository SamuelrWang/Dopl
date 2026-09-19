import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./repository-sessions");
vi.mock("./repository-messages");
// ⚠ PARTIAL, never flat, and it must not fail FAST — see the identical block in
// `service-wake-verdict.test.ts` for why an unmocked `findUnaddressedResponder`
// times out every case in the file rather than failing one.
vi.mock("./repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./repository")>()),
  findUnaddressedResponder: vi.fn(),
}));

import {
  CTX,
  projection,
  recentAgentPosts,
  resolve,
  roomProjection,
  sessionRow,
  unaddressedResponder,
} from "./service-wake-verdict-harness";

/**
 * **`to=@desktop` — THE OPERATOR'S OUTSIDE SESSIONS** (2026-09-18, Samuel's
 * ruling on the external-session group tag).
 *
 * ⚠ **THE CASES THAT MATTER ARE THE ONES ABOUT WHAT DOES *NOT* HAPPEN.** The
 * happy path is one assertion; the reason this address exists is that it must
 * reach a lane WITHOUT waking a desktop-run agent, WITHOUT notifying the
 * operator as a person, and WITHOUT being "repaired" by an arm that mistakes it
 * for a forgotten `@`. Each of those is a separate case below, because each has
 * its own way of silently coming back.
 *
 * ⚠ **THE SIBLING-ISOLATION CASES ARE THE POINT OF THE MIXED SENDS.** Samuel's
 * ruling is that each recipient gets exactly its own effect; a mixed send is
 * where that is easiest to get wrong, because one verdict word has to cover
 * several columns.
 */

const AGENT = "k3v7d2mq";
const PEER = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  projection();
  roomProjection();
  recentAgentPosts();
  unaddressedResponder();
});

describe("to=@desktop — the verdict", () => {
  it("is its own verdict and its own delivery, and wakes nobody", async () => {
    const out = await resolve("please pick this up", {}, {
      authorKind: "agent",
      toDesktopOperatorIds: [CTX.userId],
    });
    expect(out.verdict).toBe("desktop");
    // ⚠ `posted`, NEVER `woken` and NEVER `held`. Nothing on this server can see
    // whether an outside session is holding, so the word may only report that
    // the message is in the room.
    expect(out.delivery).toBe("posted");
    // 🔒 THE WHOLE SAFETY PROPERTY, AS TWO ASSERTIONS. These are the columns
    // every machine routes on; empty here is what makes "starts nothing on the
    // operator's machine" true for an OLD desktop as well as a new one.
    expect(out.recipientAgentIds, "no agent is named").toEqual([]);
    expect(out.recipientUserIds, "the operator is NOT a member recipient").toEqual([]);
  });

  it("is NOT repaired by RR3, though it named no agent and no member", async () => {
    // ⚠ THE REGRESSION THIS FILE EXISTS FOR. The arms fire on "the author
    // addressed NOBODY", which a `@desktop`-only send satisfies for the opposite
    // reason — the author named a lane deliberately. Before `toDesktop` joined
    // `addressed`, RR3 handed such a post to the room's default responder: a
    // wake nobody asked for, aimed at a different audience than the one written.
    roomProjection(sessionRow({ name: AGENT }));
    const out = await resolve("notes for my own tooling", {}, {
      // A PERSON author, which is the only kind RR3 answers for.
      authorKind: "user",
      toDesktopOperatorIds: [CTX.userId],
    });
    expect(out.verdict).toBe("desktop");
    expect(out.recipientAgentIds).toEqual([]);
    expect(out.reason, "no arm chose anything, so there is no reason").toBeNull();
  });

  it("never reports `unreachable`, even when the body names a dead handle", async () => {
    // ⚠ REACHABLE IN PRACTICE: "handing this to @desktop, @gone-agent has the
    // context" with `to="@desktop"`. The body handle resolves to nothing, which
    // is the `null` that normally becomes `unreachable` — and reporting it here
    // would bury a delivery that happened under a complaint about prose.
    const out = await resolve("@agent-zzzzzzzz has the context", {}, {
      authorKind: "user",
      toDesktopOperatorIds: [CTX.userId],
    });
    expect(out.delivery).toBe("posted");
    expect(out.verdict).toBe("desktop");
  });
});

describe("to=@desktop — mixed sends give each recipient its own effect", () => {
  it("with an AGENT: the agent is woken, and no sibling effect is lost", async () => {
    projection(sessionRow({ name: AGENT }));
    const out = await resolve("both of you", {}, {
      authorKind: "agent",
      toAgentIds: [AGENT],
      toDesktopOperatorIds: [CTX.userId],
    });
    // ⚠ THE LOUDEST REACH TAKES THE WORD — the same rule a mixed member/agent
    // send already follows. Nothing is dropped, because machines route on the
    // COLUMNS and read the word only to explain themselves.
    expect(out.verdict).toBe("agent");
    expect(out.delivery).toBe("woken");
    expect(out.recipientAgentIds).toEqual([AGENT]);
    // 🔒 AND THE DESKTOP HALF STILL DID NOT BECOME A MEMBER RECIPIENT.
    expect(out.recipientUserIds).toEqual([]);
  });

  it("with a PERSON: the person is a member recipient and the desktop half is not", async () => {
    const out = await resolve("for you and my tooling", {}, {
      authorKind: "agent",
      toUserIds: [PEER],
      toDesktopOperatorIds: [CTX.userId],
    });
    expect(out.verdict).toBe("member");
    expect(out.delivery).toBe("delivered");
    // 🔒 **THE HUMAN IS NOT PINGED FOR THE `@desktop` PART.** Exactly ONE id is
    // in the member column — the peer who was actually addressed — and the
    // author's own operator id, which `@desktop` resolved to, is absent. Had it
    // leaked in, the operator would be notified as a person for addressing
    // their own tooling.
    expect(out.recipientUserIds).toEqual([PEER]);
    expect(out.recipientUserIds).not.toContain(CTX.userId);
  });
});
