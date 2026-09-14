/**
 * THE ESCALATION KEYS — the reserved pair that renders a card with BUTTONS and
 * routes the pressed one back to an agent.
 *
 * ⚠ ITS OWN FILE for the reason the keys are reserved at all. `escalation`
 * renders a working control in somebody's transcript; `escalationAnswer` is a
 * WAKE PRIMITIVE — it names an agent instance and a machine acts on it. Both are
 * security properties a reader should find by name rather than eighteen
 * describes down the metadata fold's file.
 *
 * ⚠ EVERY CASE DRIVES THE REAL `postMessage` → `resolvePostMetadata` and reads
 * the metadata object that crossed into `insertMessage` (INVARIANTS §14: a regex
 * over source text is not a behavioural assertion). The harness mirrors
 * `service-writes-metadata-mentions.test.ts`'s deliberately.
 *
 * ⚠ THE TYPED DOOR SPLIT OFF ON 2026-09-14 (500-line cap) into
 * `service-writes-metadata-escalation-typed.test.ts`; the harness both halves
 * drive is `_service-writes-metadata-escalation-fixtures.ts`, so there is one
 * world and not two. This file keeps the BUTTON door.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-sessions");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");

import * as repoMessages from "./repository-messages";
import { postMessage } from "./service-writes";
import { MENTIONS_METADATA_KEY } from "../lib/mentions";
import {
  ESCALATION_ANSWER_METADATA_KEY,
  ESCALATION_METADATA_KEY,
} from "../escalation";
import {
  agentCtx,
  capturedMetadata,
  ctx,
  ESC_ID,
  ESCALATION,
  has,
  installEscalationMocks,
  PEER,
  peerCtx,
  storedEscalation,
  thirdCtx,
} from "./_service-writes-metadata-escalation-fixtures";

beforeEach(installEscalationMocks);

describe("the escalation payload is RESERVED", () => {
  it("stamps it from the validated field", async () => {
    await postMessage(agentCtx, "room", {
      body: "**Escalation:** Ship now or wait?",
      escalation: ESCALATION,
    });
    expect(capturedMetadata()[ESCALATION_METADATA_KEY]).toEqual(ESCALATION);
  });

  it("STRIPS a caller's own metadata copy, and stamps nothing in its place", async () => {
    // ⚠ THE WHOLE SECURITY CONTENT. The card renders buttons that write back and
    // wake an agent, so a settable key would let any member hang a working
    // control off any words at all.
    await postMessage(ctx, "room", {
      body: "not an escalation",
      metadata: { [ESCALATION_METADATA_KEY]: ESCALATION },
    });
    expect(has(capturedMetadata(), ESCALATION_METADATA_KEY)).toBe(false);
  });

  it("STRIPS a caller's own ANSWER copy — a forged one is a forged WAKE", async () => {
    await postMessage(ctx, "room", {
      body: "plain message",
      metadata: {
        [ESCALATION_ANSWER_METADATA_KEY]: {
          escalationMessageId: ESC_ID,
          optionIndex: 0,
          agentId: "k3wpf7c5",
        },
      },
    });
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  it("stamps NOTHING on an ordinary post, so no existing row shape moved", async () => {
    await postMessage(ctx, "room", { body: "hello" });
    expect(has(capturedMetadata(), ESCALATION_METADATA_KEY)).toBe(false);
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });
});

describe("the derived agentId — BOTH doors, so a careful caller is not anonymous", () => {
  /**
   * ⚠ THE BUG THIS IS FOR (2026-09-05, task 13a). `agentId` came off
   * `parseAgentPostStamp(row.client_msg_id)` alone, and the stamp is absent from
   * every post that carried its OWN idempotency key — `main/session-outbound-tag.js
   * › threadTagFor` never overwrites one an agent chose. So an agent that filed its
   * decision card with `client_msg_id: "ask-2"` stamped `agentId: null`, and the
   * press that answered it named nobody to wake: this feature's own failure mode, a
   * button reporting success over an answer that reached no one, firing on exactly
   * the callers careful enough to set a key before retrying.
   */
  it("a card whose client_msg_id is the CALLER's own key still resolves an agent", async () => {
    vi.mocked(repoMessages.findMessageById).mockResolvedValue(
      storedEscalation(
        { client_msg_id: "ask-2" },
        // ⚠ THE SERVER'S OWN STAMP, and the STRONGER fact: `session_id` is stripped
        // from caller input unconditionally and re-stamped from the
        // `X-Dopl-Session-Id` header (`service-writes-metadata.ts` fold 6b), so
        // reading it names FEWER forgeable things than the stamp did.
        { session_id: "chan::k3wpf7c5" }
      )
    );
    await postMessage(ctx, "room", {
      body: "Ship now",
      escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
    });
    expect(capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY]).toEqual({
      escalationMessageId: ESC_ID,
      optionIndex: 0,
      agentId: "k3wpf7c5",
    });
  });

  it("the STAMP still wins where a row carries one — the older form is unmoved", async () => {
    vi.mocked(repoMessages.findMessageById).mockResolvedValue(
      storedEscalation({}, { session_id: "chan::zzzzzzzz" })
    );
    await postMessage(ctx, "room", {
      body: "Ship now",
      escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
    });
    expect(
      (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as { agentId: string })
        .agentId
    ).toBe("k3wpf7c5");
  });

  it("an EXTERNAL MCP escalation still answers null — cannot say, never a guess", async () => {
    // Nothing stamped it and it carries no desktop session key. The answer is still
    // an ordinary visible message, so `feedLiveSession` delivers it to every live
    // agent on the thread; `null` here removes no delivery (INVARIANTS §11).
    vi.mocked(repoMessages.findMessageById).mockResolvedValue(
      storedEscalation({ client_msg_id: "mcp-1" })
    );
    await postMessage(ctx, "room", {
      body: "Ship now",
      escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
    });
    expect(capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY]).toEqual({
      escalationMessageId: ESC_ID,
      optionIndex: 0,
      agentId: null,
    });
  });
});

