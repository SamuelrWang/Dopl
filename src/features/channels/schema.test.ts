/**
 * INVARIANT SUITE — channels zod schemas.
 *
 * Locks the caller-input validation contract that both the REST handlers and
 * the MCP channel tools parse against. The security-load-bearing invariants:
 *   - `kind` / `authorKind` REJECT the server-reserved `system` value (a caller
 *     must never be able to post an anonymized system-styled message).
 *   - `summary` is length-capped (it rides into a receiver's consent prompt —
 *     an uncapped value is a spoofing surface).
 *   - `toUserId` must be a UUID; `notifyScope` is a closed enum.
 * A cap / enum change here is a contract change and must be deliberate.
 */

import { describe, it, expect } from "vitest";
import {
  ChannelCreateSchema,
  ChannelUpdateSchema,
  ChannelMessageCreateSchema,
  ChannelMemberSelfUpdateSchema,
  ChannelMemberAddSchema,
  ChannelMemberRemoveSchema,
  MessageReadQuerySchema,
  AwaitQuerySchema,
  ConsentCreateSchema,
  ConsentDecisionSchema,
  ConsentListQuerySchema,
  TrustMutateSchema,
  PresenceHeartbeatSchema,
} from "./schema";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("ChannelCreateSchema", () => {
  it("accepts a minimal valid create (name only)", () => {
    expect(ChannelCreateSchema.safeParse({ name: "General" }).success).toBe(true);
  });

  it("name: 1..120 chars, trimmed", () => {
    expect(ChannelCreateSchema.safeParse({ name: "" }).success).toBe(false);
    expect(ChannelCreateSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(ChannelCreateSchema.safeParse({ name: "a".repeat(120) }).success).toBe(true);
    expect(ChannelCreateSchema.safeParse({ name: "a".repeat(121) }).success).toBe(false);
  });

  it("slug: optional, 1..80 chars", () => {
    expect(ChannelCreateSchema.safeParse({ name: "x", slug: "a".repeat(80) }).success).toBe(true);
    expect(ChannelCreateSchema.safeParse({ name: "x", slug: "a".repeat(81) }).success).toBe(false);
    expect(ChannelCreateSchema.safeParse({ name: "x", slug: "" }).success).toBe(false);
  });

  it("topic: <= 2000 chars", () => {
    expect(ChannelCreateSchema.safeParse({ name: "x", topic: "a".repeat(2000) }).success).toBe(true);
    expect(ChannelCreateSchema.safeParse({ name: "x", topic: "a".repeat(2001) }).success).toBe(false);
  });

  it("visibility: private|public only", () => {
    expect(ChannelCreateSchema.safeParse({ name: "x", visibility: "private" }).success).toBe(true);
    expect(ChannelCreateSchema.safeParse({ name: "x", visibility: "public" }).success).toBe(true);
    expect(ChannelCreateSchema.safeParse({ name: "x", visibility: "secret" }).success).toBe(false);
  });
});

describe("ChannelUpdateSchema", () => {
  it("rejects an empty patch (refine)", () => {
    expect(ChannelUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a single-field patch, incl. the archived toggle", () => {
    expect(ChannelUpdateSchema.safeParse({ archived: true }).success).toBe(true);
    expect(ChannelUpdateSchema.safeParse({ name: "Renamed" }).success).toBe(true);
    expect(ChannelUpdateSchema.safeParse({ topic: "" }).success).toBe(true);
  });

  it("archived must be a boolean", () => {
    expect(ChannelUpdateSchema.safeParse({ archived: "yes" }).success).toBe(false);
  });
});

describe("ChannelMessageCreateSchema", () => {
  it("accepts a minimal message (body only)", () => {
    expect(ChannelMessageCreateSchema.safeParse({ body: "hi" }).success).toBe(true);
  });

  it("body: 1..16000 chars", () => {
    expect(ChannelMessageCreateSchema.safeParse({ body: "" }).success).toBe(false);
    expect(ChannelMessageCreateSchema.safeParse({ body: "a".repeat(16000) }).success).toBe(true);
    expect(ChannelMessageCreateSchema.safeParse({ body: "a".repeat(16001) }).success).toBe(false);
  });

  it("kind: accepts message + the task_* activity kinds", () => {
    for (const kind of [
      "message",
      "task_started",
      "task_progress",
      "task_finished",
      "task_failed",
    ]) {
      expect(ChannelMessageCreateSchema.safeParse({ body: "x", kind }).success).toBe(true);
    }
  });

  it("kind: REJECTS the server-reserved `system` value", () => {
    // `system` (joins / topic changes) is emitted only by the service; a
    // caller posting a system-styled message would spoof an anonymized event.
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", kind: "system" }).success).toBe(false);
  });

  it("authorKind: accepts user|agent, REJECTS `system`", () => {
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", authorKind: "user" }).success).toBe(true);
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", authorKind: "agent" }).success).toBe(true);
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", authorKind: "system" }).success).toBe(false);
  });

  it("summary: trimmed, 1..200 chars (consent-prompt cap)", () => {
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", summary: "" }).success).toBe(false);
    // Whitespace-only trims to empty and fails the min(1).
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", summary: "   " }).success).toBe(false);
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", summary: "a".repeat(200) }).success).toBe(true);
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", summary: "a".repeat(201) }).success).toBe(false);
  });

  it("toUserId: must be a UUID", () => {
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", toUserId: UUID }).success).toBe(true);
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", toUserId: "not-a-uuid" }).success).toBe(false);
  });

  it("clientMsgId: 1..200 chars", () => {
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", clientMsgId: "" }).success).toBe(false);
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", clientMsgId: "a".repeat(200) }).success).toBe(true);
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", clientMsgId: "a".repeat(201) }).success).toBe(false);
  });

  it("metadata: must be an object, not a scalar/array", () => {
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", metadata: { a: 1 } }).success).toBe(true);
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", metadata: "nope" }).success).toBe(false);
    // A record is object-keyed; an array is not an accepted shape.
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", metadata: [1, 2] }).success).toBe(false);
  });
});

describe("ChannelMemberSelfUpdateSchema", () => {
  it("accepts a notifyScope-only, agentToolProfile-only, or combined patch", () => {
    expect(ChannelMemberSelfUpdateSchema.safeParse({ notifyScope: "none" }).success).toBe(true);
    expect(
      ChannelMemberSelfUpdateSchema.safeParse({ agentToolProfile: "read_only" }).success
    ).toBe(true);
    expect(
      ChannelMemberSelfUpdateSchema.safeParse({
        notifyScope: "all",
        agentToolProfile: "dopl_only",
      }).success
    ).toBe(true);
  });

  it("notifyScope: all|addressed|none only", () => {
    for (const notifyScope of ["all", "addressed", "none"]) {
      expect(ChannelMemberSelfUpdateSchema.safeParse({ notifyScope }).success).toBe(true);
    }
    expect(ChannelMemberSelfUpdateSchema.safeParse({ notifyScope: "loud" }).success).toBe(false);
  });

  it("agentToolProfile: full|dopl_only|read_only only", () => {
    for (const agentToolProfile of ["full", "dopl_only", "read_only"]) {
      expect(ChannelMemberSelfUpdateSchema.safeParse({ agentToolProfile }).success).toBe(true);
    }
    expect(
      ChannelMemberSelfUpdateSchema.safeParse({ agentToolProfile: "none" }).success
    ).toBe(false);
  });

  it("rejects an empty patch (refine)", () => {
    expect(ChannelMemberSelfUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("member add / remove schemas", () => {
  it("userId must be a UUID", () => {
    expect(ChannelMemberAddSchema.safeParse({ userId: UUID }).success).toBe(true);
    expect(ChannelMemberAddSchema.safeParse({ userId: "x" }).success).toBe(false);
    expect(ChannelMemberRemoveSchema.safeParse({ userId: UUID }).success).toBe(true);
    expect(ChannelMemberRemoveSchema.safeParse({ userId: "x" }).success).toBe(false);
  });
});

describe("MessageReadQuerySchema", () => {
  it("defaults limit to 100 when omitted", () => {
    const parsed = MessageReadQuerySchema.parse({});
    expect(parsed.limit).toBe(100);
    expect(parsed.since).toBeUndefined();
  });

  it("coerces string query params to numbers", () => {
    const parsed = MessageReadQuerySchema.parse({ since: "42", limit: "10" });
    expect(parsed.since).toBe(42);
    expect(parsed.limit).toBe(10);
  });

  it("since: non-negative integer", () => {
    expect(MessageReadQuerySchema.safeParse({ since: "0" }).success).toBe(true);
    expect(MessageReadQuerySchema.safeParse({ since: "-1" }).success).toBe(false);
    expect(MessageReadQuerySchema.safeParse({ since: "1.5" }).success).toBe(false);
  });

  it("limit: positive, capped at 200", () => {
    expect(MessageReadQuerySchema.safeParse({ limit: "200" }).success).toBe(true);
    expect(MessageReadQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
    expect(MessageReadQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
  });
});

describe("AwaitQuerySchema", () => {
  it("timeoutMs: optional, capped at 50000", () => {
    expect(AwaitQuerySchema.safeParse({}).success).toBe(true);
    expect(AwaitQuerySchema.safeParse({ timeoutMs: "50000" }).success).toBe(true);
    expect(AwaitQuerySchema.safeParse({ timeoutMs: "50001" }).success).toBe(false);
    expect(AwaitQuerySchema.safeParse({ timeoutMs: "0" }).success).toBe(false);
  });
});

describe("ConsentCreateSchema", () => {
  it("requires channelId (uuid) + kind", () => {
    expect(
      ConsentCreateSchema.safeParse({ channelId: UUID, kind: "inbound" }).success
    ).toBe(true);
    expect(ConsentCreateSchema.safeParse({ kind: "inbound" }).success).toBe(false);
    expect(
      ConsentCreateSchema.safeParse({ channelId: "nope", kind: "inbound" }).success
    ).toBe(false);
  });

  it("kind: inbound|outbound only", () => {
    expect(ConsentCreateSchema.safeParse({ channelId: UUID, kind: "outbound" }).success).toBe(true);
    expect(ConsentCreateSchema.safeParse({ channelId: UUID, kind: "sideways" }).success).toBe(false);
  });

  it("summary caps at 200 (renders on the card); defaults empty", () => {
    expect(ConsentCreateSchema.parse({ channelId: UUID, kind: "inbound" }).summary).toBe("");
    expect(
      ConsentCreateSchema.safeParse({ channelId: UUID, kind: "inbound", summary: "a".repeat(200) }).success
    ).toBe(true);
    expect(
      ConsentCreateSchema.safeParse({ channelId: UUID, kind: "inbound", summary: "a".repeat(201) }).success
    ).toBe(false);
  });

  it("messageSeq: a real positive integer — NOT coerced (L-1)", () => {
    const parsed = ConsentCreateSchema.parse({ channelId: UUID, kind: "inbound", messageSeq: 42 });
    expect(parsed.messageSeq).toBe(42);
    // This is a JSON body, not a query string. `z.coerce.number()` would turn
    // every one of these into a valid-looking seq (null/""/[] -> 0, true -> 1)
    // and a de-dupe key must never be manufactured out of junk.
    for (const junk of [null, "", [], true, "42", 0, -1, 1.5]) {
      expect(
        ConsentCreateSchema.safeParse({ channelId: UUID, kind: "inbound", messageSeq: junk }).success,
        `messageSeq ${JSON.stringify(junk)} must be rejected`
      ).toBe(false);
    }
  });

  it("discriminated union: proposedReply is outbound-only (L-3)", () => {
    const outbound = ConsentCreateSchema.parse({
      channelId: UUID,
      kind: "outbound",
      messageSeq: 7,
      proposedReply: "here you go",
    });
    expect(outbound.kind === "outbound" && outbound.proposedReply).toBe("here you go");
    // An inbound row is a request to RUN, not a drafted reply: the field is
    // dropped rather than carried into proposed_reply.
    const inbound = ConsentCreateSchema.parse({
      channelId: UUID,
      kind: "inbound",
      messageSeq: 7,
      proposedReply: "pre-seeded",
    });
    expect("proposedReply" in inbound).toBe(false);
  });

  it("messageSeq is accepted on BOTH kinds (it is the de-dupe key)", () => {
    expect(
      ConsentCreateSchema.parse({ channelId: UUID, kind: "outbound", messageSeq: 9 }).messageSeq
    ).toBe(9);
  });
});

describe("ConsentDecisionSchema", () => {
  it("decision: allow|deny only", () => {
    expect(ConsentDecisionSchema.safeParse({ decision: "allow" }).success).toBe(true);
    expect(ConsentDecisionSchema.safeParse({ decision: "deny" }).success).toBe(true);
    expect(ConsentDecisionSchema.safeParse({ decision: "maybe" }).success).toBe(false);
    expect(ConsentDecisionSchema.safeParse({}).success).toBe(false);
  });

  it("decidedBy: web|desktop, defaults web; 'trust' is server-only (M-6)", () => {
    expect(ConsentDecisionSchema.parse({ decision: "allow" }).decidedBy).toBe("web");
    expect(
      ConsentDecisionSchema.parse({ decision: "allow", decidedBy: "desktop" }).decidedBy
    ).toBe("desktop");
    // A standing trust rule is not a surface a caller can claim to be.
    expect(
      ConsentDecisionSchema.safeParse({ decision: "allow", decidedBy: "trust" }).success
    ).toBe(false);
  });
});

describe("ConsentListQuerySchema", () => {
  it("channelId: optional uuid", () => {
    expect(ConsentListQuerySchema.safeParse({}).success).toBe(true);
    expect(ConsentListQuerySchema.safeParse({ channelId: UUID }).success).toBe(true);
    expect(ConsentListQuerySchema.safeParse({ channelId: "x" }).success).toBe(false);
  });

  it("status: pending|decided|all, defaults pending (M-4)", () => {
    expect(ConsentListQuerySchema.parse({}).status).toBe("pending");
    expect(ConsentListQuerySchema.parse({ status: "decided" }).status).toBe("decided");
    expect(ConsentListQuerySchema.parse({ status: "all" }).status).toBe("all");
    expect(ConsentListQuerySchema.safeParse({ status: "allowed" }).success).toBe(false);
  });
});

describe("TrustMutateSchema", () => {
  it("trustedUserId must be a uuid", () => {
    expect(TrustMutateSchema.safeParse({ trustedUserId: UUID }).success).toBe(true);
    expect(TrustMutateSchema.safeParse({ trustedUserId: "x" }).success).toBe(false);
    expect(TrustMutateSchema.safeParse({}).success).toBe(false);
  });
});

describe("PresenceHeartbeatSchema", () => {
  it("status: optional, closed enum matching the DB CHECK (L-7)", () => {
    expect(PresenceHeartbeatSchema.safeParse({}).success).toBe(true);
    expect(PresenceHeartbeatSchema.safeParse({ status: "listening" }).success).toBe(true);
    expect(PresenceHeartbeatSchema.safeParse({ status: "offline" }).success).toBe(true);
    expect(PresenceHeartbeatSchema.safeParse({ status: "" }).success).toBe(false);
    // No longer free text: an arbitrary caller-controlled label can't be
    // parked in a column a later UI renders.
    expect(PresenceHeartbeatSchema.safeParse({ status: "whatever" }).success).toBe(false);
    expect(PresenceHeartbeatSchema.safeParse({ status: "a".repeat(41) }).success).toBe(false);
  });
});
