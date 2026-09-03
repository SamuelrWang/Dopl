/**
 * 🔒 THE POLL GUARDRAIL, PROVED — `channel-poll-detector.ts` and the two read
 * ops that carry it (Samuel's ruling, 2026-09-03).
 *
 * ⚠ **EVERY CASE HERE IS MUTATION-VERIFIED.** Each `it` was re-run against a
 * deliberately broken detector before it was kept, and the mutation that each
 * one catches is named in its own comment — a strike test that still passes
 * when the counter never increments is not a test, and this file's whole
 * purpose is a counter nobody looks at until it fires.
 *
 * ⚠ **THE STATE IS MODULE-LEVEL**, so `resetPollDetectorForTests` runs before
 * every case. Without it the first case's strikes decide the second's verdict
 * and the file passes for the wrong reason.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { opRead } from "./channel-ops-read";
import { opReadAccount } from "./channel-ops-account";
import { opHold } from "./channel-ops-hold";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { UNKNOWN_CALLER, DESKTOP_SESSION_RUNTIME, type CallerIdentity } from "./identity";
import {
  ACCOUNT_SCOPE,
  MAX_TRACKED_SUBJECTS,
  noteHold,
  notePollingRead,
  pollSubject,
  POLL_STRIKE_LIMIT,
  POLL_STRIKE_WINDOW_MS,
  resetPollDetectorForTests,
} from "./channel-poll-detector";

beforeEach(() => resetPollDetectorForTests());

const SUBJECT = "u-me|device|Laptop";
const REF = "general";

/** A caller shaped like an EXTERNAL MCP client: no runtime stamp, no lock. */
function external(over: Partial<CallerIdentity> = {}): CallerIdentity {
  return { ...UNKNOWN_CALLER, userId: "u-me", credentialKind: "device", credentialLabel: "Laptop", ...over };
}

// ── the counter itself ───────────────────────────────────────────────────

