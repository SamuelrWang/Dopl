/**
 * One answer route for every display (spec §3.3, contract C2) and the post-insert hook (§5.3):
 * the decision lane posts today's escalation answer (held → a record that names no agent), the
 * legacy lane stamps a v1 row, errors are 400/403/404/409, and any answer insert stamps the display
 * and releases a linked lens row.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/channels/server/service", () => ({ postMessage: vi.fn() }));
vi.mock("@/features/channels/server/service-shared", () => ({ requireMemberChannel: vi.fn() }));
vi.mock("@/features/channels/server/repository-messages", () => ({ findMessageById: vi.fn() }));
vi.mock("@/features/glasses/core/messages/inbox", () => ({ answerAsk: vi.fn() }));
vi.mock("@/features/glasses/core/messages/repository", () => ({ glassesRepository: {} }));
vi.mock("@/features/glasses/core/channel-context", () => ({ operatorChannelContext: vi.fn() }));
vi.mock("./repository", () => ({ stampAnswer: vi.fn(), findMessageRow: vi.fn() }));

import { postMessage } from "@/features/channels/server/service";
import { requireMemberChannel, type ChannelContext } from "@/features/channels/server/service-shared";
import { findMessageById } from "@/features/channels/server/repository-messages";
import { EscalationAlreadyAnsweredError } from "@/features/channels/server/errors";
import { answerAsk } from "@/features/glasses/core/messages/inbox";
import { stampAnswer } from "./repository";
import { answerDisplay } from "./answer";
import { onAnswerInserted } from "./answer-stamp";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const MSG = "44444444-4444-4444-8444-444444444444";
const ctx = (userId = OWNER, via?: string) =>
  ({ userId, workspaceId: "ws", source: "user", ...(via && { messageSource: { kind: via } }) }) as unknown as ChannelContext;
const ESCALATION = { issue: "Ship?", context: "", options: [{ label: "Ship", consequence: "" }, { label: "Wait", consequence: "" }], recommendation: null };
const V2 = { spec_version: 2, display_id: "d-1", blocks: [{ id: "c", type: "choice", options: [{ label: "Ship" }, { label: "Wait" }] }] };
const row = (metadata: Record<string, unknown>) => ({ id: MSG, author_user_id: OWNER, client_msg_id: "agent-abcdefgh-3", metadata });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMemberChannel).mockResolvedValue({ channel: { id: "chan" } } as never);
  vi.mocked(postMessage).mockResolvedValue({ id: "ans", createdAt: "now" } as never);
  vi.mocked(stampAnswer).mockResolvedValue(true);
});

describe("answerDisplay — decision lane", () => {
  it("posts the escalation answer as the answerer (its label, the per-message key)", async () => {
    vi.mocked(findMessageById).mockResolvedValue(row({ display: V2, escalation: ESCALATION }) as never);
    const res = await answerDisplay(ctx(OWNER, "computer"), "chan", MSG, { index: 1 });
    expect(postMessage).toHaveBeenCalledWith(expect.anything(), "chan", {
      body: "Wait",
      clientMsgId: `display-answer-${MSG}`,
      escalationAnswer: { escalationMessageId: MSG, optionIndex: 1 },
    });
    expect(res.answer).toEqual({ block_id: "c", index: 1, choice: "Wait", at: "now", via: "computer", by: OWNER, message_id: "ans" });
  });

  it("a HELD display's answer is a record that re-aims at nobody", async () => {
    const held = { ...V2, wait_until: new Date(Date.now() + 60_000).toISOString() };
    vi.mocked(findMessageById).mockResolvedValue(row({ display: held, escalation: ESCALATION }) as never);
    await answerDisplay(ctx(), "chan", MSG, { index: 0 });
    expect(vi.mocked(postMessage).mock.calls[0][2]).toMatchObject({ intent: "chat", autoAddress: false });
  });

  it("works for a legacy decision row (escalation only)", async () => {
    vi.mocked(findMessageById).mockResolvedValue(row({ escalation: ESCALATION }) as never);
    const res = await answerDisplay(ctx(), "chan", MSG, { index: 0 });
    expect(res.answer).toMatchObject({ block_id: "decision", choice: "Ship" });
  });

  it("404 no display · 400 bad index/block · 403 not an answerer · 409 answered or pressed twice", async () => {
    vi.mocked(findMessageById).mockResolvedValue(row({}) as never);
    await expect(answerDisplay(ctx(), "chan", MSG, { index: 0 })).rejects.toMatchObject({ status: 404, code: "DISPLAY_NOT_FOUND" });
    await expect(answerDisplay(ctx(), "chan", "nope", { index: 0 })).rejects.toMatchObject({ status: 404 });
    vi.mocked(findMessageById).mockResolvedValue(row({ display: V2, escalation: ESCALATION }) as never);
    await expect(answerDisplay(ctx(), "chan", MSG, { index: 5 })).rejects.toMatchObject({ status: 400, code: "DISPLAY_BAD_CHOICE" });
    await expect(answerDisplay(ctx(), "chan", MSG, { index: 0, block_id: "zz" })).rejects.toMatchObject({ status: 400 });
    await expect(answerDisplay(ctx(OTHER), "chan", MSG, { index: 0 })).rejects.toMatchObject({ status: 403, code: "DISPLAY_NOT_YOURS" });
    vi.mocked(postMessage).mockRejectedValueOnce(new EscalationAlreadyAnsweredError(MSG));
    await expect(answerDisplay(ctx(), "chan", MSG, { index: 0 })).rejects.toMatchObject({ status: 409, code: "DISPLAY_ANSWERED" });
    vi.mocked(postMessage).mockResolvedValueOnce({ id: "ans", createdAt: "now", replayed: true } as never);
    await expect(answerDisplay(ctx(), "chan", MSG, { index: 0 })).rejects.toMatchObject({ status: 409 });
  });
});

describe("answerDisplay — legacy v1 lane", () => {
  const V1 = { spec_version: 1, screen_id: "s-1", blocks: [{ id: "o", type: "list", items: ["a", "b"], selectable: true }] };

  it("stamps a channel-only v1 display and replies to the agent that showed it", async () => {
    vi.mocked(findMessageById).mockResolvedValue(row({ display: V1 }) as never);
    const res = await answerDisplay(ctx(), "chan", MSG, { index: 1 });
    expect(stampAnswer).toHaveBeenCalledWith(MSG, expect.objectContaining({ block_id: "o", index: 1, choice: "b" }));
    expect(vi.mocked(postMessage).mock.calls[0][2]).toEqual({ body: "b", clientMsgId: `display-answer-${MSG}`, to: "@agent-abcdefgh" });
    expect(res.answer.choice).toBe("b");
  });

  it("answers a glasses-linked v1 display through the lens path", async () => {
    vi.mocked(findMessageById).mockResolvedValue(row({ display: { ...V1, glasses_message_id: "g1" } }) as never);
    vi.mocked(answerAsk).mockResolvedValue({ ok: true });
    await answerDisplay(ctx(), "chan", MSG, { index: 0 });
    expect(answerAsk).toHaveBeenCalledWith(expect.anything(), OWNER, { id: "g1", index: 0, choice: "a", block_id: "o" });
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe("onAnswerInserted (§5.3 step 3)", () => {
  const answerRow = { id: "ans", created_at: "t1", metadata: { escalationAnswer: { escalationMessageId: MSG, optionIndex: 1, agentId: null } } };

  it("stamps the display once and releases a linked lens row", async () => {
    vi.mocked(findMessageById).mockResolvedValue(row({ display: { ...V2, glasses_message_id: "g1" }, escalation: ESCALATION }) as never);
    vi.mocked(answerAsk).mockResolvedValue({ ok: false, status: 409, error: "already answered" });
    await onAnswerInserted(ctx(OWNER, "web"), "chan", answerRow as never);
    expect(stampAnswer).toHaveBeenCalledWith(MSG, { block_id: "c", index: 1, choice: "Wait", at: "t1", via: "web", by: OWNER, message_id: "ans" });
    expect(answerAsk).toHaveBeenCalledWith(expect.anything(), OWNER, { id: "g1", index: 1, choice: "Wait", block_id: "c" });
  });

  it("stamps nothing on a legacy decision (no display) and never throws", async () => {
    vi.mocked(findMessageById).mockResolvedValue(row({ escalation: ESCALATION }) as never);
    await onAnswerInserted(ctx(), "chan", answerRow as never);
    expect(stampAnswer).not.toHaveBeenCalled();
    vi.mocked(findMessageById).mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(onAnswerInserted(ctx(), "chan", answerRow as never)).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledWith("[display] answer stamp failed", expect.any(Error));
    err.mockRestore();
  });
});
