/**
 * 🔓 **THE PERSONAL-REACH FENCE, DEFAULT-ON** (2026-09-06, Samuel's reversal of
 * task 11 / design #1077) — and the file that has to fail if the arming
 * narrowing is ever re-grown into the reach decision.
 *
 * ⚠ **IT ASSERTS THE QUERIES AS WELL AS THE ANSWERS.** The reach now costs ONE
 * read for everybody — the container probe — because the member count and the
 * arming probe are gone with the narrowing they served. An edit that answers
 * correctly while asking those questions again on every `listBases` is a
 * regression nothing but a call-shape assertion notices.
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

type Call = { table: string; op: string; args: unknown[] };

let calls: Call[];

/** What each table answers. Only `workspaces` (the container probe) is read now;
 *  the builder still tolerates the retired reads so a stray probe would show up
 *  in `tables()` rather than throwing. */
interface World {
  container?: string | null;
}

function prime(world: World = {}) {
  calls = [];
  const { container = CONTAINER } = world;
  const newBuilder = (table: string) => {
    const builder: Record<string, unknown> = {};
    const rec = (op: string, args: unknown[]) => {
      calls.push({ table, op, args });
      return builder;
    };
    Object.assign(builder, {
      select: (c: string, opts?: unknown) => rec("select", [c, opts]),
      eq: (c: string, v: unknown) => rec("eq", [c, v]),
      maybeSingle: () =>
        Promise.resolve({
          data: container === null ? null : { id: container },
          error: null,
        }),
      then: (resolve: (r: unknown) => void) =>
        resolve({ data: [], count: null, error: null }),
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

// ── THE TWO ANSWERS THAT STILL CLOSE THE FENCE ────────────────────────────

describe("🔒 a credential that stands for nobody reaches no shelf", () => {
  it("refuses a SHARED credential without asking anything", async () => {
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

describe("🔓 A PERSON CROSSES CONTAINERS ALWAYS", () => {
  it.each([
    ["absent", undefined],
    ["null", null],
    ["a web lane", "web"],
  ])("opens for %s source, in a room full of other people", async (_l, source) => {
    expect(await resolvePersonalReach({ ...person, source })).toEqual({
      kind: "open",
      containerId: CONTAINER,
    });
    // 🔓 ONE READ — the container probe and nothing else.
    expect(tables()).toEqual(["workspaces"]);
  });
});

// ── THE AGENT ARM — DEFAULT-ON EVERYWHERE (the reversal) ───────────────────

describe("🔓 AN AGENT REACHES ITS OPERATOR'S SHELF FROM ANY ROOM", () => {
  it("opens when the calling container IS the personal container", async () => {
    expect(
      await resolvePersonalReach({ ...agent, workspaceId: CONTAINER })
    ).toEqual({ kind: "open", containerId: CONTAINER });
    expect(tables()).toEqual(["workspaces"]);
  });

  it("🔓 opens a SHARED room unconditionally — no member count, no arming probe", async () => {
    // 🔓 THE REVERSAL ITSELF. Before 2026-09-06 an agent in a room with somebody
    // else in it was closed until the owner armed it; it now opens by default,
    // and the confidentiality of the shelf's contents is a PROMPT rule, not a
    // refusal here. ⚠ MUTATION CHECK: re-growing the narrowing would put
    // `workspace_members` and `channel_personal_arming` back on this list.
    expect(await resolvePersonalReach(agent)).toEqual({
      kind: "open",
      containerId: CONTAINER,
    });
    expect(tables()).toEqual(["workspaces"]);
    expect(tables()).not.toContain("workspace_members");
    expect(tables()).not.toContain("channel_personal_arming");
  });

  it("🔓 opens regardless of the session header — it is no longer read", async () => {
    expect(
      await resolvePersonalReach({ ...agent, sessionId: `${CHANNEL}:tail` })
    ).toEqual({ kind: "open", containerId: CONTAINER });
    expect(tables()).toEqual(["workspaces"]);
  });
});

// ── THE ENUMERATION HELPER ────────────────────────────────────────────────

describe("personalShelfContainerIds — the only form the widening takes", () => {
  it("adds the shelf when it is a DIFFERENT container", async () => {
    expect(await personalShelfContainerIds(person)).toEqual([CONTAINER]);
  });

  it("🔓 adds it for an AGENT in a shared room too, now that reach is default-on", async () => {
    expect(await personalShelfContainerIds(agent)).toEqual([CONTAINER]);
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
    // filter": the repositories apply it with `.in()`.
    prime({ container: null });
    expect(await personalShelfContainerIds(person)).toEqual([]);
  });
});