describe("the detector counts the shape of a timer, and nothing else", () => {
  it(`trips on the ${POLL_STRIKE_LIMIT}rd empty read of one cursor, not before`, () => {
    // ⚠ MUTATION: `>= POLL_STRIKE_LIMIT` → `> POLL_STRIKE_LIMIT` fails the last
    // line; `>=` → `>= 2` fails the second. The bound is asserted from BOTH
    // sides, so neither direction can drift silently.
    expect(notePollingRead(SUBJECT, REF, 7)).toBe(false);
    expect(notePollingRead(SUBJECT, REF, 7)).toBe(false);
    expect(notePollingRead(SUBJECT, REF, 7)).toBe(true);
  });

  it("keeps a SEPARATE count per cursor — a moved cursor is a new observation", () => {
    // ⚠ MUTATION: dropping `since` from the key makes this trip on the third
    // call. A caller whose cursor advances is being answered, not polling.
    expect(notePollingRead(SUBJECT, REF, 7)).toBe(false);
    expect(notePollingRead(SUBJECT, REF, 8)).toBe(false);
    expect(notePollingRead(SUBJECT, REF, 9)).toBe(false);
  });

  it("keeps a SEPARATE count per channel and per credential", () => {
    // ⚠ MUTATION: dropping either half of the key trips this on the third call
    // — and the credential half is the one that would make one busy account's
    // reads accuse another account entirely.
    expect(notePollingRead(SUBJECT, "general", 7)).toBe(false);
    expect(notePollingRead(SUBJECT, "ops", 7)).toBe(false);
    expect(notePollingRead("u-other|device|Laptop", "general", 7)).toBe(false);
  });

  it("forgets strikes that fell out of the window", () => {
    // ⚠ MUTATION: removing the `filter` on `entry.at` makes the third call trip
    // — three reads an hour apart are a person checking in, not a timer.
    const t0 = 1_000_000;
    expect(notePollingRead(SUBJECT, REF, 7, t0)).toBe(false);
    expect(notePollingRead(SUBJECT, REF, 7, t0 + POLL_STRIKE_WINDOW_MS + 1)).toBe(false);
    expect(notePollingRead(SUBJECT, REF, 7, t0 + 2 * POLL_STRIKE_WINDOW_MS + 2)).toBe(false);
  });

  it("expires a strike whose entry is still live — the per-strike clock, not the entry's", () => {
    // ⚠ MUTATION: deleting the `entry.at` filter passes every other case here,
    // because `sweep` already drops an entry nothing touched for a window. This
    // is the case only the per-strike filter catches: the entry is touched
    // throughout, so it never sweeps, while its OLDEST strike ages out. Without
    // it a caller reading once every 9 minutes trips on the third read — which
    // is a person checking in, not a timer.
    const t0 = 1_000_000;
    const step = POLL_STRIKE_WINDOW_MS - 60_000;
    expect(notePollingRead(SUBJECT, REF, 7, t0)).toBe(false);
    expect(notePollingRead(SUBJECT, REF, 7, t0 + step)).toBe(false);
    expect(notePollingRead(SUBJECT, REF, 7, t0 + 2 * step)).toBe(false);
  });

  it("still trips when the strikes are spread across the window but inside it", () => {
    // ⚠ THE OTHER SIDE OF THE SAME BOUND. Without it a too-eager expiry (say,
    // one minute) would pass the case above and disable the detector entirely.
    const t0 = 1_000_000;
    expect(notePollingRead(SUBJECT, REF, 7, t0)).toBe(false);
    expect(notePollingRead(SUBJECT, REF, 7, t0 + POLL_STRIKE_WINDOW_MS / 2)).toBe(false);
    expect(notePollingRead(SUBJECT, REF, 7, t0 + POLL_STRIKE_WINDOW_MS - 1)).toBe(true);
  });

  it("is bounded — a caller cycling cursors cannot grow the process", () => {
    // ⚠ MUTATION: deleting the size cap in `sweep` lets this allocate forever.
    // The key contains a CALLER-SUPPLIED cursor, so the bound is a fence and
    // not tidiness. Evicting only ever loses strikes, which is the safe way to
    // be wrong.
    const now = 1_000_000;
    for (let i = 0; i < MAX_TRACKED_SUBJECTS + 500; i++) {
      notePollingRead(SUBJECT, REF, i, now);
    }
    // The oldest keys were evicted, so the FIRST cursor starts over rather than
    // carrying a strike — provable from the outside without exporting the map.
    expect(notePollingRead(SUBJECT, REF, 0, now)).toBe(false);
    expect(notePollingRead(SUBJECT, REF, 0, now)).toBe(false);
  });
});

// ── the reset ────────────────────────────────────────────────────────────

describe("a hold RESETS the count — the caller did the thing the rule asks", () => {
  it("clears strikes for that scope, and does not merely stop adding", () => {
    // ⚠ MUTATION: making `noteHold` a no-op leaves the third read tripping.
    // ⚠ MUTATION: making it merely "skip one strike" fails too — after a hold
    // the caller gets the FULL count back, because a caller that has held once
    // has demonstrably learned the shape.
    notePollingRead(SUBJECT, REF, 7);
    notePollingRead(SUBJECT, REF, 7);
    noteHold(SUBJECT, REF);
    expect(notePollingRead(SUBJECT, REF, 7)).toBe(false);
    expect(notePollingRead(SUBJECT, REF, 7)).toBe(false);
    expect(notePollingRead(SUBJECT, REF, 7)).toBe(true);
  });

  it("clears every cursor under that scope, not just the one held at", () => {
    // ⚠ MUTATION: keying the reset on the cursor clears nothing a caller can be
    // credited for — a hold's whole point is that it returns on a NEW cursor.
    notePollingRead(SUBJECT, REF, 7);
    notePollingRead(SUBJECT, REF, 8);
    noteHold(SUBJECT, REF);
    expect(notePollingRead(SUBJECT, REF, 7)).toBe(false);
    expect(notePollingRead(SUBJECT, REF, 8)).toBe(false);
  });

  it("does NOT clear another channel's strikes", () => {
    // ⚠ MUTATION: a prefix of `subject` alone (no scope) would let one held
    // channel excuse a timer running against every other room.
    notePollingRead(SUBJECT, "ops", 7);
    notePollingRead(SUBJECT, "ops", 7);
    noteHold(SUBJECT, "general");
    expect(notePollingRead(SUBJECT, "ops", 7)).toBe(true);
  });
});

