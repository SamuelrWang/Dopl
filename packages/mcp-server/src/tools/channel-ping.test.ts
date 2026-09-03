/**
 * **THE PING LANE, RETIRED** — `op="ping"` / `op="pings"` (Samuel's ruling B8,
 * 2026-09-02) — **AND DELETED** (slice B16).
 *
 * ⚠ **PINGS FOLD INTO A DIRECTED `send`, AND THE ARGUMENT IS THAT THE MAILBOX
 * ROW WAS ALWAYS A SECOND COPY OF A DELIVERY.** A directed send IS the delivery
 * record: it names one recipient, the server resolves it, and the result's
 * `delivery=` is the acknowledgement the ping row existed to be. The table
 * behind the lane — `20260907130000_channel_pings.sql` — was DELETED UNAPPLIED
 * in the same wave, so it never had storage either.
 *
 * ⚠ **THIS SUITE DROVE THE LANE, THEN DROVE ITS REDIRECT, AND NOW GUARDS ITS
 * ABSENCE — the same claim each time, from further away.** Its headline
 * assertion was always an ABSENCE: there is no argument on this surface that
 * names WHOSE machine, and there never may be. The three params that carried the
 * risk (`ping_kind`, `recipient`, and the `to_desktop` that preceded them) are
 * pinned as absences from the published shape. **A retired lane whose suite is
 * simply deleted is a lane nothing stops from growing back.**
 */

import { describe, it, expect } from "vitest";

import { CHANNEL_DESCRIPTION } from "./channel-description";
import { CHANNEL_INPUT_SHAPE, CHANNEL_OPS } from "./channel-schema";

describe("🔒 the ping lane is gone, and may not come back", () => {
  it("neither name parses, and neither is in the enum a model can SEE", () => {
    for (const gone of ["ping", "pings"]) {
      expect(CHANNEL_OPS, gone).not.toContain(gone);
      expect(
        CHANNEL_INPUT_SHAPE.op.safeParse(gone).success,
        `op="${gone}" still parses`,
      ).toBe(false);
    }
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
    // call the enum rejects — and since B16 it rejects it with no redirect to
    // soften the landing.
    expect(CHANNEL_DESCRIPTION).not.toContain('"ping"');
    expect(CHANNEL_DESCRIPTION).not.toContain('"pings"');
  });
});
