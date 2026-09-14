/**
 * THE TYPED DOOR (task 13b, rulings #1081–#1085) — an escalation answered by
 * TYPING at it rather than by pressing its button.
 *
 * ⚠ Split out of `service-writes-metadata-escalation.test.ts` (2026-09-14,
 * 500-line cap), which keeps the BUTTON door and whose header states why these
 * keys have a file of their own at all. Both halves drive the REAL `postMessage`
 * → `resolvePostMetadata` over the one harness in
 * `_service-writes-metadata-escalation-fixtures.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-sessions");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import { postMessage } from "./service-writes";
import { MENTIONS_METADATA_KEY } from "../lib/mentions";
import {
  ESCALATION_ANSWER_METADATA_KEY,
  ESCALATION_METADATA_KEY,
} from "../escalation";
import type { ChannelMessageRow } from "./dto";
import {
  agentCtx,
  capturedMetadata,
  ctx,
  ESC_ID,
  ESCALATION,
  has,
  installEscalationMocks,
  PEER,
  storedEscalation,
  thirdCtx,
} from "./_service-writes-metadata-escalation-fixtures";

beforeEach(installEscalationMocks);

/**
 * THE TYPED DOOR (task 13b, rulings #1081–#1085).
 *
 * The gap: Samuel answered a card by TYPING "Approve the package". The post
 * carried no `escalationAnswer`, tied to no card and woke nobody — and #1084's
 * finding is that this was never a regression, the path was never built.
 *
 * ⚠ EVERY NEGATIVE CASE ASSERTS **SILENCE**, not an error. A near miss is an
 * ordinary message, which is what it already was; the feature may only ever ADD
 * a stamp. A rejects.toThrow anywhere in this describe would be the bug.
 */