// ── who is counted ───────────────────────────────────────────────────────

describe("pollSubject — the external-only fence, stated once", () => {
  it("is null for a desktop-stamped caller", () => {
    // ⚠ MUTATION: dropping the `isDesktopRun` branch accuses the one caller
    // that is REFUSED the hold outright (T85) of not holding.
    expect(pollSubject(external({ runtime: DESKTOP_SESSION_RUNTIME }))).toBeNull();
  });

  it("is null for a container-locked caller, even with no runtime header", () => {
    // ⚠ THE SECOND MARK. `containerId` rides the TOKEN ROW, so a desktop
    // session on an older build (no header) is still desktop-run.
    expect(pollSubject(external({ containerId: "c-1" }))).toBeNull();
  });

  it("is null when boot could not resolve who the caller is", () => {
    // ⚠ MUTATION: falling back to a literal keyed on "unknown" pools every such
    // caller into one subject and accuses whichever of them reads third.
    expect(pollSubject(external({ userId: null }))).toBeNull();
  });

  it("is the credential triple for an ordinary external caller", () => {
    expect(pollSubject(external())).toBe(SUBJECT);
  });
});

// ── the ops ──────────────────────────────────────────────────────────────

const MESSAGES = [
  {
    id: "m-1",
    seq: 42,
    kind: "message",
    body: "done",
    authorUserId: "u-peer",
    createdAt: "2026-07-31T00:00:00Z",
    metadata: {},
  },
];

function readClient(messages: unknown[] = []): DoplClient {
  return {
    readChannelMessages: vi.fn(async () => messages),
    // ⚠ Only the THREAD-scoped case reaches this; a 404 is the ordinary answer
    // for a tag with no row behind it and is what that case wants.
    getChannelThread: vi.fn(async () => {
      throw Object.assign(new Error("not found"), { status: 404 });
    }),
    listChannelMembers: vi.fn(async () => []),
  } as unknown as DoplClient;
}

const textOf = (r: { content: Array<{ text: string }> }) => r.content[0].text;

describe("opRead — the refusal leads, and the cursor survives it", () => {
  it("withholds the empty page on the third identical read and says why", async () => {
    const client = readClient();
    let out = "";
    for (let i = 0; i < POLL_STRIKE_LIMIT; i++) {
      out = textOf(
        await opRead(client, REF, 7, undefined, "u-me", undefined, undefined, SUBJECT),
      );
    }
    // ⚠ The refusal LEADS — a caller that reads one line reads this one.
    expect(out.startsWith("reason=POLLING_DETECTED")).toBe(true);
    expect(out).toContain("use wait_ms");
    expect(out).toContain('retry=dopl_channel(op="read", channel="general", since=7, wait_ms=<ms>)');
    // ⚠ NOTHING IS LOST: the withheld page had no messages, and the cursor it
    // carried is in the refusal.
    expect(out).toContain("cursor=7");
    // ⚠ MUTATION: returning the ordinary page alongside the refusal fails here.
    expect(out).not.toContain("No messages in");
  });

  it("says nothing on the first two — an ordinary check-in is not a timer", async () => {
    const client = readClient();
    for (let i = 0; i < POLL_STRIKE_LIMIT - 1; i++) {
      const out = textOf(
        await opRead(client, REF, 7, undefined, "u-me", undefined, undefined, SUBJECT),
      );
      expect(out).toContain("No messages in");
      expect(out).not.toContain("POLLING_DETECTED");
    }
  });

  it("never counts a read that RETURNED messages", async () => {
    // ⚠ MUTATION: recording the strike outside the empty branch trips here.
    // A page with messages advanced the caller's cursor; it is an answer.
    const client = readClient(MESSAGES);
    for (let i = 0; i < POLL_STRIKE_LIMIT + 2; i++) {
      const out = textOf(
        await opRead(client, REF, 7, undefined, "u-me", undefined, undefined, SUBJECT),
      );
      expect(out).not.toContain("POLLING_DETECTED");
    }
  });

  it("never counts a THREAD-scoped read", async () => {
    // ⚠ A different question with a different cursor story — a scoped read
    // hands back no cursor at all, so it cannot be part of one loop.
    const client = readClient();
    for (let i = 0; i < POLL_STRIKE_LIMIT + 2; i++) {
      const out = textOf(
        await opRead(client, REF, 7, undefined, "u-me", "thread-1", undefined, SUBJECT),
      );
      expect(out).not.toContain("POLLING_DETECTED");
    }
  });

  it("never counts a caller the detector must not judge", async () => {
    // ⚠ MUTATION: treating `null` as a subject string ("null") re-pools every
    // desktop and unidentified caller into one counter.
    const client = readClient();
    for (let i = 0; i < POLL_STRIKE_LIMIT + 2; i++) {
      const out = textOf(
        await opRead(client, REF, 7, undefined, "u-me", undefined, undefined, null),
      );
      expect(out).not.toContain("POLLING_DETECTED");
    }
  });
});

