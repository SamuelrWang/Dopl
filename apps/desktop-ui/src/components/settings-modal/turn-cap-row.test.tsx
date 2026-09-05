// @vitest-environment jsdom
/**
 * THE PER-MACHINE TURN CAP ROW (2026-09-05).
 *
 * The properties that fail SILENTLY, which is what this file is for:
 *
 *  - **UNSET AND 0 ARE OPPOSITES AND MUST NEVER RENDER ALIKE.** `null` means the
 *    issuer-keyed defaults still apply (`main/session-state.js` owns the two
 *    numbers; the fixtures below are examples, not the authority); `0` means no
 *    cap at all. A
 *    control that collapses them tells the operator their machine is capped when
 *    it is not, or the reverse — and both are invisible until an agent runs away.
 *  - **A HALF-PRESENT BRIDGE IS NOT A BRIDGE.** "Has the getter, has no setter"
 *    is a real build shape while the desktop side ships, and an input that reads
 *    but cannot write is worse than no row.
 *  - **MAIN'S ANSWER WINS, INCLUDING ON REFUSAL.** The envelope answers a VALUE,
 *    not an echo, so a rejected write must leave the machine's real posture on
 *    screen rather than the number the operator typed.
 *  - ⚠ **THE BRIDGE SHAPE IS AGREED, NOT YET DECLARED** (see the hook's header).
 *    These cases pin the shape this tree CALLS, so the day the real ops land a
 *    mismatch is a red test rather than a dead row.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TurnCapRow } from "./turn-cap-row";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

/**
 * ⚠ THE SHIPPED ENVELOPE, not the ruled one: main also sends the two
 * issuer-keyed defaults, so the SPA never spells them itself.
 *
 * ⚠ **A FIXTURE, NOT AN AUTHORITY.** These are the values
 * `main/session-state.js` holds at time of writing; nothing here pins them, and
 * the `40`/`8` case below exists precisely to prove the row renders whatever
 * main sends rather than these. If the real defaults move, this fixture is
 * merely out of date — the row is not.
 */
const DEFAULTS = { operatorDefault: 200, agentDefault: 24 };

function installBridge(
  cap: number | null,
  over: Record<string, unknown> = {}
) {
  const get = vi.fn().mockResolvedValue({ cap, ...DEFAULTS });
  const set = vi.fn().mockResolvedValue({ ok: true, cap, ...DEFAULTS });
  const turnCap = { get, set, ...over };
  (window as { dopl?: unknown }).dopl = { apiRequest: vi.fn(), turnCap };
  return turnCap as unknown as {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };
}

async function mount() {
  await act(async () => {
    render(<TurnCapRow />);
  });
}

const input = () => screen.getByLabelText(/Turn cap/) as HTMLInputElement;

/** Type `value` and commit it the way the row commits — blur. */
function typeAndCommit(value: string) {
  fireEvent.change(input(), { target: { value } });
  fireEvent.blur(input());
}

describe("bridge detection — capability-keyed, never truthiness", () => {
  it("renders NOTHING in a plain browser", async () => {
    await mount();
    expect(screen.queryByLabelText(/Turn cap/)).toBeNull();
  });

  /** ⚠ A row that can read but not write is worse than no row. */
  it("renders NOTHING when main has the getter but no setter", async () => {
    installBridge(null, { set: undefined });
    await mount();
    expect(screen.queryByLabelText(/Turn cap/)).toBeNull();
  });
});

