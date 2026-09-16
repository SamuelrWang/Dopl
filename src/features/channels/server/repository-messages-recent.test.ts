/**
 * THE TWO BOUNDED "WHAT HAPPENED RECENTLY" READS' **QUERY SHAPE** — Supabase mocked with a
 * chainable builder recording every call, so these assert the filters that actually reach
 * PostgREST rather than what the docblocks claim.
 *
 * ⚠ **THE SUITE EXISTS BECAUSE OF F-704 (2026-09-15), AND THE ABSENCE IT PINS IS THE POINT.**
 * `listRecentRoomTagsBy` feeds RR3 arm 3 — "which agents has this PERSON addressed" — and for
 * eleven days it filtered `author_user_id` alone. An agent posts under its OPERATOR'S
 * `author_user_id` (`service-writes.ts` writes `author_user_id: ctx.userId` and
 * `author_kind: authorKind` in ONE insert for people and agents alike), so the read handed the
 * rule rows the author's own agents wrote and an orchestrator tagging a worker re-pointed its
 * operator's default responder — the reported bug, four rounds running.
 *
 * ⚠ **THE PROJECTION IS PINNED AS WELL AS THE FILTER, AND THAT IS NOT BELT-AND-BRACES.**
 * `RecentAuthorTagRow` is a `Pick<>` over the selected columns, so while `author_kind` was
 * unselected the type FORBADE the field and **no fixture in the tree could describe an
 * agent-authored history row.** That is the structural reason a regression test written for each
 * of the three prior fixes was blind to this one. A projection that drops the column again makes
 * the bug inexpressible again, whatever the rule says.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  listRecentRoomAgentPosts,
  listRecentRoomTagsBy,
} from "./repository-messages-recent";

const CHANNEL = "chan-1";
const ME = "user-1";

type Call = { op: string; args: unknown[] };

/** Chainable, thenable Supabase-builder stub — mirrors `repository-messages.test.ts`'s, plus
 *  `is`, which both of these reads use for the `thread IS NULL` expression. */
function makeAdmin(rows: unknown[] = []) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  const rec = (op: string, args: unknown[]) => {
    calls.push({ op, args });
    return builder;
  };
  Object.assign(builder, {
    from: (t: string) => rec("from", [t]),
    select: (c: string) => rec("select", [c]),
    eq: (c: string, v: unknown) => rec("eq", [c, v]),
    neq: (c: string, v: unknown) => rec("neq", [c, v]),
    is: (c: string, v: unknown) => rec("is", [c, v]),
    gt: (c: string, v: unknown) => rec("gt", [c, v]),
    order: (c: string, o: unknown) => rec("order", [c, o]),
    limit: (n: number) => rec("limit", [n]),
    then: (resolve: (r: { data: unknown[]; error: null }) => void) =>
      resolve({ data: rows, error: null }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return calls;
}

/** Every `eq` filter the query applied, as `column -> value`. */
function eqFilters(calls: Call[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of calls) {
    if (c.op === "eq") out[String(c.args[0])] = c.args[1];
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listRecentRoomTagsBy — RR3 arm 3's feed", () => {
  /**
   * 🔒 **THE AUTHOR'S OWN AGENTS ARE EXCLUDED IN SQL** (F-704). Both conditions, not a choice
   * between them: scope to ONE PERSON *and* to rows that person wrote themselves.
   *
   * ⚠ **WHY THE `.neq` IS NEEDED WHEN THE RULE ALREADY SKIPS THESE ROWS.** The rule
   * (`lib/agent-post-stamp.ts › recentAgentsAddressedBy`) is the enforcement and the single
   * source of truth both trees drive — but this read is capped at 50 rows, so WITHOUT the `.neq`
   * a busy agent-to-agent room spends its entire budget on rows the rule discards and the
   * look-back silently shortens toward nothing. The SQL bound and the rule have to agree about
   * what is even a candidate. Symptom if this regresses: not an error, just a wrong answer.
   */
  it("🔒 filters to this author AND excludes agent-authored rows", async () => {
    const calls = makeAdmin();

    await listRecentRoomTagsBy(CHANNEL, ME);

    expect(eqFilters(calls)).toEqual({
      channel_id: CHANNEL,
      author_user_id: ME,
    });
    expect(calls.find((c) => c.op === "neq")?.args).toEqual([
      "author_kind",
      "agent",
    ]);
  });

  /**
   * 🔒 **`author_kind` IS IN THE PROJECTION, AND THE TYPE DEPENDS ON IT.** See the header: while
   * this column was unselected, `RecentAuthorTagRow`'s `Pick<>` made an agent-authored fixture
   * row unrepresentable, which is how three rounds of regression tests came to be blind. The
   * predicate is what enforces the rule; this is what lets a test SAY the rule.
   */
  it("🔒 projects `author_kind` so the rule and its fixtures can read it", async () => {
    const calls = makeAdmin();

    await listRecentRoomTagsBy(CHANNEL, ME);

    const projection = String(calls.find((c) => c.op === "select")?.args[0]);
    for (const col of [
      "seq",
      "created_at",
      "author_user_id",
      "author_kind",
      "recipient_agent_ids",
      "metadata",
    ]) {
      expect(projection).toContain(col);
    }
  });

  /**
   * 🔒 **MAIN-ROOM ROWS ONLY, AND NO TIME BOUND** (2026-09-06, Samuel: author stickiness has no
   * clock). A threaded post is RR1's business, and a `gt("created_at", …)` here is the READ half
   * of the expired-stickiness bug — the rule above it is unbounded, so a read that dropped rows
   * older than fifteen minutes made the rule expire anyway, invisibly and from underneath.
   */
  it("🔒 scopes to the main room and applies NO time bound", async () => {
    const calls = makeAdmin();

    await listRecentRoomTagsBy(CHANNEL, ME);

    expect(calls.find((c) => c.op === "is")?.args).toEqual([
      "metadata->>taskId",
      null,
    ]);
    expect(calls.some((c) => c.op === "gt")).toBe(false);
    expect(calls.find((c) => c.op === "order")?.args).toEqual([
      "seq",
      { ascending: false },
    ]);
    expect(calls.find((c) => c.op === "limit")?.args).toEqual([50]);
  });
});

describe("listRecentRoomAgentPosts — the freshness read the arm no longer uses", () => {
  /**
   * ⚠ **STILL FILTERS TO AGENT AUTHORS, AND STILL TAKES A WINDOW — BOTH CORRECT HERE.** This read
   * answers "who spoke in this room lately", which is a FRESHNESS question and goes stale; the
   * tags read above answers "who did this person address", which is a habit and does not. Pinned
   * so the two are not "tidied" into one shape: they differ on purpose, and `.eq("author_kind",
   * "agent")` on THIS read is the mirror image of the `.neq` on that one.
   */
  it("keeps its agent-author filter and its `since` bound", async () => {
    const calls = makeAdmin();

    await listRecentRoomAgentPosts(CHANNEL, "2026-09-15T00:00:00.000Z");

    expect(eqFilters(calls)).toEqual({
      channel_id: CHANNEL,
      author_kind: "agent",
    });
    expect(calls.find((c) => c.op === "gt")?.args).toEqual([
      "created_at",
      "2026-09-15T00:00:00.000Z",
    ]);
    expect(calls.some((c) => c.op === "neq")).toBe(false);
  });
});
