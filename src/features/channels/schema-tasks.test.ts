/**
 * THE TASK SCHEMAS — the create, the REQUEST FAN-OUT, the one POST that accepts
 * both, and the update union.
 *
 * ⚠ Split out of `schema.test.ts` when the fan-out arm landed (wiring plan
 * Phase 3), and split HERE rather than anywhere else because these four move
 * together: a thread is one requester plus one target, so any change to what a
 * caller may ASK for lands across all of them at once.
 */

import { describe, expect, it } from "vitest";
import {
  TaskCreatePayloadSchema,
  TaskCreateSchema,
  TaskFanOutSchema,
  TaskUpdateSchema,
  isTaskFanOutInput,
} from "./schema";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("TaskCreateSchema", () => {
  const base = { title: "Ship it", body: "please do X", toUserId: UUID };

  it("accepts a minimal valid create (title + body + toUserId)", () => {
    expect(TaskCreateSchema.safeParse(base).success).toBe(true);
  });

  it("title: trimmed, 1..200 chars", () => {
    expect(TaskCreateSchema.safeParse({ ...base, title: "" }).success).toBe(false);
    expect(TaskCreateSchema.safeParse({ ...base, title: "   " }).success).toBe(false);
    expect(TaskCreateSchema.safeParse({ ...base, title: "a".repeat(200) }).success).toBe(true);
    expect(TaskCreateSchema.safeParse({ ...base, title: "a".repeat(201) }).success).toBe(false);
  });

  it("body: 1..16000 chars; toUserId must be a UUID", () => {
    expect(TaskCreateSchema.safeParse({ ...base, body: "" }).success).toBe(false);
    expect(TaskCreateSchema.safeParse({ ...base, toUserId: "x" }).success).toBe(false);
  });

  it("mode: optional interactive|autonomous only", () => {
    expect(TaskCreateSchema.safeParse({ ...base, mode: "interactive" }).success).toBe(true);
    expect(TaskCreateSchema.safeParse({ ...base, mode: "autonomous" }).success).toBe(true);
    expect(TaskCreateSchema.safeParse({ ...base, mode: "turbo" }).success).toBe(false);
  });

  /**
   * ⚠ `participants` (breakout rooms) REFUSED rather than dropped: a
   * silently-ignored participant list is a room the caller believes is wider
   * than it is.
   */
  it("REFUSES participants with a message, not silence", () => {
    const parsed = TaskCreateSchema.safeParse({
      ...base,
      participants: [{ kind: "agent", id: UUID }],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].path).toEqual(["participants"]);
    expect(parsed.error?.issues[0].message).toMatch(/removed/i);
  });
});

describe("TaskFanOutSchema — the request fan-out's shape", () => {
  const UUID_B = "660e8400-e29b-41d4-a716-446655440111";
  const base = {
    title: "Sweep the docs",
    body: "start here",
    toUserIds: [UUID],
    clientMsgId: "base-1",
  };

  it("accepts a minimal fan-out", () => {
    expect(TaskFanOutSchema.safeParse(base).success).toBe(true);
    expect(
      TaskFanOutSchema.safeParse({ ...base, toUserIds: [UUID, UUID_B] }).success
    ).toBe(true);
  });

  /**
   * ⚠ THE FAIL-CLOSED HALF, ON THE SERVER SIDE. The composer already disables
   * Send at zero pills — that is a courtesy. This is the contract: a request
   * addressed to nobody is a 400, never an empty success that reports a raised
   * request nobody received.
   */
  it("REFUSES an empty addressee list", () => {
    const parsed = TaskFanOutSchema.safeParse({ ...base, toUserIds: [] });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].path).toEqual(["toUserIds"]);
  });

  it("bounds the addressee list and requires UUIDs", () => {
    expect(
      TaskFanOutSchema.safeParse({ ...base, toUserIds: ["nope"] }).success
    ).toBe(false);
    expect(
      TaskFanOutSchema.safeParse({
        ...base,
        toUserIds: Array.from({ length: 26 }, () => UUID),
      }).success
    ).toBe(false);
  });

  /** ⚠ REQUIRED here, optional on the single-target create: it is the BASE the
   *  per-addressee keys and the group id are both derived from. */
  it("requires clientMsgId, bounded well under the derived key's own cap", () => {
    const noKey: Record<string, unknown> = { ...base };
    delete noKey.clientMsgId;
    expect(TaskFanOutSchema.safeParse(noKey).success).toBe(false);
    expect(
      TaskFanOutSchema.safeParse({ ...base, clientMsgId: "a".repeat(121) })
        .success
    ).toBe(false);
  });
});

describe("TaskCreatePayloadSchema — one POST, two shapes", () => {
  it("routes a toUserIds body to the FAN-OUT arm", () => {
    const parsed = TaskCreatePayloadSchema.safeParse({
      title: "Sweep",
      body: "go",
      toUserIds: [UUID],
      clientMsgId: "base-1",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data && isTaskFanOutInput(parsed.data)).toBe(true);
  });

  it("routes a toUserId body to the SINGLE-TARGET arm, untouched", () => {
    const parsed = TaskCreatePayloadSchema.safeParse({
      title: "Ship it",
      body: "please do X",
      toUserId: UUID,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data && isTaskFanOutInput(parsed.data)).toBe(false);
  });

  it("refuses a body that names neither", () => {
    expect(
      TaskCreatePayloadSchema.safeParse({ title: "x", body: "y" }).success
    ).toBe(false);
  });
});

describe("TaskUpdateSchema", () => {
  it("set_mode: requires mode interactive|autonomous", () => {
    expect(TaskUpdateSchema.safeParse({ op: "set_mode", mode: "interactive" }).success).toBe(true);
    expect(TaskUpdateSchema.safeParse({ op: "set_mode" }).success).toBe(false);
  });

  // ⚠ THE OTHER THREE OPS ARE GONE (wiring plan Phase 4, 2026-08-18): `close`
  // and `propose_close` each carried an outcome, `reopen` was a bare op. This is
  // the pin that they stay gone, and that a stale caller sending one is REFUSED
  // rather than silently reaching `set_mode`.
  //
  // ⚠ AND THAT THE REFUSAL SAYS WHAT REPLACED THEM. Deleting the arms outright
  // left zod answering `invalid_union` / "No matching discriminator", whose
  // message is the literal "Invalid input" — an installed desktop asking to
  // close a thread was told its body was malformed and had nothing to act on.
  // `schema.ts › removedOp` is the op-level form of the `removedParam` pattern
  // this file already relies on elsewhere.
  it.each(["close", "propose_close", "reopen"])(
    "refuses the retired op %s, NAMING the replacement",
    (op) => {
      for (const body of [{ op }, { op, outcome: "completed" }]) {
        const parsed = TaskUpdateSchema.safeParse(body);
        expect(parsed.success).toBe(false);
        const message = parsed.error?.issues[0]?.message ?? "";
        expect(message).toBe(
          "Threads no longer close; pause or end the agent instead."
        );
        // The regression this guards: the generic 400 it used to be.
        expect(message).not.toBe("Invalid input");
      }
    }
  );

  it("discriminated union: fields can't bleed across ops", () => {
    // Wrong op's field is stripped; a set_mode without `mode` still fails.
    expect(TaskUpdateSchema.safeParse({ op: "set_mode", outcome: "completed" }).success).toBe(false);
    expect(TaskUpdateSchema.safeParse({ op: "bogus", mode: "interactive" }).success).toBe(false);
  });
});
