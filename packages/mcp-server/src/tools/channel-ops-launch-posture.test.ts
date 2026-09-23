// `postureFacts`: a `null` echo (every older desktop, INVARIANTS §13) renders "not reported",
// never agreement and never the request echoed back.

import { describe, it, expect } from "vitest";
import type { LaunchDirective } from "@dopl/client";
import { postureFacts } from "./channel-facts";
import { launched } from "./launch-fixtures";

/** A decided directive; the echo fields default to `null`, which is what `toDirective` hands back. */
const directive = (over: Partial<LaunchDirective> = {}): LaunchDirective =>
  launched({ appliedToolMode: null, appliedMessageMode: null, appliedChain: null, ...over });

describe("postureFacts", () => {
  it("SAYS `not reported`, IN WORDS, WHEN ALL THREE ARE NULL — the older-desktop row", () => {
    // An older desktop sends no echo; printing the request here is the one claim this lane cannot make.
    expect(postureFacts(directive())).toEqual({
      posture: "not reported",
      chain: "not reported",
    });
  });

  it("prints `posture=<tools>/<messages> chain=on|off` when the machine DID report", () => {
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

  it("`chain=off` for a reported false — and `off` is NOT what a null renders as", () => {
    // `false` forbids launching workers; `null` is "nobody said". Conflating them misleads either way.
    expect(postureFacts(directive({ appliedChain: false })).chain).toBe("off");
    expect(postureFacts(directive({ appliedChain: null })).chain).toBe("not reported");
    expect(postureFacts(directive({ appliedChain: false })).chain).not.toBe(
      postureFacts(directive()).chain,
    );
  });

  it("a PARTIAL report shows `-` for the axis that was not reported", () => {
    // Filling the gap from the request would put an unconfirmed value beside a confirmed one.
    expect(postureFacts(directive({ appliedToolMode: "bypass" }))).toEqual({
      posture: "bypass/-",
      chain: "not reported",
    });
    expect(postureFacts(directive({ appliedMessageMode: "ask" })).posture).toBe("-/ask");
  });

  it("NEVER echoes the REQUEST back — a clamped launch that reported nothing still says so", () => {
    // The row asked for the widest pair and the machine reported nothing: the only honest answer is silence.
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
    // The operator's ceiling clamped the ask; this line is where the caller finds out (F-410).
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

  // The retired `resolved*` group copied the request (and a Claude model id), so it is never printed.
  it("prints nothing from the retired server-resolved group", () => {
    const old = directive({
      appliedToolMode: "on-request",
      appliedMessageMode: "auto_both",
      appliedChain: false,
      resolvedToolMode: "never",
      resolvedMessageMode: "auto_both",
      resolvedChain: true,
      resolvedModel: "claude-opus-5",
    } as Partial<LaunchDirective>);
    expect(postureFacts(old)).toEqual({ posture: "on-request/auto_both", chain: "off" });
  });
});
