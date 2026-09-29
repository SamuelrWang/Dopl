/**
 * `dopl_show` END TO END through the real client layer: a real `createServer` (granular set) over a
 * real MCP transport, calling a REAL `DoplClient` whose `fetch` is stubbed — so what is asserted is
 * the JSON body POSTed to `/api/displays` and the §4.3 result line. Also: `dopl_send_message` no
 * longer takes `display`, a legacy `kind="display"` is refused by name, and a structured-looking
 * plain send reads back the nudge tip.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DoplClient } from "@dopl/client";

import { createServer } from "../server.js";
import { WS } from "../surface-sweep.js";
import { UNKNOWN_CALLER } from "./identity.js";
import { LEGACY_DISPLAY_REFUSAL } from "./channel-ops-show.js";

const CH = { id: "9e6a4b44-d780-474e-be83-a90772724b94", slug: "demo", name: "Demo", visibility: "private" };
const DECISION = [
  { type: "heading", text: "Ship the migration now?" },
  { type: "choice", options: [{ label: "Ship now", recommended: true }, { label: "Wait" }] },
];

let shows: Array<Record<string, unknown>>;
let answer: Record<string, unknown>;
let posted: Record<string, unknown>;
const original = global.fetch;

beforeEach(() => {
  shows = [];
  answer = { display_id: "d-1a2b3c4d", message_id: "m1", channel_id: CH.id, channel_name: "Demo", glasses: "off", decision: true, tags: "1/1" };
  posted = { id: "m2", seq: 8, kind: "message", metadata: {}, authorUserId: "u1", authorKind: "agent" };
  global.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (method === "POST" && url.endsWith("/api/displays")) {
      const body = JSON.parse(String(init?.body));
      shows.push(body);
      if (body.blocks?.[0]?.type === "bogus") return json({ error: { code: "DISPLAY_INVALID", message: '{"ok":false,"errors":[{"code":"bad_value"}]}' } }, 400);
      return json(answer);
    }
    if (method === "POST" && url.includes("/messages")) return json({ message: posted });
    if (url.endsWith("/api/channels")) return json({ channels: [CH] });
    if (url.includes(`/api/channels/${CH.id}`)) return json({ channel: CH });
    if (url.includes("/api/workspaces")) return json({ workspaces: [WS] });
    return json({});
  }) as typeof fetch;
});
afterEach(() => {
  global.fetch = original;
});

async function call(name: string, args: Record<string, unknown>, toolSet: "granular" | "legacy" = "granular") {
  const client = new DoplClient("http://dopl.test", "dopl_at_test");
  const server = createServer(client, {
    toolSet,
    directory: [WS],
    workspace: WS,
    role: "owner",
    workspaceSource: "header pin",
    scopes: ["dopl.read", "dopl.write"],
    caller: { ...UNKNOWN_CALLER, userId: "u1" },
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "show-probe", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), mcp.connect(clientSide)]);
  const res = (await mcp.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
  return { text: res.content.map((c) => c.text).join("\n"), isError: res.isError === true };
}

describe("dopl_show", () => {
  it("posts the display to /api/displays as given and reads back one fact line", async () => {
    const res = await call("dopl_show", { channel: "demo", blocks: DECISION, mention: "@samuel", client_msg_id: "k1" });
    expect(res.isError).toBe(false);
    expect(shows).toEqual([{ origin: "dopl_show", channel: "demo", blocks: DECISION, mention: "@samuel", client_msg_id: "k1" }]);
    expect(res.text.split("\n")[0]).toBe("shown d-1a2b3c4d in #`Demo` · msg=m1 · decision tags=1/1 · glasses=off");
  });

  it("reports a wait's answer, a replace, and a skipped lens", async () => {
    answer = { ...answer, glasses: "skipped:does not fit", replaced: "new", status: "answered", answer: { block_id: "b2", index: 0, choice: "Ship now", at: "t", via: "glasses" } };
    const res = await call("dopl_show", { blocks: DECISION, wait: true, display_id: "ship-1" });
    expect(res.text.split("\n").slice(0, 2)).toEqual([
      "shown d-1a2b3c4d in #`Demo` · msg=m1 · decision tags=1/1 · glasses=skipped(does not fit) · replaced=new (was answered)",
      "answered 1 `Ship now` via glasses",
    ]);
  });

  it("surfaces the door's 400 as a fixable error", async () => {
    const res = await call("dopl_show", { blocks: [{ type: "bogus" }] });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('Nothing was shown: {"ok":false');
  });

  it("dopl_send_message takes no display; a legacy kind=display is refused by name", async () => {
    const send = await call("dopl_send_message", { channel: "demo", body: "x", kind: "record", display: { blocks: DECISION } });
    expect(send.isError).toBe(true);
    const legacy = await call("dopl_channel", { op: "send", channel: "demo", body: "x", kind: "display" }, "legacy");
    expect(legacy).toEqual({ text: LEGACY_DISPLAY_REFUSAL, isError: true });
  });

  it("a structured-looking plain send reads back the nudge tip", async () => {
    posted = { ...posted, displayHint: "choice" };
    const res = await call("dopl_send_message", { channel: "demo", body: "Which?\n1. a\n2. b", kind: "record" });
    expect(res.text).toMatch(/\nTip: a question with options is a decision — send it with dopl_request_decision or dopl_show/);
  });
});
