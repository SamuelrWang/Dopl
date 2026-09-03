/**
 * `dopl_channel(op="read")` with `wait_ms` — ONE CHANNEL — and every string that
 * describes the hold. The only shape here whose result text reasons about the
 * caller's client.
 *
 * ⚠ **IT WAS `op="await"` UNTIL 2026-09-02 (B8) AND THE OP IS GONE (B16).** The
 * hold is a knob on the read, so the module is named for the read path it lives
 * under; nothing in the tree calls this lane `await` any more except the HTTP
 * route and the SDK method that carry the inner long-poll, which are transport.
 *
 * ⚠ **THE LOOP IS NOT HERE — it is `channel-hold-loop.ts`, shared with the
 * workspace lane.** What IS here is the four RESULT VOCABULARIES, which are what
 * make the two lanes siblings rather than one function with a flag: every
 * sentence below splices `ref`.
 *
 * ⚠ Every clock bounding the hold lives in `channel-hold-budget.ts`. Read that
 * before retuning any of them.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts) — a handler in an unprefixed file is invisible to the
 * declared-param drift guards.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * THE PER-CHANNEL HOLD. One call holds for `holdMsFor(waitMs, runtime)` by
 * re-issuing the ~50s inner long-poll on the same cursor
 * (`channel-hold-loop.ts › runHold`). Returning the instant anything arrives
 * keeps a reply fast; holding past ~2 minutes when nothing does is what makes
 * the pending call a wake primitive — ⚠ and that is reachable only for a
 * DESKTOP-stamped caller or an explicit `wait_ms`, not at an unstamped caller's
 * default, whose own client aborts first (T03).
 *
 * ⚠ Four results, never a thrown error once the hold is underway: messages,
 * timed-out (re-arm, with stop condition), FAILED-MID-HOLD (names what broke,
 * re-arms on the same cursor), CUT SHORT (do NOT re-arm, report).
 *
 * ⚠ CHANNEL-WIDE BY CONSTRUCTION — no thread filter, no `thread` param on this
 * shape, and the result text must never suggest otherwise: a filtered hold would
 * miss messages an agent needs to follow.
 *
 * `runtime` = caller's OBSERVED runtime stamp, threaded from the registrar.
 * ⚠ IT SIZES THE DEFAULT HOLD AS WELL AS WORDING THE RESULT (T03) — still an
 * observation that grants nothing, but read wrong it costs hold length one way
 * and a transport error the other.
 */
export declare function opHold(client: DoplClient, ref: string, since: number, waitMs?: number, selfUserId?: string | null, runtime?: string | null, selfSessionId?: string | null): Promise<ToolResponse>;
