/**
 * 🔒 **THE TASK 11 FENCE, DRIVEN IN EVERY DIRECTION** (design #1077, approved
 * #1080) — and the file that has to fail when the narrowing is undone.
 *
 * ⚠ **IT ASSERTS THE QUERIES AS WELL AS THE ANSWERS, and both halves are load
 * bearing.** The fence's ORDER is its query budget: a person costs one read and
 * only an agent inside a shared container pays the member count and the arming
 * probe. An edit that answers correctly while asking four questions on every
 * `listBases` is a performance regression dressed as a security control, and
 * nothing but a call-shape assertion notices it.
 *
 * ⚠ **THE REAL MODULE CYCLE IS EXERCISED ON PURPOSE.** `personal-reach.ts` and
 * `personal-container.ts` import each other (function-body use on both sides),
 * so only `supabaseAdmin` is mocked here: importing the fence through its own
 * cycle is the cheapest standing proof that the cycle resolves at all.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  personalShelfContainerIds,
  resolvePersonalReach,
  type PersonalReachCaller,
} from "./personal-reach";

const ME = "11111111-1111-4111-8111-111111111111";
const ROOM = "22222222-2222-4222-8222-222222222222";
const CONTAINER = "33333333-3333-4333-8333-333333333333";
const CHANNEL = "44444444-4444-4444-8444-444444444444";
const OTHER_CHANNEL = "55555555-5555-4555-8555-555555555555";

type Call = { table: string; op: string; args: unknown[] };

let calls: Call[];

/** What each table answers. `workspaces` is the container probe, `count` is the
 *  member count (⚠ `null` = UNREADABLE, not zero), `arming` the armed rows. */
interface World {
  container?: string | null;
  count?: number | null;
  arming?: string[];
}

function prime(world: World = {}) {
  calls = [];
  const { container = CONTAINER, count = 5, arming = [] } = world;
  const newBuilder = (table: string) => {
    const builder: Record<string, unknown> = {};
    const rec = (op: string, args: unknown[]) => {
      calls.push({ table, op, args });
      return builder;
    };
    const rows = () =>
      table === "channel_personal_arming"
        ? arming.map((channel_id) => ({ channel_id }))
        : [];
    Object.assign(builder, {
      select: (c: string, opts?: unknown) => rec("select", [c, opts]),
      eq: (c: string, v: unknown) => rec("eq", [c, v]),
      maybeSingle: () =>
        Promise.resolve({
          data: container === null ? null : { id: container },
          error: null,
        }),
      // ⚠ ONE `then` FOR BOTH AWAITED READS: the member count is a `head:true`
      // query that returns `count` and no rows, the arming probe returns rows
      // and no count, and PostgREST hands both back on the same envelope.
      then: (resolve: (r: unknown) => void) =>
        resolve({ data: rows(), count, error: null }),
    });
    return builder;
  };
  vi.mocked(supabaseAdmin).mockReturnValue({
    from: (t: string) => {
      calls.push({ table: t, op: "from", args: [t] });
      return newBuilder(t);
    },
  } as never);
}

/** Every filter one read applied, as `op(col=value)` — the mutation surface. */
function filters(table: string): string[] {
  return calls
    .filter((c) => c.table === table && c.op !== "from" && c.op !== "select")
    .map((c) => `${c.op}(${c.args.map((a) => JSON.stringify(a)).join("=")})`);
}

function tables(): string[] {
  return calls.filter((c) => c.op === "from").map((c) => c.table);
}

const person: PersonalReachCaller = {
  userId: ME,
  credentialSubjectUserId: ME,
  workspaceId: ROOM,
};
const agent: PersonalReachCaller = { ...person, source: "agent" };

beforeEach(() => {
  vi.clearAllMocks();
  prime();
});

// ── THE TWO ANSWERS THAT COST NOTHING ─────────────────────────────────────

