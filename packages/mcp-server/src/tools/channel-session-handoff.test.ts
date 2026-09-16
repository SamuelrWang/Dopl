/**
 * SPAWN-WITH-HANDOFF at the MCP layer — `opCreateThread` with `handoff=true`:
 * the flag rides through to the client, and the RESULT flips from "arm the hold
 * here" to "the operator's window was asked, and nothing is confirmed".
 *
 * ⚠ **SPLIT OUT OF `channel-session-ops.test.ts` ON 2026-09-16, WHICH HAD REACHED
 * THE 500-LINE CAP EXACTLY** (§1's hard cap over `packages/`, a CI job — at the
 * number is not under it, and the next case would have turned the job red). The
 * seam is the one the old file's own docblock already drew: `op="status"` renders
 * a page of somebody's sessions, and this renders the answer to a WRITE. Two
 * reasons to change, two files.
 *
 * ⚠ **THE FIXTURES ARE THIS FILE'S OWN AND THAT IS THE CONVENTION HERE**, not a
 * duplication to fold away later: sixteen suites under `tools/` declare their own
 * `CHANNEL` / `PEER` / `stubClient` triple, and a shared one would make every
 * suite's stub a thing every other suite can change.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { opCreateThread } from "./channel-ops-threads";
import { CHANNEL_DOCTRINE } from "./channel-doctrine";

const CHANNEL = {
  id: "chan-1",
  slug: "general",
  name: "General",
  visibility: "private",
};

const PEER = {
  userId: "22222222-2222-2222-2222-222222222222",
  email: "anthony@example.com",
  displayName: "Anthony",
  status: "active",
};

function stubClient(overrides: Record<string, unknown>): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    listWorkspaceMembers: vi.fn(async () => [PEER]),
    ...overrides,
  } as unknown as DoplClient;
}

type CreateSpy = (
  channelId: string,
  input: Record<string, unknown>,
) => Promise<{ thread: { id: string; title: string; mode: string }; openingSeq: number | null }>;

function createStub(spy: ReturnType<typeof vi.fn>): DoplClient {
  return stubClient({ createChannelThread: spy });
}

const CREATED = {
  thread: { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", title: "Talk to Anthony", mode: "autonomous" },
  openingSeq: 41,
};

describe('send thread="new" handoff (rollback §3.5)', () => {
  it("passes handoff=true through to the client", async () => {
    const createChannelThread = vi.fn<CreateSpy>().mockResolvedValue(CREATED);
    await opCreateThread(
      createStub(createChannelThread),
      "general",
      "Talk to Anthony",
      "ask about the migration",
      PEER.userId,
      "autonomous",
      undefined,
      null,
      true,
    );
    const [, input] = createChannelThread.mock.calls[0];
    expect(input.handoff).toBe(true);
  });

  /**
   * ⚠ THE COPY SAYS WHAT THE SERVER KNOWS, WHICH IS THAT IT ASKED. The server
   * never learns the outcome, and `session-dispatch.maybeOpenRequesterSession`
   * answers false SILENTLY on four ordinary paths (window mode off, predicate
   * refusal, window budget spent, desktop not running). "You are done" on a
   * handoff nobody picked up leaves the exchange with NO watcher. Default stays
   * "do not race a window that may have opened", plus a fallback.
   */
  it("a handoff create states the request, not an outcome, and does not race the window", async () => {
    const createChannelThread = vi.fn<CreateSpy>().mockResolvedValue(CREATED);
    const res = await opCreateThread(
      createStub(createChannelThread),
      "general",
      "Talk to Anthony",
      "ask about the migration",
      PEER.userId,
      "autonomous",
      undefined,
      null,
      true,
    );
    const text = res.content[0].text;
    // ⚠ **THE VERDICT IS A TOKEN NOW, AND IT SAYS THE SAME THING** (T10). The
    // three paragraphs this pinned — `HANDOFF`, `OPENS NOTHING TODAY`, `F-274` —
    // were an account of a flag that does nothing; `handoff=ignored` is that
    // account, stated once, in the field the caller set. What may NOT weaken is
    // that the result still refuses to report an OUTCOME the server cannot see,
    // and the negatives below are unchanged from the day F-274 was filed.
    expect(text).toContain("handoff=ignored");
    // ⚠ **REWRITTEN 2026-08-22 (F-274), AND THE OLD ASSERTIONS WERE PINNING THE
    // DEFECT.** They required a HEDGE — "REQUESTED, not confirmed", "never learns
    // whether a session started" — which was the right shape for a request whose
    // outcome the server cannot see. It stopped being the right shape when the
    // outcome became KNOWABLE and always the same: `main/targeting.js ›
    // requesterTaskOpen` has had no caller since F-228, so nothing opens, ever.
    // A hedge over a certainty is a lie with better manners.

    // ⚠ THE OPERATIVE FIX, AND IT SURVIVED THE TERSENING. The old copy said
    // `do NOT arm op="await" yet` (the hold is `read` + `wait_ms` now), and an
    // external session obeyed it: nothing
    // opened, nobody watched the thread, and the peer's reply was read by no
    // one. `hold=since:41` is that instruction AND the cursor in one token — a
    // stronger form than the sentences it replaces ("you must arm the wait
    // yourself", "NOBODY is watching this thread"), which said the same thing in
    // words and charged every caller for them.
    // ⚠ PINNED ON THE INSTRUCTION, NOT ON THE OP NAME (B8): the hold moved onto
    // `read`, so the copy that would re-break this would spell it differently.
    expect(text).not.toContain("do NOT arm");
    expect(text).toContain("hold=since:41");
    // ⚠ Nothing may tell the agent the desktop has it, in any wording.
    expect(text).not.toContain("A full session is opening");
    expect(text).not.toContain("You are done with this thread");
    expect(text).not.toContain("REQUESTED, not confirmed");
  });

  it("a handoff create keeps a FALLBACK for the case where nothing picks it up", async () => {
    const createChannelThread = vi.fn<CreateSpy>().mockResolvedValue(CREATED);
    const res = await opCreateThread(
      createStub(createChannelThread),
      "general",
      "Talk to Anthony",
      "ask about the migration",
      PEER.userId,
      "autonomous",
      undefined,
      null,
      true,
    );
    const text = res.content[0].text;
    // ⚠ **THE FALLBACK BECAME THE MAIN PATH (F-274).** There is no longer a case
    // where something else picks the thread up, so "how to notice that nothing
    // did" is not a branch any more — the await is simply what happens next, and
    // it is stated first rather than as a contingency.
    // ⚠ It is the `hold=` FIELD rather than the words of a re-arm since T10:
    // one token carries the instruction AND the REAL cursor, so taking it still
    // cannot start past the peer's reply.
    expect(text).toContain("hold=since:41");
    expect(text).not.toContain("IF NOTHING PICKS IT UP");
    // ⚠ AND THE CAPABILITY THE CALLER ACTUALLY WANTED IS NAMED. Without this the
    // result closes a door and opens none, which is how an agent invents a
    // workaround.
    // ⚠ …AND IT IS NAMED IN THE DOCTRINE, not on every create. Stating it per
    // call charged every caller for a pointer; dropping it entirely would close
    // a door and open none, which is how an agent invents a workaround.
    expect(CHANNEL_DOCTRINE).toContain('op="manage" action="launch"');
  });

  it("a handoff create with NO opening seq asks for the cursor instead of inventing one", async () => {
    const createChannelThread = vi
      .fn<CreateSpy>()
      .mockResolvedValue({ ...CREATED, openingSeq: null });
    const res = await opCreateThread(
      createStub(createChannelThread),
      "general",
      "Talk to Anthony",
      "ask about the migration",
      PEER.userId,
      "autonomous",
      undefined,
      null,
      true,
    );
    const text = res.content[0].text;
    // ⚠ A CURSOR IS NEVER INVENTED, and the terse form makes that legible: an
    // unreported seq DASHES in both fields rather than printing a number the
    // server never had. A fabricated `since` silently skips the peer's reply,
    // which is the failure this case exists for.
    expect(text).not.toContain("since=null");
    expect(text).not.toContain("since=undefined");
    expect(text).not.toContain("since:null");
    expect(text).toContain("seq=-");
    expect(text).toContain("hold=-");
    // ⚠ "Go and read the cursor yourself" left the result with every other
    // standing sentence; the dash is this call's statement that there is nothing
    // to take, and the doctrine still names the op that takes it.
    expect(CHANNEL_DOCTRINE).toContain('"read"');
  });

  it("WITHOUT handoff, behaviour is unchanged: the create keeps the reply and arms await", async () => {
    const createChannelThread = vi.fn<CreateSpy>().mockResolvedValue(CREATED);
    const res = await opCreateThread(
      createStub(createChannelThread),
      "general",
      "Talk to Anthony",
      "ask about the migration",
      PEER.userId,
      "autonomous",
      undefined,
      null,
    );
    const [, input] = createChannelThread.mock.calls[0];
    expect(input.handoff).toBeUndefined();
    const text = res.content[0].text;
    // ⚠ The handoff FIELD dashes rather than vanishing, so "not requested" and
    // "requested and ignored" stay two readings of one line and never one
    // absence. The await instruction is identical on both branches.
    expect(text).toContain("handoff=-");
    expect(text).not.toContain("handoff=ignored");
    expect(text).toContain("hold=since:41");
  });
});
