/**
 * `dopl_send_message(display)` END TO END through the real client layer (2026-09-28 regression):
 * a real `createServer` (granular set) over a real MCP transport, calling a REAL `DoplClient`
 * whose `fetch` is stubbed — so what is asserted is the JSON body POSTed to
 * `/api/channels/:id/messages`, the thing the loopback hands the route.
 *
 * ⚠ THE BUG: the `kind="record"` lane never forwarded `display`, so an external session's
 * record stored a text-only row and reported success. Every lane either forwards it or refuses.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DoplClient } from "@dopl/client";

import { createServer } from "../server.js";
import { WS } from "../surface-sweep.js";
import { UNKNOWN_CALLER } from "./identity.js";

const CH = { id: "9e6a4b44-d780-474e-be83-a90772724b94", slug: "demo", name: "Demo", visibility: "private" };
const DISPLAY = { blocks: [{ type: "text", content: "Flight UA 12", x: 8, y: 8, w: 270, h: 35 }], layout: "absolute" };

let posts: Array<Record<string, unknown>>;
/** When set, the POST answers the route's 400 for an invalid display. */
let reject400: boolean;
const original = global.fetch;

beforeEach(() => {
  posts = [];
  reject400 = false;
  global.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (method === "POST" && url.includes("/messages")) {
      posts.push(JSON.parse(String(init?.body)));
      if (reject400) {
        const error = { code: "VALIDATION_FAILED", message: "display: b1: two selectable lists" };
        return new Response(JSON.stringify({ error }), { status: 400, headers: { "content-type": "application/json" } });
      }
      return json({ message: { id: "m1", seq: 7, kind: "message", metadata: {}, authorUserId: "u1", authorKind: "agent" } });
    }
    if (url.endsWith("/api/channels")) return json({ channels: [CH] });
    if (url.includes(`/api/channels/${CH.id}`)) return json({ channel: CH });
    if (url.includes("/api/workspaces")) return json({ workspaces: [WS] });
    return json({});
  }) as typeof fetch;
});
afterEach(() => {
  global.fetch = original;
});

/** An EXTERNAL session: a plain token, no desktop runtime stamp, no container lock. */
async function send(args: Record<string, unknown>) {
  const client = new DoplClient("http://dopl.test", "dopl_at_test");
  const server = createServer(client, {
    toolSet: "granular",
    directory: [WS],
    workspace: WS,
    role: "owner",
    workspaceSource: "header pin",
    scopes: ["dopl.read", "dopl.write"],
    caller: { ...UNKNOWN_CALLER, userId: "u1" },
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "display-probe", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), mcp.connect(clientSide)]);
  const res = (await mcp.callTool({ name: "dopl_send_message", arguments: args })) as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  return { text: res.content.map((c) => c.text).join("\n"), isError: res.isError === true };
}

const base = { channel: CH.id, container: WS.id, body: "[demo] flights", display: DISPLAY };

describe("dopl_send_message carries `display` to the route", () => {
  it('kind="record" (the regression) — display rides beside intent:"chat"', async () => {
    const res = await send({ ...base, kind: "record", client_msg_id: "demo-display-flights" });
    expect(res.isError).toBe(false);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ body: "[demo] flights", intent: "chat", display: DISPLAY });
  });

  it("a plain addressed send", async () => {
    const res = await send({ ...base, to: "u2" });
    expect(res.isError).toBe(false);
    expect(posts[0]).toMatchObject({ display: DISPLAY, to: "u2" });
  });

  it("a threaded record", async () => {
    const res = await send({ ...base, kind: "record", thread: "t-1" });
    expect(res.isError).toBe(false);
    expect(posts[0]).toMatchObject({ display: DISPLAY, intent: "chat" });
  });
});

describe("a lane that cannot carry `display` REFUSES it — never a silent text-only post", () => {
  it.each([
    ["milestone", { kind: "milestone", thread: "t-1" }],
    ['thread="new"', { kind: "record", thread: "new", summary: "Log" }],
  ])("%s", async (_lane, extra) => {
    const res = await send({ ...base, ...extra });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("`display` is not carried");
    expect(posts).toEqual([]);
  });
});

describe("an invalid display ERRORS — nothing is posted text-only", () => {
  it("a display key the tool does not know is refused before the wire", async () => {
    const res = await send({ ...base, kind: "record", display: { ...DISPLAY, colour: "red" } });
    expect(res.isError).toBe(true);
    expect(posts).toEqual([]);
  });

  it("the route's 400 on invalid blocks surfaces as an error naming the cause", async () => {
    reject400 = true;
    const res = await send({ ...base, kind: "record" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("two selectable lists");
  });
});
