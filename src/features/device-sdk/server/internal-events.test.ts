import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceEventRow } from "../types";
import { setDevEventSinkForTests } from "./events";

const ownerRow = { project_id: "p1", env: "live", dev_projects: { org_id: "o1" } };
const lookup = vi.fn(async (): Promise<{ data: unknown; error: { message: string } | null }> => ({ data: ownerRow, error: null }));
const outbox = vi.fn(async (_row: unknown) => {});

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (work: () => Promise<void>) => pending.push(work()),
}));
vi.mock("@/shared/supabase/admin", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "limit"]) chain[m] = () => chain;
  chain.maybeSingle = () => lookup();
  return { supabaseAdmin: () => chain };
});
vi.mock("./connect/store", () => ({ connectStore: { insertOutbox: (r: unknown) => outbox(r) } }));

const pending: Promise<void>[] = [];
const { logInboundMessage, logMirroredReply, messageTextForRow, MESSAGE_TEXT_MAX_CHARS } = await import("./internal-events");

const rows: DeviceEventRow[] = [];
const settle = async () => {
  await Promise.all(pending.splice(0));
};
const base = { userId: "u1", body: "  ship it  ", channelId: "c1", messageId: "m1" };

beforeEach(() => {
  rows.length = 0;
  outbox.mockClear();
  lookup.mockClear();
  lookup.mockResolvedValue({ data: ownerRow, error: null });
  setDevEventSinkForTests({ write: async (b) => void rows.push(...b) });
});

describe("message rows", () => {
  it("a Mac message is one row with its text, and no webhook", async () => {
    logInboundMessage({ ...base, source: { kind: "computer", device_id: "mac" } });
    await settle();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ operation: "message.from_desktop", device_kind: "desktop", device_id: "mac", message_text: "ship it", channel_id: "c1", message_id: "m1", capability: null, env: "live" });
    expect(outbox).not.toHaveBeenCalled();
  });

  it("a glasses message is a row and an input.utterance webhook carrying the text", async () => {
    logInboundMessage({ ...base, source: { kind: "glasses", device_id: "g2" } });
    await settle();
    expect(rows[0]).toMatchObject({ operation: "message.from_glasses", device_kind: "glasses", capability: "input.utterance", message_text: "ship it" });
    const out = (outbox.mock.calls[0] as unknown as [{ event_type: string; payload: { data: { data: { text: string } } } }])[0];
    expect(out.event_type).toBe("input.utterance");
    expect(out.payload.data.data.text).toBe("ship it");
  });

  it("a web post writes nothing and costs no read", async () => {
    logInboundMessage({ ...base, source: { kind: "web" } });
    await settle();
    expect(rows).toHaveLength(0);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("a user with no Dopl App end user writes nothing: nobody else's channels reach the log", async () => {
    lookup.mockResolvedValue({ data: null, error: null });
    logInboundMessage({ ...base, source: { kind: "computer" } });
    logMirroredReply({ userId: "u1", deviceId: "g2", channelId: "c1", messageId: "m2", body: "hi" });
    await settle();
    expect(rows).toHaveLength(0);
  });

  it("a failed lookup is swallowed: a message never fails on its log row", async () => {
    lookup.mockResolvedValue({ data: null, error: { message: "down" } } as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => logInboundMessage({ ...base, source: { kind: "computer" } })).not.toThrow();
    await expect(settle()).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it("a mirrored reply names the device it went to", async () => {
    logMirroredReply({ userId: "u1", deviceId: "g2", channelId: "c1", messageId: "m2", body: "done" });
    await settle();
    expect(rows[0]).toMatchObject({ operation: "message.reply_mirror", device_id: "g2", capability: "present.display", message_text: "done" });
    expect(rows[0].route_decision?.considered?.[0]).toMatchObject({ device_id: "g2", verdict: "chosen" });
  });

  it("text is capped and blank is null", () => {
    expect(messageTextForRow("   ")).toBeNull();
    expect(messageTextForRow("x".repeat(MESSAGE_TEXT_MAX_CHARS + 5))).toHaveLength(MESSAGE_TEXT_MAX_CHARS);
  });
});
