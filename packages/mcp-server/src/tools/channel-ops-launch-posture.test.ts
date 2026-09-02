/**
 * `postureFacts` — **THE RENDER OF THE APPLIED POSTURE, AND THE NULL CASE IS THE WHOLE POINT.**
 *
 * ⚠ **WHY IT IS ITS OWN FILE.** `channel-ops-launch.test.ts` is about the four TERMINAL SHAPES of
 * `op="launch_agent"` — what each one teaches a model choosing its next action. This is about ONE
 * pure function's truth table, on a different clock: it moves when the echo columns move, not when
 * the op's copy does. Same seam `channel-ops-launch-template.test.ts` already took.
 *
 * ── ⚠ WHAT CHANGED UNDER IT, AND WHY THE NULL CASE MATTERS MORE NOW, NOT LESS (2026-09-01) ──
 *
 * The `applied_*` columns shipped with NO WRITER, so `null` was the value on every live row. The
 * writer has now landed — `dopl-desktop-app/main/launch-directive-spawn.js › spawn` returns the
 * RESOLVED posture and `main/launch-directive-wire.js › decideBody` puts it on the launched body —
 * and the tempting conclusion is that "not reported" is legacy wording. **It is not.** `null` is
 * still the live value for:
 *   • every row written before that wave, and
 *   • every row decided by a DESKTOP OLDER THAN IT — the decide schema's three echo fields are
 *     OPTIONAL precisely so such a machine can still report (INVARIANTS §13: an older peer is
 *     supported), and it sends none of them.
 * So a render that read `null` as agreement would tell an orchestrator its posture landed on the
 * strength of a column nobody filled in, and it would then size the work for room the agent may
 * not have. ⚠ AND THE FALLBACK IS THE WORD, NEVER A GUESS: echoing `startToolMode` back would be
 * right whenever nothing was clamped and confidently wrong exactly when it mattered.
 */

import { describe, it, expect } from "vitest";
import type { LaunchDirective } from "@dopl/client";
import { postureFacts } from "./channel-ops-launch";

/** A decided directive. ⚠ The three echo fields default to `null`, which is what `toDirective`
 *  really hands back — `undefined` is not a shape this render ever sees. */
function directive(over: Partial<LaunchDirective> = {}): LaunchDirective {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    channelId: "chan-1",
    threadId: null,
    goal: "ship the parser",
    model: null,
    status: "launched",
    templateId: null,
    templateName: null,
    refusalReason: null,
    agentId: "a1b2c3d4",
    claimedAt: null,
    decidedAt: null,
    expiresAt: "2026-08-22T12:02:00.000Z",
    createdAt: "2026-08-22T12:00:00.000Z",
    appliedToolMode: null,
    appliedMessageMode: null,
    appliedChain: null,
    ...over,
  } as LaunchDirective;
}

describe("postureFacts", () => {
  it("🔒 SAYS `not reported`, IN WORDS, WHEN ALL THREE ARE NULL — the older-desktop row", () => {
    // ⚠ THE CASE THAT MUST SURVIVE THE WRITER LANDING. Deleting it would let a later refactor
    // start printing the REQUEST here, which is the one claim this lane cannot make.
    expect(postureFacts(directive())).toEqual({
      posture: "not reported",
      chain: "not reported",
    });
  });

  it("prints `posture=<tools>/<messages> chain=on|off` when the machine DID report", () => {
    // ⚠ THE SHAPE IS FIXED because it is read by a model choosing its next action, and a line that
    // changes shape between calls gets parsed by guesswork.
    expect(
      postureFacts(
        directive({
          appliedToolMode: "auto",
          appliedMessageMode: "auto_inbound",
          appliedChain: true,
        }),
      ),
    ).toEqual({ posture: "auto/auto_inbound", chain: "on" });
  });

  it("🔒 `chain=off` for a reported false — and `off` is NOT what a null renders as", () => {
    // ⚠ THE DISTINCTION THE WHOLE TRIO EXISTS FOR. `false` is "this session may not launch
    // workers", which an orchestrator acts on; `null` is "nobody said", which it must not.
    // Reading null as `off` is wrong in the direction that makes it do the work itself for no
    // reason; reading false as null is wrong in the direction that makes it wait for workers.
    expect(postureFacts(directive({ appliedChain: false })).chain).toBe("off");
    expect(postureFacts(directive({ appliedChain: null })).chain).toBe("not reported");
    expect(postureFacts(directive({ appliedChain: false })).chain).not.toBe(
      postureFacts(directive()).chain,
    );
  });

  it("a PARTIAL report shows `-` for the axis that was not reported", () => {
    // ⚠ FILLING THE GAP FROM THE REQUEST WOULD PUT AN UNCONFIRMED VALUE BESIDE A CONFIRMED ONE,
    // indistinguishable. Partial is a real shape and it is rendered as one.
    expect(postureFacts(directive({ appliedToolMode: "bypass" }))).toEqual({
      posture: "bypass/-",
      chain: "not reported",
    });
    expect(postureFacts(directive({ appliedMessageMode: "ask" })).posture).toBe("-/ask");
  });

  it("⚠ NEVER echoes the REQUEST back — a clamped launch that reported nothing still says so", () => {
    // The row asked for the widest pair and the machine said nothing about what it applied. The
    // ONLY honest answer is silence; printing `bypass/auto_both` here is the bug this file names.
    const asked = directive({
      startToolMode: "bypass",
      startMessageMode: "auto_both",
      chain: true,
    } as Partial<LaunchDirective>);
    expect(postureFacts(asked)).toEqual({
      posture: "not reported",
      chain: "not reported",
    });
  });

  it("a REPORTED posture that differs from the request is rendered as the APPLIED one", () => {
    // ⚠ F-410 CLOSED, AT THE RENDER. The orchestrator asked for `bypass`/`auto_both`; the
    // operator's ceiling clamped it; the machine said so; this line is where the caller finds out.
    const clamped = directive({
      startToolMode: "bypass",
      startMessageMode: "auto_both",
      appliedToolMode: "accept_edits",
      appliedMessageMode: "auto_inbound",
      appliedChain: false,
    } as Partial<LaunchDirective>);
    expect(postureFacts(clamped)).toEqual({
      posture: "accept_edits/auto_inbound",
      chain: "off",
    });
  });
});