describe("the three states are three different truths", () => {
  it("shows UNSET as an empty box naming both issuer-keyed defaults", async () => {
    installBridge(null);
    await mount();

    expect(input().value).toBe("");
    // Both defaults, because which one applies depends on who launched it.
    expect(
      screen.getByText(
        /Unset\. Sessions you launch stop after 200 turns; agent-issued sessions stop after 24\./
      )
    ).toBeInTheDocument();
  });

  /**
   * 🔒 **THE NUMBERS ARE MAIN'S, AND THIS IS THE CASE THAT PROVES IT.** The two
   * defaults are pinned to one statement each in the desktop tree
   * (`main/session-state.js`, guarded by `test/turn-cap-issuer.test.mjs`); if
   * this bundle spelled them, that would be a second statement no guard
   * watches. A build that does not send them must therefore name NO number
   * rather than fall back to a literal — a wrong default stated confidently is
   * worse than a vague one.
   */
  it("names no number when main did not send the defaults", async () => {
    installBridge(null, { get: vi.fn().mockResolvedValue({ cap: null }) });
    await mount();

    expect(
      screen.getByText("Unset. The built-in per-session defaults apply.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/200/)).toBeNull();
  });

  /** ⚠ Main's numbers are RENDERED, not assumed — a retune reaches the row. */
  it("renders whatever defaults main reports, not baked-in ones", async () => {
    installBridge(null, {
      get: vi
        .fn()
        .mockResolvedValue({ cap: null, operatorDefault: 40, agentDefault: 8 }),
    });
    await mount();

    expect(
      screen.getByText(
        /Sessions you launch stop after 40 turns; agent-issued sessions stop after 8\./
      )
    ).toBeInTheDocument();
  });

  /**
   * 🔒 THE CASE THE WHOLE ROW EXISTS FOR. `0` is UNLIMITED, and it must not read
   * as "unset" or as "capped at zero" — an empty box here would be a lie in the
   * safest-looking direction.
   */
  it("shows 0 as UNLIMITED, distinct from unset", async () => {
    installBridge(0);
    await mount();

    expect(input().value).toBe("0");
    expect(screen.getByText(/Unlimited\./)).toBeInTheDocument();
    expect(screen.queryByText(/Unset\./)).toBeNull();
  });

  it("shows a positive cap as the number of turns", async () => {
    installBridge(12);
    await mount();

    expect(input().value).toBe("12");
    expect(
      screen.getByText(/stops after 12 turns/)
    ).toBeInTheDocument();
  });
});

describe("writing through", () => {
  it("stores a typed cap and adopts what main answers", async () => {
    const bridge = installBridge(null);
    bridge.set.mockResolvedValue({ ok: true, cap: 50 });
    await mount();

    await act(async () => {
      typeAndCommit("50");
    });

    expect(bridge.set).toHaveBeenCalledWith(50);
    expect(screen.getByText(/stops after 50 turns/)).toBeInTheDocument();
  });

  it("clears back to unset on an empty box", async () => {
    const bridge = installBridge(30);
    bridge.set.mockResolvedValue({ ok: true, cap: null, ...DEFAULTS });
    await mount();

    await act(async () => {
      typeAndCommit("");
    });

    expect(bridge.set).toHaveBeenCalledWith(null);
    expect(screen.getByText(/Unset\./)).toBeInTheDocument();
  });

  /**
   * 🔒 **THE REFUSAL CASE — MAIN'S VALUE WINS, NOT THE OPERATOR'S INTENT.** The
   * envelope answers what main HOLDS after the write, so a rejected cap must
   * disappear from the box. Leaving `999` on screen would tell the operator
   * their machine is capped at a number it never stored.
   */
  it("snaps back to main's own value when the store refuses", async () => {
    const bridge = installBridge(24);
    // ⚠ The shipped refusal shape, verbatim: `reason:"store"` and the defaults
    // ride along, so a refused write stays byte-identical to a fresh read.
    bridge.set.mockResolvedValue({
      ok: false,
      reason: "store",
      cap: 24,
      ...DEFAULTS,
    });
    await mount();

    await act(async () => {
      typeAndCommit("999");
    });

    expect(input().value).toBe("24");
    expect(screen.getByText(/stops after 24 turns/)).toBeInTheDocument();
  });

  /** ⚠ A cap the operator did not type must never be stored — `parseInt` would
   *  have answered 12 here. */
  it("refuses junk without writing anything", async () => {
    const bridge = installBridge(null);
    await mount();

    await act(async () => {
      typeAndCommit("12abc");
    });

    expect(bridge.set).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  /** No write when nothing changed — an idle blur is not an edit. */
  it("does not write when the value is unchanged", async () => {
    const bridge = installBridge(8);
    await mount();

    await act(async () => {
      fireEvent.blur(input());
    });

    expect(bridge.set).not.toHaveBeenCalled();
  });
});