describe("🔒 a credential that stands for nobody reaches no shelf", () => {
  it("refuses a SHARED credential without asking anything", async () => {
    // ⚠ MUTATION CHECK for moving the container probe above clause 1: a key
    // that may be passed between humans must not learn where "their" shelf is.
    expect(
      await resolvePersonalReach({ ...agent, credentialSubjectUserId: null })
    ).toEqual({ kind: "closed", refusal: "shared_credential" });
    expect(calls).toEqual([]);
  });

  it("refuses when the owner has no personal container yet", async () => {
    prime({ container: null });
    expect(await resolvePersonalReach(agent)).toEqual({
      kind: "closed",
      refusal: "no_container",
    });
    // ⚠ NOTHING BEYOND THE PROBE. There is no shelf, so the room's audience is
    // not a question anyone has to pay for.
    expect(tables()).toEqual(["workspaces"]);
  });

  it("looks the container up BY OWNER and by kind, never by anything supplied", async () => {
    // ⚠ MUTATION CHECK, and the reason the whole module is safe: key this on a
    // caller-supplied value and the fence becomes a door into any shelf.
    await resolvePersonalReach(agent);
    expect(filters("workspaces")).toEqual([
      `eq("owner_id"=${JSON.stringify(ME)})`,
      `eq("kind"="personal")`,
    ]);
  });
});

// ── THE PERSON ARM ────────────────────────────────────────────────────────

describe("🔒 A PERSON CROSSES CONTAINERS ALWAYS — ungated by ruling", () => {
  it.each([
    ["absent", undefined],
    ["null", null],
    ["a web lane", "web"],
  ])("opens for %s source, in a room full of other people", async (_l, source) => {
    expect(await resolvePersonalReach({ ...person, source })).toEqual({
      kind: "open",
      containerId: CONTAINER,
    });
    // 🔒 ONE READ. ⚠ MUTATION CHECK in BOTH directions: gating the human arm
    // would fence Samuel off his own notes on his own screen (the ruling), and
    // pricing it at four reads would put the member count on every knowledge
    // page load.
    expect(tables()).toEqual(["workspaces"]);
  });

  it("⚠ ONLY the literal `agent` gates — a lane that forgot to say is a person", async () => {
    // The one place this module does not fail closed, stated in its own header.
    // There are hundreds of human web routes and one agent family.
    expect(await resolvePersonalReach({ ...person, source: "Agent" })).toEqual({
      kind: "open",
      containerId: CONTAINER,
    });
  });
});

// ── THE AGENT ARMS ────────────────────────────────────────────────────────

describe("an AGENT standing on the shelf itself is not in a room", () => {
  it("opens when the calling container IS the personal container", async () => {
    expect(
      await resolvePersonalReach({ ...agent, workspaceId: CONTAINER })
    ).toEqual({ kind: "open", containerId: CONTAINER });
    // ⚠ There is no second audience to bound, so no count and no probe — and
    // gating it would fence the operator's agent off the shelf it was launched
    // to work on.
    expect(tables()).toEqual(["workspaces"]);
  });
});

describe("an AGENT in a container its operator is ALONE in keeps today's reach", () => {
  it("opens on a solo container, without probing the arming table", async () => {
    prime({ count: 1 });
    expect(await resolvePersonalReach(agent)).toEqual({
      kind: "open",
      containerId: CONTAINER,
    });
    expect(tables()).toEqual(["workspaces", "workspace_members"]);
  });

  it("counts ACTIVE members only", async () => {
    // ⚠ MUTATION CHECK. `findMembership` carries the scar of omitting `status`
    // (a removed admin still measured as one); here the same omission would
    // count a departed peer as an audience and keep a room "shared" forever.
    prime({ count: 1 });
    await resolvePersonalReach(agent);
    expect(filters("workspace_members")).toEqual([
      `eq("workspace_id"=${JSON.stringify(ROOM)})`,
      `eq("status"="active")`,
    ]);
  });

  it("🔒 an UNREADABLE count is NOT a count of one", async () => {
    // ⚠ THE FAIL-CLOSED DIRECTION. `null` is "not solo", so the arming probe
    // decides: the safe reading of "I could not count the people in this room"
    // is that there is somebody in it.
    prime({ count: null });
    expect(await resolvePersonalReach(agent)).toEqual({
      kind: "closed",
      refusal: "unarmed_room",
    });
    expect(tables()).toContain("channel_personal_arming");
  });
});

