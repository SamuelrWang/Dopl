import { describe, expect, it } from "vitest";
import {
  CLIENT_INFO_HEADER,
  clientInfoFromSessionId,
  clientInfoSessionId,
  decodeClientInfo,
  encodeClientInfo,
  initializeClientInfo,
  narrowClientInfo,
  readClientInfoHeader,
} from "./mcp-client-info";

const post = (body: string) =>
  new Request("https://x.test/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) },
    body,
  });

describe("narrowClientInfo", () => {
  it("keeps name/title/version, scrubbed and clipped; drops junk", () => {
    expect(narrowClientInfo({ name: "claude-code", version: "2.1.0", extra: 1 })).toEqual({ name: "claude-code", version: "2.1.0" });
    expect(narrowClientInfo({ name: "x\n# y", title: "T", version: 3 })).toEqual({ name: "x # y", title: "T" });
    expect(narrowClientInfo({ name: "a".repeat(200) })?.name).toHaveLength(64);
    expect(narrowClientInfo({ name: "   " })).toBeNull();
    expect(narrowClientInfo("claude")).toBeNull();
    expect(narrowClientInfo(null)).toBeNull();
  });
});

describe("the session-id carrier", () => {
  it("round-trips through a legal Mcp-Session-Id (visible ASCII), unique per connection", () => {
    const info = { name: "codex-mcp-client", title: "Codex", version: "0.50.0" };
    const a = clientInfoSessionId(info);
    const b = clientInfoSessionId(info);
    expect(a).toMatch(/^[\x21-\x7E]+$/);
    expect(a).not.toBe(b);
    expect(clientInfoFromSessionId(a)).toEqual(info);
  });

  it("an id this server did not mint, or garbage, is no client info", () => {
    expect(clientInfoFromSessionId(null)).toBeNull();
    expect(clientInfoFromSessionId("some-other-servers-session")).toBeNull();
    expect(clientInfoFromSessionId("dci1.x.%%%")).toBeNull();
    expect(decodeClientInfo(Buffer.from("not json").toString("base64url"))).toBeNull();
  });

  it("the loopback header reads the same encoding", () => {
    const headers = new Headers({ [CLIENT_INFO_HEADER]: encodeClientInfo({ name: "cursor-vscode", version: "1.0" }) });
    expect(readClientInfoHeader({ headers })).toEqual({ name: "cursor-vscode", version: "1.0" });
    expect(readClientInfoHeader({ headers: new Headers() })).toBeUndefined();
  });
});

describe("initializeClientInfo — the cloned-body peek", () => {
  it("reads clientInfo off an initialize request and leaves the body for the transport", async () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1.0" } },
    });
    const req = post(body);
    expect(await initializeClientInfo(req)).toEqual({ name: "claude-code", version: "2.1.0" });
    expect(await req.text()).toBe(body);
  });

  it("anything else is null: a tool call, a GET, an oversized or unsized body, bad JSON", async () => {
    expect(await initializeClientInfo(post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} })))).toBeNull();
    expect(await initializeClientInfo(new Request("https://x.test/api/mcp"))).toBeNull();
    expect(await initializeClientInfo(post(`{"method":"initialize","pad":"${"x".repeat(20_000)}"}`))).toBeNull();
    expect(await initializeClientInfo(post('{"method":"initialize"'))).toBeNull();
  });
});
