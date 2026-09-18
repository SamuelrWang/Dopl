import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  presenceForWorkspace,
  presenceForWorkspaces,
  presenceForUser,
  upsertPresenceEverywhere,
} from "./repository-collab";
import { PRESENCE_ONLINE_WINDOW_MS } from "../constants";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **WHO IS ONLINE — THE SERVER'S ANSWER, WHICH IS NOW THE ONLY ANSWER** (2026-09-08, Samuel's
 * Slack-parity ruling).
 *
 * ⚠ **THE RULE IS `fresh AND status !== "away"`, AND THE SECOND HALF IS DELIBERATELY A DENY-LIST
 * RATHER THAN AN ALLOW-LIST.** Only a desktop on this build sends the posture; every older one
 * still sends `'listening'`. `status === "active"` would have read as "offline" for every
 * machine that had not updated yet — a deploy that takes an entire fleet dark, which is exactly
 * the class of failure Samuel asked to be rid of ("*we need to make sure the logic doesnt have
 * failure points*").
 *
 * ⚠ **AND IT IS THE SERVER'S BECAUSE THE CLIENT CANNOT SEE `status`.** `agent_presence.status`
 * is never on the wire; a client that re-derived `online` from `lastSeenAt` was structurally
 * unable to agree with this function. `channels/components/view-model.test.ts` holds the
 * other end of that.
 */

const WS = "ws-1";
const ME = "user-1";
const PEER = "user-2";
const NOW = Date.parse("2026-09-08T12:00:00Z");

const ago = (ms: number) => new Date(NOW - ms).toISOString();

type Row = { user_id?: string; last_seen_at?: string; status?: string | null };

function makeAdmin(
  rows: Row[] | Row | null,
  { error = null, rpc = null }: { error?: unknown; rpc?: unknown } = {}
) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const builder: Record<string, unknown> = {};
  const rec = (op: string, args: unknown[]) => {
    calls.push({ op, args });
    return builder;
  };
  const settle = (resolve: (r: unknown) => void) =>
    resolve({ data: error ? null : rows, error });
  Object.assign(builder, {
    from: (t: string) => rec("from", [t]),
    select: (c: string) => rec("select", [c]),
    eq: (c: string, v: unknown) => rec("eq", [c, v]),
    in: (c: string, v: unknown) => rec("in", [c, v]),
    limit: (n: number) => rec("limit", [n]),
    maybeSingle: () => ({ then: settle }),
    then: settle,
  });
  const client = {
    ...builder,
    rpc: (name: string, args: unknown) => {
      calls.push({ op: "rpc", args: [name, args] });
      return { then: (resolve: (r: unknown) => void) => resolve(rpc) };
    },
  };
  vi.mocked(supabaseAdmin).mockReturnValue(client as never);
  return calls;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("presenceForWorkspace — the online rule", () => {
  it("fresh + a posture word that is not `away` is ONLINE", async () => {
    makeAdmin([{ user_id: ME, last_seen_at: ago(1_000), status: "active" }]);
    expect((await presenceForWorkspace(WS)).get(ME)?.online).toBe(true);
  });

  it("⚠ FRESH BUT `away` IS OFFLINE — the posture beats the clock", async () => {
    // A suspended or locked machine posts `away` immediately, so its row is SECONDS old and
    // must still read offline. Freshness alone was the whole of the old rule.
    makeAdmin([{ user_id: ME, last_seen_at: ago(1_000), status: "away" }]);
    expect((await presenceForWorkspace(WS)).get(ME)?.online).toBe(false);
  });

  it("⚠ A LEGACY `listening` BEAT STAYS ONLINE — an older desktop is not offline", async () => {
    // This is the assertion that makes the deny-list a deny-list. `status === "active"` would
    // take every pre-posture machine dark on deploy day and pass every other case in this file.
    makeAdmin([{ user_id: ME, last_seen_at: ago(1_000), status: "listening" }]);
    expect((await presenceForWorkspace(WS)).get(ME)?.online).toBe(true);
  });

  it("a status this reader has never heard of reads as present-if-fresh", async () => {
    makeAdmin([{ user_id: ME, last_seen_at: ago(1_000), status: "brand-new-word" }]);
    expect((await presenceForWorkspace(WS)).get(ME)?.online).toBe(true);
  });

  it("stale is offline whatever the status says", async () => {
    makeAdmin([
      { user_id: ME, last_seen_at: ago(PRESENCE_ONLINE_WINDOW_MS + 1), status: "active" },
    ]);
    expect((await presenceForWorkspace(WS)).get(ME)?.online).toBe(false);
  });

  it("the boundary is exclusive — exactly one window old is offline", async () => {
    makeAdmin([
      { user_id: ME, last_seen_at: ago(PRESENCE_ONLINE_WINDOW_MS), status: "active" },
      { user_id: PEER, last_seen_at: ago(PRESENCE_ONLINE_WINDOW_MS - 1), status: "active" },
    ]);
    const map = await presenceForWorkspace(WS);
    expect(map.get(ME)?.online).toBe(false);
    expect(map.get(PEER)?.online).toBe(true);
  });

  it("an unparseable stamp reads OFFLINE, never throws", async () => {
    makeAdmin([{ user_id: ME, last_seen_at: "not a date", status: "active" }]);
    expect((await presenceForWorkspace(WS)).get(ME)?.online).toBe(false);
  });

  it("⚠ THE READ SELECTS `status` — without the column the rule cannot exist", async () => {
    const calls = makeAdmin([]);
    await presenceForWorkspace(WS);
    const select = calls.find((c) => c.op === "select");
    expect(String(select?.args[0])).toContain("status");
  });

  it("`lastSeenAt` still crosses the wire — the client's stale-cache fallback needs it", async () => {
    makeAdmin([{ user_id: ME, last_seen_at: ago(1_000), status: "active" }]);
    expect((await presenceForWorkspace(WS)).get(ME)?.lastSeenAt).toBe(ago(1_000));
  });
});

describe("presenceForUser — the SAME rule, not a second copy of it", () => {
  it("away is offline here too", async () => {
    // A second liveness rule would let the roster call a member offline while the session
    // surface told their orchestrator the machine was up (§11's own warning about the window).
    makeAdmin({ last_seen_at: ago(1_000), status: "away" });
    expect((await presenceForUser(ME, WS))?.online).toBe(false);
  });

  it("a legacy beat is online here too", async () => {
    makeAdmin({ last_seen_at: ago(1_000), status: "listening" });
    expect((await presenceForUser(ME, WS))?.online).toBe(true);
  });

  it("no row is null — 'unknown', which the caller renders as absence", async () => {
    makeAdmin(null);
    expect(await presenceForUser(ME, WS)).toBeNull();
  });
});

describe("upsertPresenceEverywhere — one statement, every container", () => {
  it("calls the RPC with the SERVER-RESOLVED subject and the posture", async () => {
    const calls = makeAdmin(null, {
      rpc: { data: [{ workspace_id: "ws-a" }, { workspace_id: "ws-b" }], error: null },
    });
    expect(await upsertPresenceEverywhere(ME, "active")).toEqual(["ws-a", "ws-b"]);
    expect(calls.find((c) => c.op === "rpc")?.args).toEqual([
      "presence_heartbeat_all",
      { p_user_id: ME, p_status: "active" },
    ]);
  });

  it("zero containers is an ANSWER, not a failure", async () => {
    makeAdmin(null, { rpc: { data: [], error: null } });
    expect(await upsertPresenceEverywhere(ME, "away")).toEqual([]);
  });

  it("⚠ A MISSING FUNCTION IS A 404, so the desktop can fall back rather than spin", async () => {
    // `20260930140000` is written-not-applied (§12), so a server legitimately ships ahead of its
    // database. 404 is the ONE status `main/presence-core.js` reads as "use the per-workspace
    // loop"; a 500 would make it retry this path forever and never beat at all.
    makeAdmin(null, {
      rpc: { data: null, error: { code: "PGRST202", message: "Could not find the function" } },
    });
    await expect(upsertPresenceEverywhere(ME, "active")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("the message check is the belt for a PostgREST that stops setting the code", async () => {
    makeAdmin(null, {
      rpc: { data: null, error: { message: "Could not find the function public.presence_heartbeat_all" } },
    });
    await expect(upsertPresenceEverywhere(ME, "active")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("any OTHER database error propagates — a real fault must not read as 'not deployed'", async () => {
    makeAdmin(null, {
      rpc: { data: null, error: { code: "57014", message: "statement timeout" } },
    });
    await expect(upsertPresenceEverywhere(ME, "active")).rejects.toMatchObject({
      message: "statement timeout",
    });
  });
});

/**
 * THE MIGRATION'S SHAPE, read from the file (2026-09-08).
 *
 * ⚠ **IT IS WRITTEN-NOT-APPLIED (§12), SO THE FILE IS THE ONLY THING ANY GATE CAN READ.**
 * `supabase db reset` needs Docker, which this machine does not have; `check-rls-pair-gate.ts`
 * replays the directory but this table is not in its covered set. So the properties that make
 * the RPC safe — one statement, an `INSERT … SELECT` over ACTIVE memberships, and EXECUTE
 * revoked from every login role — are pinned here or nowhere.
 */
describe("20260930140000_presence_heartbeat_all.sql", () => {
  const SQL = readFileSync(
    join(process.cwd(), "supabase/migrations/20260930140000_presence_heartbeat_all.sql"),
    "utf8"
  );
  /** The file with every `--` comment line removed — i.e. what Postgres actually runs. */
  const STATEMENTS = SQL.split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("is an INSERT … SELECT over ACTIVE memberships, upserting on the PK", () => {
    expect(SQL).toMatch(/INSERT INTO public\.agent_presence/);
    expect(SQL).toMatch(/FROM public\.workspace_members wm/);
    expect(SQL).toMatch(/wm\.status\s+=\s+'active'/);
    expect(SQL).toMatch(/ON CONFLICT \(user_id, workspace_id\) DO UPDATE/);
  });

  it("⚠ EXECUTE IS REVOKED FROM EVERY LOGIN ROLE — the subject is caller-supplied", () => {
    // A SECURITY DEFINER function taking `p_user_id` lets whoever can execute it stamp presence
    // as anybody. The grant is the entire fence, so it is asserted rather than assumed.
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.presence_heartbeat_all\(UUID, TEXT\) FROM PUBLIC/);
    expect(SQL).toMatch(/FROM anon, authenticated/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.presence_heartbeat_all\(UUID, TEXT\) TO service_role/);
    expect(SQL).not.toMatch(/GRANT EXECUTE[^;]*TO[^;]*authenticated/);
  });

  it("pins search_path — a DEFINER function without one is the escalation shape", () => {
    expect(SQL).toMatch(/SET search_path = public, pg_temp/);
  });

  it("⚠ WIDENS THE STATUS CHECK AND KEEPS ALL FOUR LEGACY WORDS", () => {
    // ⚠ COMMENT LINES ARE STRIPPED FIRST. The ROLLBACK block in the header quotes the NARROWED
    // four-word CHECK verbatim, so a naive match reads the rollback and passes while the live
    // statement says anything at all — §14's "a pin on prose is not a pin".
    const check = STATEMENTS.match(/CHECK \(status IN \(([^)]*)\)\)/);
    expect(check).toBeTruthy();
    for (const word of ["listening", "busy", "paused", "offline", "active", "away"]) {
      expect(check![1]).toContain(`'${word}'`);
    }
  });

  it("⚠ IS NOT A REALTIME CHANGE, and says so in an assertion rather than in prose", () => {
    // §7: publication membership and replica identity are the two things a migration touching a
    // published table must state. Both are asserted by the file's own VERIFICATION block.
    expect(SQL).toMatch(/left the realtime publication/);
    expect(SQL).toMatch(/replica identity moved off DEFAULT/);
    expect(SQL).not.toMatch(/ALTER PUBLICATION/);
    expect(SQL).not.toMatch(/REPLICA IDENTITY USING/);
  });
});

/**
 * **PRESENCE ACROSS MANY CONTAINERS — what `GET /api/channels?scope=account`
 * needs** (Wave 3, R-26), and the one thing its collapse has to get right.
 *
 * ⚠ **A PERSON IS IN N CONTAINERS AND HAS N ROWS.** They agree only while
 * `upsertPresenceEverywhere` is the writer; the per-workspace fallback loop it
 * replaced stamps them one at a time, which is how tail rows aged past the online
 * window in the first place. PostgREST promises no row order, so the collapse has
 * to pick by a total order rather than by arrival.
 */
describe("presenceForWorkspaces — one entry per PERSON, freshest stamp wins", () => {
  it("ONE `.in()` over every container, never a query per container", async () => {
    const calls = makeAdmin([]);
    await presenceForWorkspaces([WS, "ws-2", "ws-3"]);
    expect(calls.filter((c) => c.op === "from")).toHaveLength(1);
    expect(calls.find((c) => c.op === "in")?.args).toEqual([
      "workspace_id",
      [WS, "ws-2", "ws-3"],
    ]);
  });

  it("🔒 takes the FRESHEST row for a member of two containers, in EITHER order", async () => {
    const stale = { user_id: ME, last_seen_at: ago(60 * 60_000), status: null };
    const live = { user_id: ME, last_seen_at: ago(1_000), status: "listening" };
    makeAdmin([stale, live]);
    expect((await presenceForWorkspaces([WS, "ws-2"])).get(ME)?.online).toBe(true);
    // ⚠ THE SAME ANSWER WITH THE ROWS REVERSED. "Last row read wins" passes the
    // case above and fails this one, which is the whole point of it.
    makeAdmin([live, stale]);
    expect((await presenceForWorkspaces([WS, "ws-2"])).get(ME)?.online).toBe(true);
  });

  it("keeps each PERSON's own answer — the collapse is per user, not per page", async () => {
    makeAdmin([
      { user_id: ME, last_seen_at: ago(1_000), status: "listening" },
      { user_id: PEER, last_seen_at: ago(PRESENCE_ONLINE_WINDOW_MS * 2), status: null },
    ]);
    const map = await presenceForWorkspaces([WS, "ws-2"]);
    expect(map.get(ME)?.online).toBe(true);
    expect(map.get(PEER)?.online).toBe(false);
  });

  it("short-circuits on an empty container list", async () => {
    const calls = makeAdmin([]);
    expect((await presenceForWorkspaces([])).size).toBe(0);
    expect(calls).toEqual([]);
  });
});