describe("🔒 AN AGENT IN A SHARED ROOM IS OUT OF REACH UNTIL THE ROOM IS ARMED", () => {
  it("closes an unarmed shared room", async () => {
    // 🔒 THE NARROWING ITSELF, and it REVERSES SHIPPED BEHAVIOUR (#1077 gap 3,
    // ruling (a)). Before task 11 a locked credential in a room with somebody
    // else in it could already read its operator's personal bases with no human
    // in the loop. Deleting this case is how that comes back.
    expect(await resolvePersonalReach(agent)).toEqual({
      kind: "closed",
      refusal: "unarmed_room",
    });
  });

  it("opens once the owner has armed a channel of that room", async () => {
    prime({ arming: [CHANNEL] });
    expect(await resolvePersonalReach(agent)).toEqual({
      kind: "open",
      containerId: CONTAINER,
    });
  });

  it("🔒 asks for the owner's OWN rows, joined to THIS container's channels", async () => {
    // ⚠ MUTATION CHECK, and it is the meaning of "per (room, owner)": the
    // container join is inside the query, so an arming row for a DIFFERENT room
    // can never open this one, and nothing here reads a caller-supplied
    // container.
    prime({ arming: [CHANNEL] });
    await resolvePersonalReach(agent);
    expect(filters("channel_personal_arming")).toEqual([
      `eq("owner_id"=${JSON.stringify(ME)})`,
      `eq("channels.workspace_id"=${JSON.stringify(ROOM)})`,
    ]);
    expect(
      calls.find(
        (c) => c.table === "channel_personal_arming" && c.op === "select"
      )?.args[0]
    ).toBe("channel_id, channel:channels!inner(workspace_id)");
  });
});

// ── THE SESSION HEADER ────────────────────────────────────────────────────

describe("🔒 the session header NARROWS and cannot widen", () => {
  it("selects an armed channel the header names", async () => {
    prime({ arming: [CHANNEL, OTHER_CHANNEL] });
    expect(
      await resolvePersonalReach({ ...agent, sessionId: `${CHANNEL}:tail` })
    ).toMatchObject({ kind: "open" });
  });

  it("🔒 a FORGED header fences the caller out of its own reach", async () => {
    // `X-Dopl-Session-Id` is forgeable, so the armed set is computed from DB
    // facts FIRST and the header may only SELECT one already in it. ⚠ MUTATION
    // CHECK for "improving" this into a lookup: resolving the named channel
    // against the database would make the header an ADDRESSING input, which is
    // exactly the power it must not have. The worst it can do is this —
    // a self-inflicted refusal.
    prime({ arming: [CHANNEL] });
    expect(
      await resolvePersonalReach({ ...agent, sessionId: `${OTHER_CHANNEL}:t` })
    ).toEqual({ kind: "closed", refusal: "unarmed_room" });
  });

  it("ignores a handle that names no channel, rather than reading it", async () => {
    // ⚠ SHAPE GUARD, NOT A FENCE: another client's opaque handle may carry a
    // colon without naming a channel, and splitting one is noise rather than a
    // decision. The armed set stands.
    prime({ arming: [CHANNEL] });
    for (const sessionId of [null, "", "opaque:handle", "no-colon"]) {
      expect(
        await resolvePersonalReach({ ...agent, sessionId }),
        String(sessionId)
      ).toMatchObject({ kind: "open" });
    }
  });
});

// ── THE ENUMERATION HELPER ────────────────────────────────────────────────

describe("personalShelfContainerIds — the only form the widening takes", () => {
  it("adds the shelf when it is a DIFFERENT container", async () => {
    expect(await personalShelfContainerIds(person)).toEqual([CONTAINER]);
  });

  it("🔒 never includes the CALLING container, even when it is the shelf", async () => {
    // ⚠ The caller reads its own container by its own path; adding it here
    // would double every row on the one surface that stands on the shelf.
    expect(
      await personalShelfContainerIds({ ...person, workspaceId: CONTAINER })
    ).toEqual([]);
  });

  it("🔒 answers EMPTY on a closed fence — a list, never a refusal", async () => {
    // ⚠ EMPTY IS THE FAIL-SAFE READ and a surface must never treat it as "no
    // filter": the repositories apply it with `.in()`. It is also what keeps
    // arming state from being an oracle — an unarmed room enumerates exactly
    // what a room with nothing in it enumerates.
    expect(await personalShelfContainerIds(agent)).toEqual([]);
    prime({ container: null });
    expect(await personalShelfContainerIds(person)).toEqual([]);
  });
});
