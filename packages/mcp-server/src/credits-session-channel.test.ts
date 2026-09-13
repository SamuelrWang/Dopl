/**
 * INVARIANT SUITE — **HOW THE CALLING CHANNEL REACHES THE CHARGE** (rule B,
 * Samuel 2026-09-13: *"charge the calling channel's container"*).
 *
 * 🔒 **THE WHOLE HOP, AND IT NEEDED NO NEW WIRE — WHICH IS THE POINT OF PINNING
 * IT.** The desktop stamps a session's slot key `<channelId>:<agentId|threadId>`
 * on `X-Dopl-Session-Id` (each runtime's `dopl-desktop-app/main/runtime/<vendor>/mcp.js`); the app's MCP
 * route reads it and hands it to the loopback client
 * (`src/app/api/mcp/route.ts` → `new DoplClient(…, { sessionId })`); the transport
 * stamps it on EVERY request, the credit consume POST included; and
 * `POST /api/mcp/credits/consume` splits the head into the channel whose container
 * pays (`src/shared/auth/session-header.ts › sessionChannelId`).
 *
 * ⚠ **SO THE THING THAT CAN BREAK IS SILENT: the header simply stops arriving**,
 * and every burn files itself as "Desktop agent" while every credit is still
 * charged — to the RESOURCE's container, which is rule B's channel-less fallback.
 * No test fails, no log line appears, and the /home histogram quietly collapses
 * into one bucket. These two cases are the pin that catches it.
 *
 * ⚠ **THE REGISTRAR ITSELF HAS NOTHING TO SAY ABOUT THE CHANNEL** — it charges
 * `client.consumeCredits(workspaceId)` and knows only the ADDRESSED container
 * (`credits.test.ts` pins that seam). The channel rides the transport, so this
 * file drives the REAL `DoplClient` over a stubbed `fetch`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DoplClient } from "@dopl/client";

const BASE = "http://localhost:3000";
/** A desktop slot key: `<channelId>:<agentId>`. */
const CHANNEL = "3f2b6c1e-8a4d-4c1f-9f77-0c5b2a9e1d44";
const SLOT = `${CHANNEL}:agent-7`;

let calls: Array<{ url: string; headers: Record<string, string> }>;
let original: typeof global.fetch;

beforeEach(() => {
  calls = [];
  original = global.fetch;
  global.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify({ allowed: true, used: 1 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  global.fetch = original;
});

describe("🔒 the consume POST carries the calling session, so the server can bill its channel", () => {
  it("stamps X-Dopl-Session-Id, whose head is the channel that pays", async () => {
    const client = new DoplClient(BASE, "k", { sessionId: SLOT });
    await client.consumeCredits("ws-42");

    const consume = calls.find((call) =>
      call.url.includes("/api/mcp/credits/consume")
    );
    expect(consume).toBeDefined();
    expect(consume?.headers["X-Dopl-Session-Id"]).toBe(SLOT);
    // ⚠ THE HEAD IS THE CHANNEL ID — the split the server makes
    // (`shared/auth/session-header.ts › sessionChannelId`). Asserted here too
    // because the two halves of the hop live in different trees and a slot-key
    // shape change is otherwise only visible on one side.
    expect(consume?.headers["X-Dopl-Session-Id"]?.split(":")[0]).toBe(CHANNEL);
    // The addressed container still rides its own explicit header — the channel
    // does not replace it, and the server needs both (rule B's fallback arm).
    expect(consume?.headers["X-Workspace-Id"]).toBe("ws-42");
  });

  it("🔒 sends NO session header when the connection has no session", async () => {
    // ⚠ THIS IS THE CHANNEL-LESS CALLER, AND IT IS ORDINARY, NOT A FAILURE: a
    // Claude Desktop or Claude Code connection sends no slot key, so the server
    // resolves NO channel and charges the RESOURCE's container as it always has.
    await new DoplClient(BASE, "k").consumeCredits("ws-42");

    const consume = calls.find((call) =>
      call.url.includes("/api/mcp/credits/consume")
    );
    expect(consume?.headers["X-Dopl-Session-Id"]).toBeUndefined();
  });
});
