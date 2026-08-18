/**
 * The calm-terminal read, on its own.
 *
 * ⚠ REWRITTEN OUT OF `group-thread-status.test.ts`, WHICH IS DELETED WITH ITS
 * FEATURE (wiring plan Phase 5, 2026-08-18 — INVARIANTS §14: a mixed test file
 * whose feature is deleted is rewritten, never removed). That file asserted the
 * calm rules THROUGH `groupThread`'s session status, so its cases died with the
 * grouper; the rules themselves did not, because `message-receipt.ts` still
 * reads them off rows two surviving desktop writers still post
 * (`main/trigger-outcomes.js`, plus every installed build). ⚠ `activity-event-row.tsx`
 * was the SECOND reader and went with the two-pane page at the v2 cutover
 * (2026-08-18), so this file now pins the rules for ONE caller.
 *
 * What is pinned here is exactly what that caller depends on: the strict
 * `=== true` rule, the kind gate, and the request-level-first precedence.
 */

import { describe, expect, it } from "vitest";
import { calmTerminalStatus } from "./calm-terminal";
import type { ChannelMessage, ChannelMessageKind } from "../types";

let seq = 0;

function msg(
  kind: ChannelMessageKind,
  metadata: Record<string, unknown>
): ChannelMessage {
  seq += 1;
  return {
    id: `m${seq}`,
    channelId: "c1",
    seq,
    kind,
    authorKind: "agent",
    authorUserId: "u1",
    authorName: "Agent",
    authorAvatarUrl: null,
    body: "",
    metadata,
    createdAt: new Date(1700000000000 + seq * 1000).toISOString(),
  } as ChannelMessage;
}

describe("calmTerminalStatus", () => {
  it("reads each calm flag off a task_failed row", () => {
    expect(calmTerminalStatus(msg("task_failed", { declined: true }))).toBe("declined");
    expect(calmTerminalStatus(msg("task_failed", { dropped: true }))).toBe("dropped");
    expect(calmTerminalStatus(msg("task_failed", { interrupted: true }))).toBe("interrupted");
    expect(calmTerminalStatus(msg("task_failed", { capped: true }))).toBe("capped");
    expect(calmTerminalStatus(msg("task_failed", { ended: true }))).toBe("ended");
  });

  it("answers null for an UNFLAGGED task_failed — that is a real failure", () => {
    // The whole point of the read: `null` is what makes the receipt say "Failed"
    // and the activity dot go danger-red.
    expect(calmTerminalStatus(msg("task_failed", {}))).toBeNull();
  });

  it("is STRICT === true — a truthy value must not disguise a real failure", () => {
    // ⚠ `metadata` is an unbounded z.record on the wire, so these are all values
    // a caller can set. Softening any of them paints a genuine crash calm.
    for (const value of ["yes", 1, {}, [], "true"]) {
      expect(calmTerminalStatus(msg("task_failed", { dropped: value }))).toBeNull();
      expect(calmTerminalStatus(msg("task_failed", { declined: value }))).toBeNull();
    }
    expect(calmTerminalStatus(msg("task_failed", { ended: false }))).toBeNull();
  });

  it("checks the KIND too — a calm flag on any other row declares nothing", () => {
    // A flag laundered onto a non-terminal (or a success) row must not be read
    // as an ending. `task_progress` in particular carries `session_ended`, which
    // this read has never answered for and must not start answering for.
    for (const kind of ["message", "task_started", "task_progress", "task_finished", "system"] as const) {
      expect(calmTerminalStatus(msg(kind, { declined: true }))).toBeNull();
      expect(calmTerminalStatus(msg(kind, { session_ended: true }))).toBeNull();
    }
  });

  it("puts the REQUEST-LEVEL decisions first — declined outranks a later stop flag", () => {
    // "The work never ran" beats "the run stopped this way": the receipt must
    // report Declined, not Interrupted, when a denied request's row carries both.
    expect(
      calmTerminalStatus(msg("task_failed", { declined: true, interrupted: true, capped: true }))
    ).toBe("declined");
    expect(calmTerminalStatus(msg("task_failed", { dropped: true, ended: true }))).toBe("dropped");
    expect(calmTerminalStatus(msg("task_failed", { interrupted: true, ended: true }))).toBe(
      "interrupted"
    );
  });
});