describe("a TYPED answer presses the same button", () => {
  function openCard(
    over: Partial<ChannelMessageRow> = {},
    meta: Record<string, unknown> = {}
  ): void {
    vi.mocked(repoMessages.listRecentEscalations).mockResolvedValue([
      storedEscalation(over, meta),
    ]);
  }

  it("stamps the answer when the body IS an option's label", async () => {
    openCard();
    await postMessage(ctx, "room", { body: "Ship now" });
    expect(capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY]).toEqual({
      escalationMessageId: ESC_ID,
      optionIndex: 0,
      agentId: "k3wpf7c5",
    });
  });

  it("matches case-insensitively and trims, so real typing counts", async () => {
    openCard();
    await postMessage(ctx, "room", { body: "  wAiT  " });
    expect(
      (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as { optionIndex: number })
        .optionIndex
    ).toBe(1);
  });

  it("accepts the BARE NUMBER the card's own body prints", async () => {
    // `escalationBody` renders "2. **Wait** — …", so "2" is 1-BASED in and
    // 0-based out. It is read off what the operator SEES.
    openCard();
    await postMessage(ctx, "room", { body: "2" });
    expect(
      (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as { optionIndex: number })
        .optionIndex
    ).toBe(1);
  });

  it("stamps the SAME shape a press does — one path downstream", async () => {
    // ⚠ #1085 ›3: the wake verdict must never learn there were two entrances.
    // Same derived `agentId`, off the STRONGER door, for a card that carried its
    // own idempotency key — the 13a repair reached through the typed path too.
    openCard({ client_msg_id: "ask-2" }, { session_id: "chan::k3wpf7c5" });
    await postMessage(ctx, "room", { body: "Ship now" });
    expect(capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY]).toEqual({
      escalationMessageId: ESC_ID,
      optionIndex: 0,
      agentId: "k3wpf7c5",
    });
  });

  it("leaves PARTIAL text as ordinary prose, silently", async () => {
    // ⚠ THE WHOLE FAIL-CLOSED RULING. A wrong match presses a button the person
    // did not press, through a UI that has no unpress.
    openCard();
    await postMessage(ctx, "room", { body: "I think we should ship now" });
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  it("leaves an out-of-range number as ordinary prose", async () => {
    openCard();
    await postMessage(ctx, "room", { body: "5" });
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  it("treats '0' as prose — the render has no option zero", async () => {
    openCard();
    await postMessage(ctx, "room", { body: "0" });
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  it("refuses to guess when TWO options share a label", async () => {
    openCard({
      metadata: {
        [ESCALATION_METADATA_KEY]: {
          ...ESCALATION,
          options: [
            { label: "Ship now", consequence: "Live in ten minutes." },
            { label: "Ship now", consequence: "Live tomorrow." },
          ],
          recommendation: null,
        },
      },
    });
    await postMessage(ctx, "room", { body: "Ship now" });
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  /**
   * LABEL FIRST, NUMBER AS THE FALLBACK (ruled 2026-09-06).
   *
   * The digit arm used to run first, so an option whose FACE is a number could
   * never be answered by typing that face — the digits were spent reading a
   * position before anything looked at the labels, and `matchTypedOption`'s own
   * docblock ("the whole body equal to one option's whole label") was false for
   * exactly that shape.
   */
  describe("precedence: a label beats the position it happens to look like", () => {
    /** A card whose SECOND option is faced with a number. */
    function numericFacedCard(): void {
      openCard({
        metadata: {
          [ESCALATION_METADATA_KEY]: {
            ...ESCALATION,
            options: [
              { label: "Ship now", consequence: "Live in ten minutes." },
              { label: "2026", consequence: "Slip to next year." },
            ],
            recommendation: null,
          },
        },
      });
    }

    it("answers a NUMERICALLY-FACED option by typing its face", async () => {
      // ⚠ THE GAP THIS CLOSES. Under digits-first, "2026" was read as position
      // 2026, fell off the end of a two-option card, and stamped nothing — the
      // one label on the card that could not be typed was the one printed on
      // the button.
      numericFacedCard();
      await postMessage(ctx, "room", { body: "2026" });
      expect(
        (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as { optionIndex: number })
          .optionIndex
      ).toBe(1);
    });

    it("still resolves a bare number BY POSITION when no label matches it", async () => {
      // ⚠ THE FALLBACK IS INTACT, and this is the common card: "2" is what the
      // render prints beside the second option, and typing it must keep working.
      openCard();
      await postMessage(ctx, "room", { body: "2" });
      expect(
        (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as { optionIndex: number })
          .optionIndex
      ).toBe(1);
    });

    it("refuses two options sharing a NUMERIC face, without falling through to the position", async () => {
      // ⚠ AMBIGUITY STOPS, it does not get a second chance. Reading "2" as a
      // position after two options called "2" already refused would be the guess
      // this function exists not to make, taken one step later.
      openCard({
        metadata: {
          [ESCALATION_METADATA_KEY]: {
            ...ESCALATION,
            options: [
              { label: "2", consequence: "One of them." },
              { label: "2", consequence: "The other." },
            ],
            recommendation: null,
          },
        },
      });
      await postMessage(ctx, "room", { body: "2" });
      expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
    });
  });

  it("does not answer an ALREADY-ANSWERED card", async () => {
    openCard();
    vi.mocked(repoMessages.listAnsweredEscalationIds).mockResolvedValue(
      new Set([ESC_ID])
    );
    await postMessage(ctx, "room", { body: "Ship now" });
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  it("does not answer a card the typist could not have PRESSED", async () => {
    // ⚠ AUTHORIZATION IS THE CANDIDATE FILTER. The typed door must never answer a
    // card the button path would refuse with a 403 — here, a peer's card that
    // tagged somebody else.
    openCard({ author_user_id: PEER }, { [MENTIONS_METADATA_KEY]: [PEER] });
    await postMessage(thirdCtx, "room", { body: "Ship now" });
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  it("answers the MOST RECENT open card, never an older one", async () => {
    const older = storedEscalation({ id: "older-card", seq: 3 });
    // `listRecentEscalations` is `seq` DESC; the newest survivor wins.
    vi.mocked(repoMessages.listRecentEscalations).mockResolvedValue([
      storedEscalation(),
      older,
    ]);
    await postMessage(ctx, "room", { body: "Ship now" });
    expect(
      (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as {
        escalationMessageId: string;
      }).escalationMessageId
    ).toBe(ESC_ID);
  });

  it("skips the ANSWERED newest and takes the most recent OPEN one", async () => {
    vi.mocked(repoMessages.listRecentEscalations).mockResolvedValue([
      storedEscalation(),
      storedEscalation({ id: "older-card", seq: 3 }),
    ]);
    vi.mocked(repoMessages.listAnsweredEscalationIds).mockResolvedValue(
      new Set([ESC_ID])
    );
    await postMessage(ctx, "room", { body: "Ship now" });
    expect(
      (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as {
        escalationMessageId: string;
      }).escalationMessageId
    ).toBe("older-card");
  });

  it("an AGENT's post never presses its operator's card", async () => {
    // ⚠ THE FENCE. An agent posts as its operator's user id, so without this an
    // agent writing "Ship now" would press a button nobody touched.
    openCard();
    await postMessage(agentCtx, "room", { body: "Ship now" });
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  it("a post that IS a card does not answer the card before it", async () => {
    openCard();
    await postMessage(agentCtx, "room", {
      body: "Ship now",
      escalation: ESCALATION,
    });
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  it("does not fail the POST when the lookup itself fails", async () => {
    // ⚠ THIS FOLD MAY ONLY EVER ADD A STAMP. A member's ordinary sentence must
    // not fail to send because an optional convenience could not run.
    vi.mocked(repoMessages.listRecentEscalations).mockRejectedValue(
      new Error("db is having a day")
    );
    await expect(
      postMessage(ctx, "room", { body: "Ship now" })
    ).resolves.toBeDefined();
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  it("drops the guessed stamp and still posts when a press wins the race", async () => {
    // ⚠ **THE PROMISE IS ABOUT THE WRITE, NOT ONLY THE FOLD** (2026-09-06).
    // "Most recent OPEN card" is a read; one-answer-per-escalation is a partial
    // unique index enforced at COMMIT. A press landing in between made this
    // member's ordinary sentence 23505 and fail to send — the exact outcome 11b
    // chose silence to avoid. The honest answer is the message WITHOUT the key.
    openCard();
    vi.mocked(repo.pgErrorCode).mockReturnValue("23505");
    vi.mocked(repoMessages.insertMessage).mockRejectedValueOnce(
      new Error("duplicate key value violates unique constraint")
    );

    await expect(
      postMessage(ctx, "room", { body: "Ship now" })
    ).resolves.toBeDefined();

    // The first attempt DID carry the guess — this is a retry, not a fold that
    // quietly stopped matching.
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(true);
    const retried = vi.mocked(repoMessages.insertMessage).mock.calls[1][0];
    expect(has(retried.metadata, ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
    // ⚠ AND THE MEMBER'S WORDS ARE UNTOUCHED. Dropping the stamp must never
    // edit what they wrote.
    expect(retried.body).toBe("Ship now");
  });

  it("reads nothing at all for a body no label could be", async () => {
    // The free prune: an option label is a single-line `safeLabel` ≤ 80 chars, so
    // ordinary prose is refused without touching the database — every message on
    // the post path pays this fold's cost.
    await postMessage(ctx, "room", { body: "x".repeat(200) });
    expect(repoMessages.listRecentEscalations).not.toHaveBeenCalled();
  });
});
