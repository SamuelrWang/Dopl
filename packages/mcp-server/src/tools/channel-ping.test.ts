/**
 * **THE PING LANE, RETIRED** — `op="ping"` / `op="pings"` (Samuel's ruling B8,
 * 2026-09-02).
 *
 * ⚠ **PINGS FOLD INTO A DIRECTED `send`, AND THE ARGUMENT IS THAT THE MAILBOX
 * ROW WAS ALWAYS A SECOND COPY OF A DELIVERY.** A directed send IS the delivery
 * record: it names one recipient, the server resolves it, and the result's
 * `delivery=` is the acknowledgement the ping row existed to be. The table
 * behind these two handlers — `20260907130000_channel_pings.sql` — was DELETED
 * UNAPPLIED in the same wave, so the lane has no storage either.
 *
 * ⚠ **THIS SUITE USED TO DRIVE THE LANE AND NOW GUARDS ITS ABSENCE, WHICH IS
 * THE SAME CLAIM FROM THE OTHER SIDE.** Its headline assertion was always an
 * ABSENCE — there is no argument on this surface that names an operator, and
 * there never may be — and the three params that carried the risk (`ping_kind`,
 * `recipient`, and the `to_desktop` that preceded them) are now pinned as
 * absences from the published shape rather than exercised. A retired lane whose
 * suite is simply deleted is a lane nothing stops from growing back.
 *
 * ⚠ **THE MODULE ITSELF IS SLICE B16's TO DELETE**, with `channel-ops-await*.ts`
 * — one release after the desktop version floor stops calling either name. Until
 * then the two names still PARSE, so their redirect can run instead of an opaque
 * `-32602 invalid enum value`, and that is exactly what is driven below.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";

import { registerChannelTool } from "./channel";
import { callTool, stub } from "./narration-fixtures";
import { CHANNEL_DESCRIPTION } from "./channel-description";
import { CHANNEL_INPUT_SHAPE, CHANNEL_OPS } from "./channel-schema";
import { RETIRED_OPS } from "./channel-retired-ops";

const DIRECTORY = {
  getWorkspaceList: async () => [],
  resolveWorkspaceRef: async () => null,
  noWorkspaceError: async () => ({ content: [], isError: true }),
  lockedWorkspaceId: () => null,
};

/** ⚠ EVERY method throws: a redirect that reached the network is not a redirect. */
function tripwireClient(): DoplClient {
  return new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("the retired ping lane reached the network");
      },
    },
  ) as unknown as DoplClient;
}

async function run(args: Record<string, unknown>): Promise<string> {
  return callTool(
    (r, c) => registerChannelTool(r, c, undefined, false, DIRECTORY),
    tripwireClient(),
    "dopl_channel",
    args,
  );
}

describe("both names still PARSE, and answer one line that reaches nothing", () => {
  it('op="ping" names the send that replaced it', async () => {
    const out = await run({ op: "ping", channel: "build", body: "done" });
    expect(out).toBe(`dopl_channel op="ping" ${RETIRED_OPS.ping}`);
    // ⚠ THE WHOLE POINT OF THE FOLD, IN THE LINE ITSELF: the caller is not told
    // "that op is gone", it is told which field carries the recipient now and
    // that the ack it wanted is on the send's own result.
    expect(out).toContain("send(to=…)");
    expect(out).toContain("delivery=");
  });

  it('op="pings" names the read that replaced it', async () => {
    const out = await run({ op: "pings" });
    expect(out).toBe(`dopl_channel op="pings" ${RETIRED_OPS.pings}`);
    expect(out).toContain("read");
  });

  it("neither is an ERROR — a migration notice is not a failure to retry", async () => {
    // ⚠ `retiredRedirect` returns `ok()`, deliberately: an `isError` response is
    // a failure a model retries, and this call did not fail — it was answered.
    // Driven through the real registrar so the claim is about what ships.
    for (const args of [{ op: "ping" }, { op: "pings" }]) {
      const res = await new Promise<{ isError?: boolean }>((resolve) => {
        registerChannelTool(
          ((name, _d, _s, h) => {
            if (name === "dopl_channel")
              void (h as (a: unknown) => Promise<{ isError?: boolean }>)(
                args,
              ).then(resolve);
          }) as never,
          tripwireClient(),
          undefined,
          false,
          DIRECTORY,
        );
      });
      expect(res.isError, JSON.stringify(args)).toBeFalsy();
    }
  });
});

