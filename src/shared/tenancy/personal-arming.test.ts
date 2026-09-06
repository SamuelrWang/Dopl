/**
 * 🔒 **THE SWITCH BEHIND THE TASK 11 FENCE, DRIVEN IN EVERY DIRECTION** — the
 * write half (design #1077, approved #1080), and the file that has to fail if
 * the human-only rule, the owner keying, the membership fence on ARM or the
 * absence of one on DISARM is undone.
 *
 * ⚠ **IT ASSERTS THE FILTERS AS WELL AS THE ANSWERS**, in `personal-reach.test.ts`'s
 * style and for its reason: `owner_id = the caller` is the whole of the
 * authorization here, and only a call-shape assertion notices an edit that
 * writes the right answer against somebody else's row.
 *
 * ⚠ **THE ASYMMETRY IS THE POINT AND IT IS PINNED TWICE.** Arming reads
 * `channel_members` first; disarming must never read it at all. A test that
 * only checked the happy paths would let a tidy-up "make them symmetric" strand
 * an armed row on a person who has left the room.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  armChannelForPersonalShelf,
  disarmChannelForPersonalShelf,
  isChannelArmed,
  type PersonalArmingCaller,
} from "./personal-arming";

const ME = "11111111-1111-4111-8111-111111111111";
const CHANNEL = "44444444-4444-4444-8444-444444444444";

type Call = { table: string; op: string; args: unknown[] };

let calls: Call[];

/** What each table answers. `member` is the `channel_members` probe, `armed`
 *  the caller's own arming row. */
interface World {
  member?: boolean;
  armed?: boolean;
}

function prime(world: World = {}) {
  calls = [];
  const { member = true, armed = false } = world;
  const newBuilder = (table: string) => {
    const builder: Record<string, unknown> = {};
    const rec = (op: string, args: unknown[]) => {
      calls.push({ table, op, args });
      return builder;
    };
    const single = () =>
      table === "channel_members"
        ? member
          ? { user_id: ME }
          : null
        : armed
          ? { channel_id: CHANNEL }
          : null;
    Object.assign(builder, {
      select: (c: string, opts?: unknown) => rec("select", [c, opts]),
      eq: (c: string, v: unknown) => rec("eq", [c, v]),
      upsert: (row: unknown, opts?: unknown) => rec("upsert", [row, opts]),
      delete: () => rec("delete", []),
      maybeSingle: () => Promise.resolve({ data: single(), error: null }),
      // ⚠ The awaited write. `upsert`/`delete` are terminal here, so the builder
      // itself resolves — the same envelope PostgREST answers with.
      then: (resolve: (r: unknown) => void) =>
        resolve({ data: null, error: null }),
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

const person: PersonalArmingCaller = {
  userId: ME,
  credentialSubjectUserId: ME,
  source: "user",
};

beforeEach(() => {
  vi.clearAllMocks();
  prime();
});

describe("who may touch the switch", () => {
  it("refuses a SHARED credential — it stands for nobody's shelf", async () => {
    prime();
    await expect(
      armChannelForPersonalShelf(
        { ...person, credentialSubjectUserId: null },
        CHANNEL
      )
    ).rejects.toMatchObject({ status: 403, code: "PERSONAL_ARMING_FORBIDDEN" });
    // 🔒 AND IT COSTS NO READ — the refusal is decided before the database.
    expect(tables()).toEqual([]);
  });

  it("refuses an AGENT: the subject of the gate cannot open it", async () => {
    prime();
    await expect(
      armChannelForPersonalShelf({ ...person, source: "agent" }, CHANNEL)
    ).rejects.toMatchObject({ status: 403, code: "PERSONAL_ARMING_FORBIDDEN" });
    await expect(
      disarmChannelForPersonalShelf({ ...person, source: "agent" }, CHANNEL)
    ).rejects.toMatchObject({ status: 403 });
    expect(tables()).toEqual([]);
  });

  it("treats an absent `source` as a person, exactly as the fence does", async () => {
    prime();
    await expect(
      armChannelForPersonalShelf(
        { userId: ME, credentialSubjectUserId: ME },
        CHANNEL
      )
    ).resolves.toEqual({ armed: true });
  });
});

describe("arm", () => {
  it("checks membership FIRST, then upserts the caller's own row", async () => {
    prime({ member: true });
    await expect(armChannelForPersonalShelf(person, CHANNEL)).resolves.toEqual({
      armed: true,
    });
    // ⚠ ORDER, not just presence: a write that ran before the fence would pass
    // a test that only counted the two tables.
    expect(tables()).toEqual(["channel_members", "channel_personal_arming"]);
    expect(filters("channel_members")).toEqual([
      `eq("channel_id"="${CHANNEL}")`,
      `eq("user_id"="${ME}")`,
    ]);
    const upsert = calls.find((c) => c.op === "upsert");
    expect(upsert?.args[0]).toEqual({ channel_id: CHANNEL, owner_id: ME });
  });

  it("keeps the original `armed_at` on a repeat press", async () => {
    prime({ member: true, armed: true });
    await armChannelForPersonalShelf(person, CHANNEL);
    const upsert = calls.find((c) => c.op === "upsert");
    // ⚠ `ignoreDuplicates` is the "since when" fact, not a micro-optimisation.
    expect(upsert?.args[1]).toMatchObject({ ignoreDuplicates: true });
  });

  it("answers NOT FOUND for a room the caller is not in, and writes nothing", async () => {
    prime({ member: false });
    await expect(
      armChannelForPersonalShelf(person, CHANNEL)
    ).rejects.toMatchObject({ status: 404, code: "CHANNEL_NOT_FOUND" });
    // 🔒 THE SAME ANSWER A NONEXISTENT CHANNEL GETS, and no row was touched:
    // a distinct refusal here would enumerate the container's rooms.
    expect(tables()).toEqual(["channel_members"]);
  });
});

describe("disarm — closing is always available", () => {
  it("never reads membership: leaving a room must not strand an armed row", async () => {
    prime({ member: false });
    await expect(
      disarmChannelForPersonalShelf(person, CHANNEL)
    ).resolves.toEqual({ armed: false });
    expect(tables()).toEqual(["channel_personal_arming"]);
    expect(filters("channel_personal_arming")).toEqual([
      "delete()",
      `eq("channel_id"="${CHANNEL}")`,
      `eq("owner_id"="${ME}")`,
    ]);
  });

  it("does NOT 404 on a row that is not there — the caller is where they asked to be", async () => {
    prime({ armed: false });
    await expect(
      disarmChannelForPersonalShelf(person, CHANNEL)
    ).resolves.toEqual({ armed: false });
  });
});

describe("isChannelArmed — the caller's own row, and only that", () => {
  it("is keyed on BOTH the channel and the owner", async () => {
    prime({ armed: true });
    await expect(isChannelArmed(person, CHANNEL)).resolves.toBe(true);
    expect(filters("channel_personal_arming")).toEqual([
      `eq("channel_id"="${CHANNEL}")`,
      `eq("owner_id"="${ME}")`,
    ]);
  });

  it("answers false, never a refusal, when the room is unarmed", async () => {
    prime({ armed: false });
    await expect(isChannelArmed(person, CHANNEL)).resolves.toBe(false);
  });
});
