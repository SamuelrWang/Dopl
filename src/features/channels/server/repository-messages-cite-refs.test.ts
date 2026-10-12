/**
 * **THE CITATION FINDER'S FENCE IS THE `eq`, AND IT IS THE AUTHORIZATION**
 * (grammar B, 2026-10-12).
 *
 * ⚠ **THIS IS THE ONLY PLACE CROSS-CHANNEL CITATION IS REFUSED.** `seq` is
 * TABLE-WIDE, so `seq=777` names a real row in some room the author may never
 * have been in. The service above this has no separate membership check to make
 * — it does not need one, because the caller is already proved a member of THIS
 * channel and the read is fenced to it, so a citation pointing elsewhere comes
 * back as no row and the send is refused. Drop the `eq` and that refusal becomes
 * a successful resolution to a message in another room, with a pill pointing
 * confidently at it.
 *
 * ⚠ The service's side of the same behaviour is pinned in
 * `service-writes-metadata-cites.test.ts`, where the finder is mocked — so
 * nothing there can catch a missing `eq`. That is why this file exists at the
 * query level, and why it asserts the ARGUMENTS rather than a returned shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { findMessageRefsBySeqs } from "./repository-messages";

type Call = { method: string; args: unknown[] };

let calls: Call[] = [];
const from = vi.fn();

/** A chainable, awaitable stand-in that records what was asked of it. */
function queryChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  // Thenable, so `await db.from(..).select(..).eq(..).in(..)` settles whatever
  // the chain's length turns out to be.
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve);
  return chain;
}

function arg(method: string): unknown[] {
  const call = calls.find((c) => c.method === method);
  return call ? call.args : [];
}

beforeEach(() => {
  calls = [];
  from.mockReset();
  from.mockImplementation(() =>
    queryChain([{ id: "m-12", seq: 12, metadata: {} }])
  );
  vi.mocked(supabaseAdmin).mockReturnValue({ from } as never);
});

describe("findMessageRefsBySeqs", () => {
  it("🔒 FENCES THE READ TO THE CHANNEL", async () => {
    await findMessageRefsBySeqs("chan-1", [12]);
    expect(
      arg("eq"),
      `Without this the finder resolves a citation against the WHOLE TABLE, and ` +
        `a seq from a room the author cannot read comes back as a live reference.`
    ).toEqual(["channel_id", "chan-1"]);
  });

  it("reads the right table", async () => {
    await findMessageRefsBySeqs("chan-1", [12]);
    expect(from.mock.calls[0][0]).toBe("channel_messages");
  });

  it("asks for the seqs it was given", async () => {
    await findMessageRefsBySeqs("chan-1", [12, 20]);
    expect(arg("in")).toEqual(["seq", [12, 20]]);
  });

  it("projects THREE columns — a citation needs an id, a seq and the thread tag", async () => {
    // ⚠ Explicit, not `*`: this read happens on every cited post, and the row it
    // is pointed at may be any message in the channel's history.
    await findMessageRefsBySeqs("chan-1", [12]);
    expect(arg("select")).toEqual(["id, seq, metadata"]);
  });

  it("🔒 an EMPTY list costs no query at all", async () => {
    const out = await findMessageRefsBySeqs("chan-1", []);
    expect(out).toEqual([]);
    expect(
      from,
      `An uncited post is the overwhelming majority of posts; it must not pay for ` +
        `a round trip, and \`in("seq", [])\` is a query that can only return nothing.`
    ).not.toHaveBeenCalled();
  });

  it("returns the rows as found, without inventing a miss", async () => {
    // A seq with no row is the SERVICE's refusal to make; this layer reports
    // what the fenced read saw.
    from.mockImplementation(() => queryChain([]));
    expect(await findMessageRefsBySeqs("chan-1", [999])).toEqual([]);
  });

  it("🔒 a query error is THROWN, never read as 'no such message'", async () => {
    // Otherwise a transient failure is indistinguishable from a dead citation,
    // and the send is refused with a message blaming the author.
    from.mockImplementation(() => {
      const chain = queryChain([]) as Record<string, unknown>;
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve);
      return chain;
    });
    await expect(findMessageRefsBySeqs("chan-1", [12])).rejects.toBeTruthy();
  });
});
