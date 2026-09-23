/**
 * The session-state write body (F-147), bound for bound against `channel_sessions`' CHECKs: the write
 * runs on the admin client, so a value zod admits and the column refuses is a 500. Lengths mirror
 * `channels.name` (120) and `channel_tasks.title` (200), never stricter.
 */

import { describe, it, expect } from "vitest";
import { SessionStateReportSchema } from "./schema-sessions";

const CHAN = "550e8400-e29b-41d4-a716-446655440000";
const TASK = "44444444-e29b-41d4-a716-446655440000";

const entry = (over: Record<string, unknown> = {}) => ({
  sessionKey: `${CHAN}:${TASK}`,
  channelId: CHAN,
  threadId: TASK,
  name: "flint",
  state: "working",
  channelName: "General",
  threadTitle: "Deploy check",
  ...over,
});

const parse = (sessions: unknown[]) =>
  SessionStateReportSchema.safeParse({ sessions });

describe("SessionStateReportSchema — the shape", () => {
  it("accepts the desktop's report", () => {
    expect(parse([entry()]).success).toBe(true);
  });

  it("accepts an EMPTY set — that is how the last row is deleted", () => {
    expect(parse([]).success).toBe(true);
  });

  it("accepts a thread-less responder: no thread id, no title", () => {
    expect(
      parse([entry({ sessionKey: `${CHAN}:`, threadId: null, threadTitle: null })])
        .success
    ).toBe(true);
    expect(
      parse([{ sessionKey: `${CHAN}:`, channelId: CHAN, name: "onyx", state: "idle" }])
        .success
    ).toBe(true);
  });

  it("refuses a body that is not a session list at all", () => {
    expect(SessionStateReportSchema.safeParse({}).success).toBe(false);
    expect(SessionStateReportSchema.safeParse({ sessions: {} }).success).toBe(false);
  });
});

describe("SessionStateReportSchema — the migration's CHECKs", () => {
  it("`name` matches the generator's charset and nothing else", () => {
    // `^[a-z][a-z0-9-]{1,30}$`, character for character the column's CHECK.
    for (const good of ["flint", "onyx-2", "malachite-11"]) {
      expect(parse([entry({ name: good })]).success).toBe(true);
    }
    for (const bad of ["Flint", "2flint", "f", "flint!", "flint agent", "a".repeat(32), ""]) {
      expect(parse([entry({ name: bad })]).success).toBe(false);
    }
  });

  it("`state` is the closed set, and there is no `thinking`", () => {
    for (const good of ["working", "idle", "ended"]) {
      expect(parse([entry({ state: good })]).success).toBe(true);
    }
    // The pill has no such state; the render's closed-set test would answer "(unrecognized state)".
    for (const bad of ["thinking", "listening", "WORKING", ""]) {
      expect(parse([entry({ state: bad })]).success).toBe(false);
    }
  });

  it("`sessionKey` is a uuid pair PLUS an agent segment, and carries no filter-hostile character", () => {
    // `<channel>:<thread>:<agentInstanceId>`: one operator may run several agents on one thread.
    expect(parse([entry({ sessionKey: `${CHAN}:${TASK}:a1b2c3d4` })]).success).toBe(true);
    // `<channel>::<agent>` is a channel-level agent.
    expect(parse([entry({ sessionKey: `${CHAN}::a1b2c3d4` })]).success).toBe(true);
    // The two-segment form is an older desktop's (INVARIANTS §13); refusing it blanks its rows.
    expect(parse([entry({ sessionKey: `${CHAN}:` })]).success).toBe(true);
    expect(parse([entry({ sessionKey: `${CHAN}:${TASK}` })]).success).toBe(true);
    // The reconcile deletes by key, so a key must need no escaping.
    for (const bad of [
      `${CHAN}:${TASK}","other`,
      `${CHAN}:a b`,
      "nocolon",
      `${CHAN}:${TASK}:a1b2c3d4:more`, // a FOURTH segment is not a shape the desktop mints
      `${CHAN}:${TASK}:agent id`,
      `${CHAN}:${TASK}:"x"`,
    ]) {
      expect(parse([entry({ sessionKey: bad })]).success).toBe(false);
    }
  });

  it("`channelId` / `threadId` are uuids — the columns are FKs", () => {
    expect(parse([entry({ channelId: "not-a-uuid" })]).success).toBe(false);
    expect(parse([entry({ threadId: "not-a-uuid" })]).success).toBe(false);
  });
});

