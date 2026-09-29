import { describe, expect, it } from "vitest";
import { loopbackClient } from "./loopback-client";

const req = (headers: Record<string, string>) =>
  new Request("https://www.usedopl.com/api/mcp", { method: "POST", headers: { host: "www.usedopl.com", ...headers } });

describe("loopbackClient", () => {
  it("pins the key's container over the header, and blank over neither", () => {
    expect(loopbackClient(req({ "x-workspace-id": "ws-h" }), "k", "ws-lock").client.getWorkspaceId()).toBe("ws-lock");
    expect(loopbackClient(req({ "x-workspace-id": "ws-h" }), "k", null).client.getWorkspaceId()).toBe("ws-h");
    expect(loopbackClient(req({ "x-workspace-id": " " }), "k", " ").client.getWorkspaceId()).toBeNull();
  });

  it("returns the one read of the recognized stamps, dropping unknown values", () => {
    const known = loopbackClient(
      req({ "x-dopl-runtime": "desktop-session", "x-dopl-vendor": "codex", "x-dopl-session-id": "s-1" }),
      "k",
      null,
    );
    expect([known.runtime, known.vendor, known.sessionId]).toEqual(["desktop-session", "codex", "s-1"]);
    const unknown = loopbackClient(req({ "x-dopl-runtime": "nope", "x-dopl-vendor": "Codex", "x-dopl-session-id": "bad id" }), "k", null);
    expect([unknown.runtime, unknown.vendor, unknown.sessionId]).toEqual([undefined, undefined, undefined]);
  });
});
