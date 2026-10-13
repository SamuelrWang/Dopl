/**
 * **EVERY CHANNEL ERROR MAPS TO A STATUS A CLIENT CAN ACT ON** (Review 40,
 * 2026-10-12).
 *
 * ⚠ **THIS GATE EXISTS BECAUSE AN ERROR WITH NO ARM IS NOT A 4xx WITH A BAD CODE
 * — IT IS A 500.** `ChannelCursorUndecodableError` shipped in B6-1 with no entry
 * in `mapChannelError`, so it fell through to the generic handler and surfaced as
 * a server error. Measured before the fix: **status 500**. That is the single
 * worst outcome for this particular error, because 500 is the one status a client
 * is entitled to RETRY — and retrying an undecodable cursor can never succeed, so
 * the loop would be indefinite and silent.
 *
 * ⚠ **IT ENUMERATES THE MODULE RATHER THAN LISTING NAMES**, so the NEXT error
 * class is covered the day it is written and nobody has to remember this file.
 * `errors.ts` re-exports `errors-recipient.ts`, so one module is the whole set.
 *
 * ⚠ **AND IT FAILS CLOSED.** A gate that enumerates nothing passes over
 * everything, which is how a scan-based test rots into decoration: the floor below
 * refuses a run that found fewer classes than the tree is known to have.
 */

import { describe, it, expect } from "vitest";

import { ChannelError } from "./errors-base";
import { toChannelErrorResponse } from "./http-mapping";
import * as errors from "./errors";

/**
 * Enough arg shapes to construct every class in the module.
 *
 * ⚠ **A CLASS THIS CANNOT BUILD IS A HOLE, NOT A SKIP**, and the assertion below
 * says so: three recipient errors take `(string, string[])` or `(string[])` and
 * were silently unconstructible on a first pass, which would have excused them
 * from the very check they need.
 */
const ARG_SHAPES: readonly unknown[][] = [
  [],
  ["x"],
  ["x", "y"],
  [["a"]],
  ["x", ["a"]],
  ["x", ["a"], "y"],
  // `ChannelRecipientUnresolvedError(to, liveHandles, members, detail?)` — three
  // required args, two of them arrays. It was the one class no earlier shape built,
  // which is precisely the hole the construction check above refuses to let pass.
  ["x", ["a"], ["b"]],
  ["x", ["a"], ["b"], "detail"],
  [1],
  [{ seq: 1 }],
];

type ErrorCtor = new (...args: unknown[]) => Error;

function construct(Cls: ErrorCtor): Error | null {
  for (const args of ARG_SHAPES) {
    try {
      return new Cls(...args);
    } catch {
      // try the next shape
    }
  }
  return null;
}

/** Measured 2026-10-12: 36 exported `ChannelError` subclasses in this module. */
const KNOWN_CLASS_FLOOR = 30;

/**
 * ⚠ **NO TYPE PREDICATE HERE, DELIBERATELY.** `typeof errors` is a union of 36
 * concrete class types, and a predicate narrowing to a generic
 * `new (...args: unknown[]) => Error` is not assignable to it — `tsc` refuses,
 * while vitest runs it happily. (It did: this file was green and the typecheck
 * red at the same time, for the second time in this branch.) Mapping to the
 * shape the test needs is both honest and checkable.
 */
const classes: readonly [string, ErrorCtor][] = Object.entries(errors)
  .filter(
    ([, v]) =>
      typeof v === "function" &&
      (v as { prototype?: unknown }).prototype instanceof ChannelError,
  )
  .map(([name, v]) => [name, v as unknown as ErrorCtor]);

describe("mapChannelError covers the module", () => {
  it("🔒 it enumerated a real set — a scan over nothing passes over everything", () => {
    expect(classes.length).toBeGreaterThanOrEqual(KNOWN_CLASS_FLOOR);
  });

  it("🔒 every class can be CONSTRUCTED — an unbuildable class is an unchecked one", () => {
    const unbuildable = classes
      .filter(([, Cls]) => construct(Cls) === null)
      .map(([name]) => name);
    expect(
      unbuildable,
      "add an arg shape to ARG_SHAPES; skipping the class would excuse it from the " +
        "status check below, which is the only check it needs",
    ).toEqual([]);
  });

  it("🔒 NO class maps to 500 — a 500 is the one status a client may retry", () => {
    const unmapped = classes
      .map(([name, Cls]) => ({ name, err: construct(Cls) }))
      .filter((row) => row.err !== null)
      .map((row) => ({ name: row.name, status: toChannelErrorResponse(row.err!).status }))
      .filter((row) => row.status >= 500)
      .map((row) => `${row.name} → ${row.status}`);
    expect(
      unmapped,
      "each of these reaches the generic handler because `mapChannelError` has no " +
        "arm for it. Add one: a 4xx with its own code and a remedy the caller can " +
        "act on. 500 invites a retry that can never succeed.",
    ).toEqual([]);
  });

  it("🔒 the cursor error specifically is a 400 with its own code", () => {
    // Named because it is the class whose absence prompted this file.
    const res = toChannelErrorResponse(new errors.ChannelCursorUndecodableError());
    expect(res.status).toBe(400);
  });

  it("🔒 and its message carries the REMEDY, not just the diagnosis", () => {
    // A 400 that only says "bad cursor" leaves an agent with no next move; the
    // remedy is the half that makes the refusal actionable (ASK 11).
    const err = new errors.ChannelCursorUndecodableError();
    expect(err.message).toMatch(/without a cursor/i);
    expect(err.message).toMatch(/unscoped/i);
  });
});
