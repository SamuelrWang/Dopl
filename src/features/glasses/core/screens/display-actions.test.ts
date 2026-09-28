import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  postMessage: vi.fn(),
  requireMemberChannel: vi.fn(),
  findMessageById: vi.fn(),
  patch: vi.fn(),
  store: null as unknown,
}));
vi.mock("@/features/channels/server/service", () => ({ postMessage: h.postMessage }));
vi.mock("@/features/channels/server/service-shared", () => ({ requireMemberChannel: h.requireMemberChannel }));
vi.mock("@/features/channels/server/repository-messages", () => ({ findMessageById: h.findMessageById }));
vi.mock("./channel-displays", () => ({ patchChannelDisplay: h.patch }));
vi.mock("../devices/repository", () => ({ deviceRepository: {} }));
vi.mock("../messages/repository", async () => {
  const { createFakeGlassesStore } = await import("../testing/fake-store");
  const fake = createFakeGlassesStore();
  h.store = fake;
  return { glassesRepository: fake.store };
});

import { ChannelRecipientUnresolvedError } from "@/features/channels/server/errors-recipient";
import { answerDisplay, saveDisplayTemplate } from "./display-actions";
import type { ChannelContext } from "@/features/channels/server/service-shared";
import type { GlassesStore } from "../messages/types";

const USER = "11111111-1111-4111-8111-111111111111";
const MSG = "22222222-2222-4222-8222-222222222222";
const ctx = { userId: USER, source: "user", messageSource: { kind: "computer", label: "Mac" } } as ChannelContext;
const LIST = { id: "act", type: "list", items: ["Top up", "Later"], selectable: true, border: false };
const display = (over = {}) => ({
  spec_version: 1,
  screen_id: "usage",
  blocks: [{ id: "t", type: "text", content: "Usage Report", border: false, selectable: false }, LIST],
  ...over,
});
const row = (over = {}) => ({ id: MSG, author_user_id: USER, client_msg_id: "agent-abcdefgh-3", metadata: { display: display() }, ...over });
const store = () => (h.store as { store: GlassesStore; rows: { status: string; answer: unknown }[] });

beforeEach(() => {
  vi.clearAllMocks();
  h.requireMemberChannel.mockResolvedValue({ channel: { id: "chan-1" } });
});

describe("answer a display from the app", () => {
  it("a channel-only display: stamps the answer and posts the choice to the agent that showed it", async () => {
    h.findMessageById.mockResolvedValue(row());
    const res = await answerDisplay(ctx, "room", MSG, { index: 1 });
    expect(res.answer).toMatchObject({ block_id: "act", choice: "Later", index: 1, via: "computer" });
    expect(h.patch).toHaveBeenCalledWith(USER, MSG, { answer: res.answer });
    expect(h.postMessage).toHaveBeenCalledWith(ctx, "chan-1", expect.objectContaining({ body: "Later", to: "@agent-abcdefgh" }));
  });

  it("falls back to an unaddressed post when the agent has ended", async () => {
    h.findMessageById.mockResolvedValue(row());
    h.postMessage.mockRejectedValueOnce(new ChannelRecipientUnresolvedError("@agent-abcdefgh", [], []));
    await answerDisplay(ctx, "room", MSG, { index: 0 });
    expect(h.postMessage).toHaveBeenLastCalledWith(ctx, "chan-1", expect.not.objectContaining({ to: expect.anything() }));
  });

  it("a glasses-linked display answers the glasses row through the device path", async () => {
    const glasses = await store().store.insert(USER, {
      kind: "ask",
      card_id: null,
      payload: { question: "Ship?", options: ["Top up", "Later"] },
      expires_at: "2999-01-01T00:00:00.000Z",
      now: "2026-09-28T00:00:00.000Z",
      channel_message_id: MSG,
    });
    h.findMessageById.mockResolvedValue(row({ metadata: { display: display({ glasses_message_id: glasses.id }) } }));
    await answerDisplay(ctx, "room", MSG, { index: 0 });
    expect(store().rows.at(-1)).toMatchObject({ status: "answered", answer: { choice: "Top up", index: 0 } });
    expect(h.patch).toHaveBeenCalledWith(USER, MSG, { answer: expect.objectContaining({ choice: "Top up", via: "computer" }) });
    expect(h.postMessage).not.toHaveBeenCalled();
    await expect(answerDisplay(ctx, "room", MSG, { index: 1 })).rejects.toMatchObject({ status: 409 });
  });

  it("refuses another member, a bad index, an answered card and a message with no display", async () => {
    h.findMessageById.mockResolvedValue(row({ author_user_id: "someone-else" }));
    await expect(answerDisplay(ctx, "room", MSG, { index: 0 })).rejects.toMatchObject({ status: 403 });
    h.findMessageById.mockResolvedValue(row());
    await expect(answerDisplay(ctx, "room", MSG, { index: 5 })).rejects.toMatchObject({ status: 400 });
    h.findMessageById.mockResolvedValue(row({ metadata: { display: display({ answer: { choice: "x" } }) } }));
    await expect(answerDisplay(ctx, "room", MSG, { index: 0 })).rejects.toMatchObject({ status: 409 });
    h.findMessageById.mockResolvedValue(row({ metadata: {} }));
    await expect(answerDisplay(ctx, "room", MSG, { index: 0 })).rejects.toMatchObject({ status: 404 });
  });
});

describe("save a display as a template", () => {
  it("names it from the given name or the first text line, slugified", async () => {
    h.findMessageById.mockResolvedValue(row());
    expect(await saveDisplayTemplate(ctx, "room", MSG, {})).toMatchObject({ name: "usage-report" });
    expect(await saveDisplayTemplate(ctx, "room", MSG, { name: "My Usage Bar" })).toMatchObject({ name: "my-usage-bar" });
  });
});
