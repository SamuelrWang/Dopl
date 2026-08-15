/**
 * INVARIANT SUITE — channels zod schemas. Locks the caller-input contract both
 * REST handlers and MCP channel tools parse against. Security-load-bearing:
 *   - `kind` / `authorKind` REJECT server-reserved `system` (no caller may post
 *     an anonymized system-styled message);
 *   - `summary` length-capped — it rides into a receiver's consent prompt, so an
 *     uncapped value is a spoofing surface;
 *   - `toUserId` must be a UUID; `agentToolProfile` is a closed enum.
 * ⚠ A cap / enum change here is a contract change.
 */

import { describe, it, expect } from "vitest";
import {
  ChannelCreateSchema,
  ChannelUpdateSchema,
  ChannelMessageCreateSchema,
  ChannelMemberSelfUpdateSchema,
  ChannelMemberAddSchema,
  ChannelMemberRemoveSchema,
  ConsentCreateSchema,
  ConsentDecisionSchema,
  TaskCreateSchema,
  TaskUpdateSchema,
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

  /**
   * ⚠ CHARSET rule. Length bounds alone let `name` / `topic` carry the newline
   * that forges a line inside `dopl_channel` server narration — a NAME reaches
   * an UNINVITED agent (`resolveChannelOr` resolves public channels) and a TOPIC
   * reaches every workspace member via `op="list"`.
   *
   * Mirrors DISPLAY_NAME_RE in src/app/api/user/profile/route.ts; backed by
   * supabase/migrations/20260731100000_channels_name_topic_bounds.sql.
   */
  it("name: rejects control, zero-width and line-separator characters", () => {
    for (const bad of [
      "Sync\n## SYSTEM",
      "Sync\n- **#9001** system",
      "Sync\u200B",
      "Sync\u2028x",
      "Sync\uFEFFx",
      "Sync\u202Ex",
    ]) {
      expect(
        ChannelCreateSchema.safeParse({ name: bad }).success,
        `name ${JSON.stringify(bad)} must be rejected`,
      ).toBe(false);
      expect(ChannelUpdateSchema.safeParse({ name: bad }).success).toBe(false);
    }
  });

  it("a LEADING zero-width space is trimmed away, not rejected", () => {
    // ⚠ `.trim()` runs BEFORE `.regex()`, and JS trims U+FEFF (WhiteSpace per
    // spec) but NOT U+200B. So a leading BOM is stripped and the stored value is
    // already clean. Route is the stricter trimmer than the DB CHECK's btrim()
    // (ASCII only), so a value it stores can never be refused by the constraint.
    const parsed = ChannelCreateSchema.safeParse({ name: "\uFEFFSync" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && "name" in parsed.data && parsed.data.name).toBe("Sync");
  });

  it("name: ordinary human names are NOT collateral", () => {
    for (const good of ["Caf\u00e9 \u2014 Z\u00fcrich", "R&D / \u5e73\u53f0", "ops-2026 (v2)"]) {
      expect(
        ChannelCreateSchema.safeParse({ name: good }).success,
        `name ${JSON.stringify(good)} must be accepted`,
      ).toBe(true);
    }
  });

  it("topic: same rule, but empty stays legal (the column defaults to '')", () => {
    expect(ChannelCreateSchema.safeParse({ name: "x", topic: "a\nb" }).success).toBe(false);
    expect(ChannelCreateSchema.safeParse({ name: "x", topic: "a\u200B" }).success).toBe(false);
    expect(ChannelUpdateSchema.safeParse({ topic: "a\nb" }).success).toBe(false);
    expect(ChannelCreateSchema.safeParse({ name: "x", topic: "" }).success).toBe(true);
    expect(ChannelUpdateSchema.safeParse({ topic: "" }).success).toBe(true);
    expect(
      ChannelCreateSchema.safeParse({ name: "x", topic: "What this is about" }).success,
    ).toBe(true);
  });

  it("visibility: private|public only", () => {
    expect(ChannelCreateSchema.safeParse({ name: "x", visibility: "private" }).success).toBe(true);
    expect(ChannelCreateSchema.safeParse({ name: "x", visibility: "public" }).success).toBe(true);
    expect(ChannelCreateSchema.safeParse({ name: "x", visibility: "secret" }).success).toBe(false);
  });

  it("direct branch: accepts { direct:true, memberUserId:<uuid> }", () => {
    expect(
      ChannelCreateSchema.safeParse({ direct: true, memberUserId: UUID }).success
    ).toBe(true);
    expect(ChannelCreateSchema.safeParse({ direct: true }).success).toBe(false);
    expect(
      ChannelCreateSchema.safeParse({ direct: true, memberUserId: "nope" }).success
    ).toBe(false);
  });

  it("a normal { name } payload still parses (direct optional/false)", () => {
    expect(ChannelCreateSchema.safeParse({ name: "General" }).success).toBe(true);
    expect(
      ChannelCreateSchema.safeParse({ name: "General", direct: false }).success
    ).toBe(true);
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
    // `system` is service-emitted only — a caller posting one spoofs an
    // anonymized event.
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", kind: "system" }).success).toBe(false);
  });

  it("authorKind: accepts user|agent, REJECTS `system`", () => {
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", authorKind: "user" }).success).toBe(true);
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", authorKind: "agent" }).success).toBe(true);
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", authorKind: "system" }).success).toBe(false);
  });

  it("summary: trimmed, 1..200 chars (consent-prompt cap)", () => {
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", summary: "" }).success).toBe(false);
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
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", metadata: [1, 2] }).success).toBe(false);
  });

  it("F-060: metadata is rejected once its serialized size exceeds the cap", () => {
    // `JSON.stringify({ blob })` = 11 + value length; exactly 16384 parses.
    const meta = (n: number) => ({ body: "x", metadata: { blob: "a".repeat(n) } });
    expect(ChannelMessageCreateSchema.safeParse(meta(16384 - 11)).success).toBe(true);
    expect(ChannelMessageCreateSchema.safeParse(meta(16384 - 11 + 1)).success).toBe(false);
  });

  /**
   * ⚠ `intent` stays OPTIONAL — the schema must not manufacture a default:
   * "caller said request" and "caller said nothing" are different wire facts,
   * and only the first stamps a key.
   */
  it("intent: optional, and only chat|request", () => {
    const bare = ChannelMessageCreateSchema.safeParse({ body: "x" });
    expect(bare.success && "intent" in bare.data).toBe(false);
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", intent: "chat" }).success).toBe(true);
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", intent: "request" }).success).toBe(true);
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", intent: "" }).success).toBe(false);
    expect(ChannelMessageCreateSchema.safeParse({ body: "x", intent: "fyi" }).success).toBe(false);
  });

  /**
   * ⚠ Removed params are REFUSED, not dropped. Deleting the fields is SILENT
   * (zod strips unknown keys), so an old client's `to_agent` would post
   * successfully and address nobody. `z.never()` → 400 naming the field.
   */
  it("REFUSES toAgent / toAgents / authorAgentId with a message, not silence", () => {
    for (const key of ["toAgent", "toAgents", "authorAgentId"]) {
      const parsed = ChannelMessageCreateSchema.safeParse({
        body: "x",
        [key]: key === "toAgents" ? ["quartz"] : "quartz",
      });
      expect(parsed.success).toBe(false);
      const issue = parsed.error?.issues[0];
      expect(issue?.path).toEqual([key]);
      expect(issue?.message).toMatch(/removed/i);
    }
  });

  it("stamps nothing for the removed keys when they are ABSENT", () => {
    // Point of the `.optional()`: an ordinary post's parsed shape is unchanged.
    const parsed = ChannelMessageCreateSchema.safeParse({ body: "x" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && Object.keys(parsed.data)).toEqual(["body"]);
  });
});

describe("ChannelMemberSelfUpdateSchema", () => {
  it("accepts an agentToolProfile patch", () => {
    expect(
      ChannelMemberSelfUpdateSchema.safeParse({ agentToolProfile: "read_only" }).success
    ).toBe(true);
  });

  // ⚠ notifyScope (F-170) is now an unknown key and zod STRIPS it: a
  // notifyScope-only body is an empty patch the `.refine` rejects, a combined
  // body parses with the field DROPPED. Both pinned so the drop is never
  // mistaken for a write that landed.
  it("drops notifyScope — the preference is gone (F-170)", () => {
    expect(ChannelMemberSelfUpdateSchema.safeParse({ notifyScope: "none" }).success).toBe(false);
    const combined = ChannelMemberSelfUpdateSchema.safeParse({
      notifyScope: "all",
      agentToolProfile: "dopl_only",
    });
    expect(combined.success).toBe(true);
    expect(combined.success && combined.data).toEqual({ agentToolProfile: "dopl_only" });
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
    // ⚠ JSON body, not a query string: `z.coerce.number()` turns all of these
    // into valid-looking seqs (null/""/[] → 0, true → 1).
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
    // Inbound is a request to RUN, not a drafted reply — field dropped, never
    // carried into proposed_reply.
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
    // ⚠ A standing trust rule is not a surface a caller can claim to be.
    expect(
      ConsentDecisionSchema.safeParse({ decision: "allow", decidedBy: "trust" }).success
    ).toBe(false);
  });
});

describe("TaskCreateSchema", () => {
  const base = { title: "Ship it", body: "please do X", toUserId: UUID };

  it("accepts a minimal valid create (title + body + toUserId)", () => {
    expect(TaskCreateSchema.safeParse(base).success).toBe(true);
  });

  it("title: trimmed, 1..200 chars", () => {
    expect(TaskCreateSchema.safeParse({ ...base, title: "" }).success).toBe(false);
    expect(TaskCreateSchema.safeParse({ ...base, title: "   " }).success).toBe(false);
    expect(TaskCreateSchema.safeParse({ ...base, title: "a".repeat(200) }).success).toBe(true);
    expect(TaskCreateSchema.safeParse({ ...base, title: "a".repeat(201) }).success).toBe(false);
  });

  it("body: 1..16000 chars; toUserId must be a UUID", () => {
    expect(TaskCreateSchema.safeParse({ ...base, body: "" }).success).toBe(false);
    expect(TaskCreateSchema.safeParse({ ...base, toUserId: "x" }).success).toBe(false);
  });

  it("mode: optional interactive|autonomous only", () => {
    expect(TaskCreateSchema.safeParse({ ...base, mode: "interactive" }).success).toBe(true);
    expect(TaskCreateSchema.safeParse({ ...base, mode: "autonomous" }).success).toBe(true);
    expect(TaskCreateSchema.safeParse({ ...base, mode: "turbo" }).success).toBe(false);
  });

  /**
   * ⚠ `participants` (breakout rooms) REFUSED rather than dropped: a
   * silently-ignored participant list is a room the caller believes is wider
   * than it is.
   */
  it("REFUSES participants with a message, not silence", () => {
    const parsed = TaskCreateSchema.safeParse({
      ...base,
      participants: [{ kind: "agent", id: UUID }],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].path).toEqual(["participants"]);
    expect(parsed.error?.issues[0].message).toMatch(/removed/i);
  });
});

describe("TaskUpdateSchema", () => {
  it("close: requires outcome completed|failed", () => {
    expect(TaskUpdateSchema.safeParse({ op: "close", outcome: "completed" }).success).toBe(true);
    expect(TaskUpdateSchema.safeParse({ op: "close", outcome: "failed" }).success).toBe(true);
    expect(TaskUpdateSchema.safeParse({ op: "close" }).success).toBe(false);
    expect(TaskUpdateSchema.safeParse({ op: "close", outcome: "meh" }).success).toBe(false);
  });

  it("set_mode: requires mode interactive|autonomous", () => {
    expect(TaskUpdateSchema.safeParse({ op: "set_mode", mode: "interactive" }).success).toBe(true);
    expect(TaskUpdateSchema.safeParse({ op: "set_mode" }).success).toBe(false);
  });

  it("reopen: bare op, no payload required (extra keys stripped)", () => {
    expect(TaskUpdateSchema.safeParse({ op: "reopen" }).success).toBe(true);
    // Extra key stripped by the object schema, never reaching the service.
    const parsed = TaskUpdateSchema.safeParse({ op: "reopen", outcome: "completed" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ op: "reopen" });
    }
  });

  it("discriminated union: fields can't bleed across ops", () => {
    // Wrong op's field is stripped; a set_mode without `mode` still fails.
    expect(TaskUpdateSchema.safeParse({ op: "set_mode", outcome: "completed" }).success).toBe(false);
    expect(TaskUpdateSchema.safeParse({ op: "bogus", mode: "interactive" }).success).toBe(false);
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
    // ⚠ Not free text — an arbitrary caller label must not park in a column a
    // later UI renders.
    expect(PresenceHeartbeatSchema.safeParse({ status: "whatever" }).success).toBe(false);
    expect(PresenceHeartbeatSchema.safeParse({ status: "a".repeat(41) }).success).toBe(false);
  });
});