describe("SessionStateReportSchema — the counterparty-influenced text", () => {
  it("refuses the characters that forge a line in server narration", () => {
    for (const bad of ["General\nAdmin", "Gen\u0000eral", "Gen\u200Beral", "a\u2028b", "tab\there"]) {
      expect(parse([entry({ channelName: bad })]).success).toBe(false);
      expect(parse([entry({ threadTitle: bad })]).success).toBe(false);
    }
  });

  it("allows every ordinary name — this is a structure rule, not a script rule", () => {
    for (const good of ["Müller's Team", "研究ノート", "Café — Zürich", "🚀 launch"]) {
      expect(parse([entry({ channelName: good, threadTitle: good })]).success).toBe(true);
    }
  });

  it("bounds match what the values MIRROR: 120 and 200", () => {
    expect(parse([entry({ channelName: "c".repeat(120) })]).success).toBe(true);
    expect(parse([entry({ channelName: "c".repeat(121) })]).success).toBe(false);
    expect(parse([entry({ threadTitle: "t".repeat(200) })]).success).toBe(true);
    expect(parse([entry({ threadTitle: "t".repeat(201) })]).success).toBe(false);
  });

  it("trims, because the column requires `col = btrim(col)`", () => {
    const parsed = parse([entry({ channelName: "  General  " })]);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.sessions[0].channelName).toBe("General");
    // …and a whitespace-only value is refused rather than silently becoming "".
    expect(parse([entry({ channelName: "   " })]).success).toBe(false);
  });
});

/** `identityName` lands before any desktop sends it: zod validates the array, so one refused row 400s a
 *  newer desktop's whole push, unretryably (INVARIANTS §11, §13). 120 mirrors `agent_identities`' CHECK. */
describe("SessionStateReportSchema — the agent identity", () => {
  it("accepts an identity name, a null, and an ABSENT key", () => {
    expect(parse([entry({ identityName: "Code Auditor" })]).success).toBe(true);
    // An explicit null — a session launched from no identity, said out loud.
    expect(parse([entry({ identityName: null })]).success).toBe(true);
    // The rollout case: an older desktop sends no such key.
    expect(parse([entry()]).success).toBe(true);
  });

  it("bounds it at the 120 the identity column carries — no tighter, no looser", () => {
    expect(parse([entry({ identityName: "t".repeat(120) })]).success).toBe(true);
    expect(parse([entry({ identityName: "t".repeat(121) })]).success).toBe(false);
  });

  it("refuses the characters that forge a line in the operator's OWN result", () => {
    // Operator-only is not trusted: it is spliced into a server-written line.
    for (const bad of [
      "Auditor\n## Your agents — 0",
      "Aud\u0000itor",
      "Aud\u200Bitor",
      "Aud\u2028itor",
      "tab\there",
    ]) {
      expect(parse([entry({ identityName: bad })]).success).toBe(false);
    }
  });

  it("allows every ordinary name — a structure rule, not a script rule", () => {
    for (const good of ["Müller's Reviewer", "研究エージェント", "Café — Zürich", "🚀 Launcher"]) {
      expect(parse([entry({ identityName: good })]).success).toBe(true);
    }
  });

  it("trims, because the column requires `identity_name = btrim(identity_name)`", () => {
    const parsed = parse([entry({ identityName: "  Code Auditor  " })]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.sessions[0].identityName).toBe("Code Auditor");
    }
    // …and a whitespace-only value is refused rather than silently becoming "".
    expect(parse([entry({ identityName: "   " })]).success).toBe(false);
    // '' likewise: the column CHECK requires >= 1 char when not null.
    expect(parse([entry({ identityName: "" })]).success).toBe(false);
  });
});

/** The health seven: absent stays absent (a `.default(0)` would store an unmeasured "nothing refused"),
 *  and absent never 400s an older desktop's whole push (INVARIANTS §11, §13). */
