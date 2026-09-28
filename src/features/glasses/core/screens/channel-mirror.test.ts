import { describe, expect, it, vi } from "vitest";
import { createFakeGlassesStore, fakeClock } from "../testing/fake-store";
import { createFakeDeviceStore } from "../testing/fake-device-store";
import { answerAsk } from "../messages/inbox";
import { glassesAsk } from "../messages/service";
import { renderScreen, updateScreen } from "./service";
import { answerMirror, type ChannelDisplays } from "./channel-mirror";
import type { MessageDisplayStamp } from "./display";

const USER = "11111111-1111-4111-8111-111111111111";
const BLOCKS = [
  { type: "text", id: "title", content: "Usage" },
  { type: "progress", id: "bar", value: 0.62, label: "Credits" },
  { type: "list", id: "act", items: ["Top up", "Later"] },
];

/** A channel whose display messages are one map, patched by merge like the RPC. */
function fakeChannel(withPost = true) {
  const messages = new Map<string, MessageDisplayStamp & { body: string }>();
  let n = 0;
  const displays: ChannelDisplays = {
    patch: vi.fn(async (_user: string, id: string, patch: Partial<MessageDisplayStamp>) => {
      Object.assign(messages.get(id)!, patch);
    }),
    ...(withPost
      ? {
          post: vi.fn(async (display: MessageDisplayStamp, body: string) => {
            const id = `msg-${++n}`;
            messages.set(id, { ...display, body });
            return id;
          }),
        }
      : {}),
  };
  return { displays, messages };
}

function setup(withPost = true) {
  const fake = createFakeGlassesStore();
  const clock = fakeClock();
  const { devices } = createFakeDeviceStore();
  const channel = fakeChannel(withPost);
  const deps = { store: fake.store, devices, now: clock.now, sleep: clock.sleep, displays: channel.displays };
  return { ...fake, ...channel, deps };
}

describe("glasses screens mirrored into the calling channel", () => {
  it("a render posts ONE display message, born linked both ways, with a text fallback", async () => {
    const { deps, rows, messages } = setup();
    const res = (await renderScreen(deps, USER, { screen_id: "usage", blocks: BLOCKS })) as { id: string };
    expect(messages.size).toBe(1);
    const [[id, msg]] = [...messages];
    expect(rows[0].channel_message_id).toBe(id);
    expect(msg).toMatchObject({ spec_version: 1, screen_id: "usage", glasses_message_id: res.id });
    expect(msg.body).toBe("Usage\nCredits 62%\n1. Top up\n2. Later");
  });

  it("a re-render and glasses_update patch the SAME message in place and clear its answer", async () => {
    const { deps, messages, displays } = setup();
    await renderScreen(deps, USER, { screen_id: "usage", blocks: BLOCKS });
    const [id] = [...messages.keys()];
    messages.get(id)!.answer = { block_id: "act", choice: "Later", index: 1, at: "t", via: "glasses" };
    await renderScreen(deps, USER, { screen_id: "usage", blocks: BLOCKS, wait_for_input: false });
    await updateScreen(deps, USER, { screen_id: "usage", patches: [{ id: "bar", value: 0.9 }] });
    expect(messages.size).toBe(1);
    expect(displays.post).toHaveBeenCalledOnce();
    const msg = messages.get(id)!;
    expect(msg.answer).toBeNull();
    expect(msg.blocks.find((b) => b.id === "bar")?.value).toBe(0.9);
  });

  it("glasses_ask shows as a question + selectable options, and a tap on the lens answers the card", async () => {
    const { deps, messages, rows } = setup();
    const pending = glassesAsk(deps, USER, { question: "Ship it?", options: ["Yes", "No"], timeout_sec: 300 });
    await vi.waitFor(() => expect(rows).toHaveLength(1));
    const [id] = [...messages.keys()];
    expect(messages.get(id)).toMatchObject({ wait_for_input: true, glasses_message_id: rows[0].id });
    expect(messages.get(id)!.blocks.map((b) => [b.id, b.type, b.selectable])).toEqual([
      ["question", "text", false],
      ["options", "list", true],
    ]);
    const outcome = await answerAsk(deps, USER, { id: rows[0].id, index: 1 });
    expect(outcome.ok).toBe(true);
    if (outcome.ok && outcome.message) await answerMirror(deps, USER, outcome.message, "glasses");
    expect(messages.get(id)!.answer).toMatchObject({ choice: "No", index: 1, via: "glasses" });
    await pending;
    expect(rows[0]).toMatchObject({ status: "answered", answer: { choice: "No" } });
  });

  it("a call from outside a channel (no post port) mirrors nothing and never fails the render", async () => {
    const { deps, rows, displays } = setup(false);
    await renderScreen(deps, USER, { screen_id: "usage", blocks: BLOCKS });
    expect(rows[0].channel_message_id).toBeNull();
    expect(displays.patch).not.toHaveBeenCalled();
    const failing = setup();
    vi.mocked(failing.displays.post!).mockRejectedValueOnce(new Error("down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(renderScreen(failing.deps, USER, { screen_id: "x", blocks: BLOCKS })).resolves.toMatchObject({ status: "pending" });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