describe("🔒 the params that carried the risk are gone, and may not come back", () => {
  it("neither name is in the enum a model can SEE", () => {
    // ⚠ THE PUBLISHED FIVE, which is what an MCP client lists. The runtime enum
    // is wider on purpose (see the redirects above); `parity.test.ts` asserts the
    // published half separately, and this is the ping-shaped case of it.
    expect(CHANNEL_OPS).not.toContain("ping");
    expect(CHANNEL_OPS).not.toContain("pings");
  });

  it("declares no ping-only recipient or kind param", () => {
    // ⚠ **`recipient` WAS THE ONE-FIELD FIX FOR THREE MUTUALLY EXCLUSIVE
    // SPELLINGS, AND IT IS NOW `to`.** One recipient field for the whole surface
    // is the same guarantee that shape bought, applied once instead of per op:
    // a shape that can only carry one recipient cannot be sent two.
    for (const gone of ["recipient", "ping_kind", "to_desktop", "to_agent"]) {
      expect(CHANNEL_INPUT_SHAPE, gone).not.toHaveProperty(gone);
    }
    expect(CHANNEL_INPUT_SHAPE).toHaveProperty("to");
  });

  it("🔒 declares no operator, sender or user field — the loop brake as a shape", () => {
    // ⚠ THE HEADLINE ABSENCE, UNCHANGED BY THE FOLD. There is no argument on
    // this surface that names WHOSE machine; the server stamps the authenticated
    // caller, so a peer's agent is unreachable because there is nothing to say
    // it with. ⚠ Scanned over the whole published shape, not over one op's
    // params, because that is the level the guarantee holds at.
    for (const key of Object.keys(CHANNEL_INPUT_SHAPE)) {
      expect(key, `\`${key}\` names a party this surface may not name`).not.toMatch(
        /operator|sender|user|desktop|machine/i,
      );
    }
  });

  it("the shipped description offers neither name", () => {
    // ⚠ A retired op glossed in a PUSHED string is 400 characters teaching a
    // call the enum rejects. The redirect is the notice, addressed to the caller
    // that needs it (`channel-description.ts` states that trade).
    expect(CHANNEL_DESCRIPTION).not.toContain('"ping"');
    expect(CHANNEL_DESCRIPTION).not.toContain('"pings"');
  });
});

describe("the fold is stated where a caller will read it", () => {
  it("the ping redirect explains the DELIVERY record, not just the spelling", () => {
    // ⚠ **THE ONE THING A RENAME WOULD NOT HAVE TAUGHT.** An agent that used
    // `ping` was asking "how do I know it landed"; the answer is no longer a
    // second call to an inbox, it is a field on the result of the send it
    // already made. A redirect that only said `use send` would leave that agent
    // looking for the inbox.
    expect(RETIRED_OPS.ping).toContain("delivery=");
    expect(RETIRED_OPS.pings).toContain("no second inbox");
  });

  it("and no ping-shaped stub is ever consulted", async () => {
    // ⚠ The belt for the tripwire client above: a redirect that made a client
    // call would be a retired lane still running.
    const listPings = vi.fn();
    const out = await callTool(
      (r, c) => registerChannelTool(r, c, undefined, false, DIRECTORY),
      stub({ listPings }),
      "dopl_channel",
      { op: "pings", limit: 5 },
    );
    expect(listPings).not.toHaveBeenCalled();
    expect(out).toContain("retired");
  });
});