describe("SessionStateReportSchema — the session health half", () => {
  const health = {
    turns: 12,
    tokensDelta: 8_700,
    stale: true,
    deniedCalls: 4,
    lastDeniedTool: "Bash",
    lastWakeSeq: 412,
    lastWakeAt: "2026-09-01T09:59:00.000Z",
  };

  it("accepts the whole set, an all-null set, and an ABSENT set alike", () => {
    expect(parse([entry(health)]).success).toBe(true);
    // Explicit nulls: this build HAS the fields and measured none of them.
    expect(
      parse([entry(Object.fromEntries(Object.keys(health).map((k) => [k, null])))])
        .success
    ).toBe(true);
    // The rollout case: an older desktop sends no such key.
    expect(parse([entry()]).success).toBe(true);
  });

  it("leaves an absent field ABSENT — no key is defaulted into existence", () => {
    const parsed = parse([entry()]);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const row = parsed.data.sessions[0] as Record<string, unknown>;
    for (const key of Object.keys(health)) {
      // `in`, not truthiness: a `.default()` would materialise the key as 0 / false.
      expect(key in row, `${key} was defaulted into the parsed row`).toBe(false);
    }
  });

  it("refuses a negative or fractional count — a reporting bug, named at the field", () => {
    for (const bad of [
      { turns: -1 },
      { turns: 1.5 },
      { tokensDelta: -1 },
      { deniedCalls: -1 },
      { lastWakeSeq: -1 },
    ]) {
      expect(parse([entry(bad)]).success).toBe(false);
    }
    // 0 is a measurement ("counted, none"), distinct from `null`.
    expect(parse([entry({ turns: 0, deniedCalls: 0, tokensDelta: 0 })]).success).toBe(true);
  });

  it("`stale` is a real boolean — never a coercion", () => {
    expect(parse([entry({ stale: false })]).success).toBe(true);
    // `z.coerce.boolean()` would read the string "false" as true.
    expect(parse([entry({ stale: "false" })]).success).toBe(false);
    expect(parse([entry({ stale: 1 })]).success).toBe(false);
  });

  it("`lastDeniedTool` carries `toolLabel`'s bound and charset, character for character", () => {
    expect(parse([entry({ lastDeniedTool: "t".repeat(80) })]).success).toBe(true);
    expect(parse([entry({ lastDeniedTool: "t".repeat(81) })]).success).toBe(false);
    // It is spliced into a server-written line.
    expect(parse([entry({ lastDeniedTool: "Bash\n## Your agents — 0" })]).success)
      .toBe(false);
  });

  it("`lastWakeAt` must be an offset datetime — the column is TIMESTAMPTZ", () => {
    expect(parse([entry({ lastWakeAt: "2026-09-01T09:59:00Z" })]).success).toBe(true);
    // An unparseable string would reach Postgres as a cast error (a 500).
    expect(parse([entry({ lastWakeAt: "yesterday" })]).success).toBe(false);
    expect(parse([entry({ lastWakeAt: 1_756_000_000_000 })]).success).toBe(false);
  });
});

describe("SessionStateReportSchema — the bounds on the report itself", () => {
  it("refuses DUPLICATE keys rather than deduping them", () => {
    // Two entries for one key hit ON CONFLICT twice in one statement (Postgres 21000).
    const dup = entry();
    expect(parse([dup, { ...dup, state: "idle" }]).success).toBe(false);
    expect(parse([dup, entry({ sessionKey: `${CHAN}:` })]).success).toBe(true);
  });

  it("caps the report above any real machine and below a bulk write", () => {
    // `SESSION_REPORT_MAX` sits above `main/session-windowless.js › MAX_CONCURRENT_SESSIONS`.
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        entry({ sessionKey: `${CHAN}:${String(i).padStart(8, "0")}` })
      );
    expect(parse(many(32)).success).toBe(true);
    expect(parse(many(33)).success).toBe(false);
  });
});

describe("the two INT4 health counts are bounded at the COLUMN's ceiling", () => {
  it("refuses a turns / deniedCalls past 2147483647, and takes the ceiling itself", () => {
    // Without `.max`, a value past INT4 22003s at rest and the push blanks that machine's session set.
    for (const field of ["turns", "deniedCalls"]) {
      expect(
        parse([entry({ [field]: 2_147_483_647 })]).success,
        `${field} at the ceiling`
      ).toBe(true);
      expect(
        parse([entry({ [field]: 2_147_483_648 })]).success,
        `${field} past the ceiling`
      ).toBe(false);
    }
  });

  it("leaves the two BIGINT counts uncapped — a bound tighter than the column is the other footgun", () => {
    for (const field of ["tokensDelta", "lastWakeSeq"]) {
      expect(parse([entry({ [field]: 9_000_000_000 })]).success, field).toBe(
        true
      );
    }
  });
});
