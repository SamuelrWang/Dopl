/**
 * INVARIANT SUITE — the read-session-state WRITE body (F-147).
 *
 * WHY EVERY BOUND HERE IS CHECKED AGAINST THE MIGRATION. `channel_sessions`
 * carries CHECK constraints on `name`, `state`, `channel_name` and
 * `thread_title` (F-145 added the last two), and the write runs on the
 * RLS-bypassing admin client. So a value this schema lets through and the
 * database refuses is not a validation gap, it is a 500 with a constraint name
 * in it — and a value BOTH let through is what ends up spliced into
 * `dopl_channel(op="read_sessions")`'s server narration on someone's screen.
 * The two have to agree, and this file is where that agreement is written down.
 *
 * The lengths are deliberately NOT stricter than what the values MIRROR:
 * `channels.name` is 1..120 and `channel_tasks.title` is 1..200, so a
 * legitimate name or title can never be refused on its way into this
 * projection.
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
    // `^[a-z][a-z0-9-]{1,30}$` — character for character the column's CHECK.
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
    // Rollback §3.3: the pill has no such state to report, so nothing may store
    // one — the render's closed-set test would answer "(unrecognized state)".
    for (const bad of ["thinking", "listening", "WORKING", ""]) {
      expect(parse([entry({ state: bad })]).success).toBe(false);
    }
  });

  it("`sessionKey` is a uuid pair and carries no filter-hostile character", () => {
    expect(parse([entry({ sessionKey: `${CHAN}:` })]).success).toBe(true);
    // The reconcile deletes BY KEY, so a quote or a comma in one would be an
    // escaping question every time somebody touches the repository.
    for (const bad of [`${CHAN}:${TASK}","other`, `${CHAN}:a b`, "nocolon", `${CHAN}:${TASK}:extra`]) {
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

describe("SessionStateReportSchema — the bounds on the report itself", () => {
  it("refuses DUPLICATE keys rather than deduping them", () => {
    // Two entries for one key hit ON CONFLICT twice in one statement (Postgres
    // 21000, read by the caller as an opaque 500) — and there is no honest way
    // to pick which of two contradictory states for one session is true.
    const dup = entry();
    expect(parse([dup, { ...dup, state: "idle" }]).success).toBe(false);
    expect(parse([dup, entry({ sessionKey: `${CHAN}:` })]).success).toBe(true);
  });

  it("caps the report above any real machine and below a bulk write", () => {
    // The desktop can hold MAX_SESSION_WINDOWS (6) live plus MAX_ENDED (12).
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        entry({ sessionKey: `${CHAN}:${String(i).padStart(8, "0")}` })
      );
    expect(parse(many(32)).success).toBe(true);
    expect(parse(many(33)).success).toBe(false);
  });
});