describe("who may ANSWER — the tagged member, else the author", () => {
  it("the TAGGED member may answer", async () => {
    vi.mocked(repoMessages.findMessageById).mockResolvedValue(
      storedEscalation({}, { [MENTIONS_METADATA_KEY]: [PEER] })
    );
    await postMessage(peerCtx, "room", {
      body: "Ship now",
      escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
    });
    expect(capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY]).toEqual({
      escalationMessageId: ESC_ID,
      optionIndex: 0,
      agentId: "k3wpf7c5",
    });
  });

  it("a member the escalation did NOT tag is refused, LOUDLY", async () => {
    // ⚠ 403, not a silent strip. A foreign thread tag is stripped because
    // installed desktops post legacy ids; this key has no installed writers, and
    // a silent strip would let the button report success over an answer nobody
    // received.
    vi.mocked(repoMessages.findMessageById).mockResolvedValue(
      storedEscalation({}, { [MENTIONS_METADATA_KEY]: [PEER] })
    );
    await expect(
      postMessage(thirdCtx, "room", {
        body: "Ship now",
        escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
      })
    ).rejects.toThrow(/not addressed to you/i);
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("with NOBODY tagged, the AUTHOR's operator may answer", async () => {
    // §5's 2026-08-22 ruling made useful: an untagged escalation is addressed to
    // the person whose machine it runs on.
    await postMessage(ctx, "room", {
      body: "Ship now",
      escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 1 },
    });
    expect(
      (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as { optionIndex: number })
        .optionIndex
    ).toBe(1);
  });

  it("with NOBODY tagged, a peer is still refused", async () => {
    await expect(
      postMessage(peerCtx, "room", {
        body: "Ship now",
        escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
      })
    ).rejects.toThrow(/not addressed to you/i);
  });
});

describe("what an answer may NAME", () => {
  it("refuses a message id that is not in this channel", async () => {
    // ⚠ `findMessageById` is scoped by channel — the `eq('channel_id')` is the
    // fence, not a narrowing. `null` here IS the cross-channel case.
    vi.mocked(repoMessages.findMessageById).mockResolvedValue(null);
    await expect(
      postMessage(ctx, "room", {
        body: "Ship now",
        escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
      })
    ).rejects.toThrow(/No answerable escalation here/i);
  });

  it("refuses a message that carries no escalation payload", async () => {
    vi.mocked(repoMessages.findMessageById).mockResolvedValue(
      storedEscalation({ metadata: {} })
    );
    await expect(
      postMessage(ctx, "room", {
        body: "Ship now",
        escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
      })
    ).rejects.toThrow(/No answerable escalation here/i);
  });

  it("refuses an option index outside THAT escalation's own list", async () => {
    // The schema's own bound is the 0..5 range; this is the per-row one.
    await expect(
      postMessage(ctx, "room", {
        body: "Ship now",
        escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 4 },
      })
    ).rejects.toThrow(/No answerable escalation here/i);
  });
});

describe("the wake key is DERIVED, never accepted", () => {
  it("takes the agent id off the ESCALATION's own stamp", async () => {
    await postMessage(ctx, "room", {
      body: "Ship now",
      escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
    });
    expect(
      (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as { agentId: string })
        .agentId
    ).toBe("k3wpf7c5");
  });

  it("answers `null` for an escalation nothing stamped — an EXTERNAL agent's", async () => {
    // ⚠ `null` IS "CANNOT SAY", never "no agent". An MCP session's post carries
    // no per-instance stamp; the answer is still an ordinary visible message, so
    // `feedLiveSession` still delivers it to every live agent on the thread.
    vi.mocked(repoMessages.findMessageById).mockResolvedValue(
      storedEscalation({ client_msg_id: null })
    );
    await postMessage(ctx, "room", {
      body: "Ship now",
      escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
    });
    expect(
      (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as { agentId: null })
        .agentId
    ).toBeNull();
  });

  it("does NOT attribute a MACHINE-level courtesy stamp to an agent", async () => {
    // `main/channel-post.js › postCourtesy` stamps `agent-<channelUUID>-<seq>`,
    // and a channel UUID can BEGIN with eight id-shaped characters — the anchored
    // pattern is the discriminator, and a `startsWith` would invent an agent.
    vi.mocked(repoMessages.findMessageById).mockResolvedValue(
      storedEscalation({
        client_msg_id: "agent-3f8ab19c-4d2e-4c1a-9b77-1e2f3a4b5c6d-7",
      })
    );
    await postMessage(ctx, "room", {
      body: "Ship now",
      escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
    });
    expect(
      (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as { agentId: null })
        .agentId
    ).toBeNull();
  });
});