describe("A HOLD IS NEVER COUNTED — the reset, end to end", () => {
  /** A hold that times out immediately, so the case costs no wall clock. */
  function holdClient(): DoplClient {
    return {
      awaitChannelMessages: vi.fn(async () => ({ messages: [], timedOut: true })),
    } as unknown as DoplClient;
  }

  it("two empty reads, one hold, then two more reads: still no refusal", async () => {
    // ⚠ THE WHOLE CONTRACT IN ONE CASE. MUTATION: removing the `noteHold` call
    // from `channel.ts`'s dispatch makes the fourth read trip.
    const reads = readClient();
    const readOnce = () =>
      opRead(reads, REF, 7, undefined, "u-me", undefined, undefined, SUBJECT);

    await readOnce();
    await readOnce();
    // The dispatcher records the hold before running it; this is that call.
    noteHold(SUBJECT, REF);
    await opHold(holdClient(), REF, 7, 1, "u-me");
    expect(textOf(await readOnce())).not.toContain("POLLING_DETECTED");
    expect(textOf(await readOnce())).not.toContain("POLLING_DETECTED");
  });

  it("the hold's own result is never a refusal, however many are issued", async () => {
    // ⚠ A hold that keeps timing out is a caller doing exactly the right thing
    // on a quiet channel. It must never be accused.
    for (let i = 0; i < POLL_STRIKE_LIMIT + 3; i++) {
      noteHold(SUBJECT, REF);
      const out = textOf(await opHold(holdClient(), REF, 7, 1, "u-me"));
      expect(out).not.toContain("POLLING_DETECTED");
    }
  });
});

describe("opReadAccount — the channel-less page is pollable the same way", () => {
  const DIRECTORY = {
    lockedWorkspaceId: () => null,
    workspaces: () => [],
  } as unknown as WorkspaceDirectory;

  function accountClient(): DoplClient {
    return {
      readAccountMessages: vi.fn(async () => ({
        messages: [],
        channelCount: 2,
        truncated: false,
      })),
    } as unknown as DoplClient;
  }

  it("trips on its own scope key, and keeps the scope note", async () => {
    const client = accountClient();
    let out = "";
    for (let i = 0; i < POLL_STRIKE_LIMIT; i++) {
      out = textOf(await opReadAccount(client, DIRECTORY, 7, undefined, "u-me", SUBJECT));
    }
    expect(out.startsWith("reason=POLLING_DETECTED")).toBe(true);
    // ⚠ THE SCOPE NOTE SURVIVES THE REFUSAL: "you are a member of nothing" is a
    // fact about why the page is empty, and withholding it would leave the
    // caller reading a complaint about a cursor that can never advance.
    expect(out).toContain("Scope: every channel you are a MEMBER of");
  });

  it("does not share a counter with a channel named the same way", async () => {
    // ⚠ `ACCOUNT_SCOPE` is not a legal channel ref, so it cannot collide.
    notePollingRead(SUBJECT, ACCOUNT_SCOPE, 7);
    notePollingRead(SUBJECT, ACCOUNT_SCOPE, 7);
    expect(notePollingRead(SUBJECT, REF, 7)).toBe(false);
  });
});
