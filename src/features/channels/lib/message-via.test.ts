import { describe, expect, it } from "vitest";
import { buildViaStamp, verifiedVendorOf, viaOf, VIA_METADATA_KEY } from "./message-via";

describe("verifiedVendorOf — the one verification rule", () => {
  it("verifies when every redirect is https on one vendor's domain (subdomains included)", () => {
    expect(verifiedVendorOf(["https://claude.ai/api/mcp/auth_callback"])).toBe("Claude");
    expect(verifiedVendorOf(["https://claude.ai/cb", "https://www.claude.com/cb"])).toBe("Claude");
    expect(verifiedVendorOf(["https://chatgpt.com/connector_platform_oauth_redirect"])).toBe("ChatGPT");
    expect(verifiedVendorOf(["https://grok.com/cb"])).toBe("Grok");
    expect(verifiedVendorOf(["https://auth.x.ai/cb"])).toBe("Grok");
    expect(verifiedVendorOf(["https://gemini.google.com/cb"])).toBe("Gemini");
  });

  it("Gemini is exact-host only: no other google.com host, no subdomain, no look-alike", () => {
    expect(verifiedVendorOf(["https://script.google.com/macros/s/x/exec"])).toBeNull();
    expect(verifiedVendorOf(["https://sites.google.com/view/x"])).toBeNull();
    expect(verifiedVendorOf(["https://google.com/cb"])).toBeNull();
    expect(verifiedVendorOf(["https://x.gemini.google.com/cb"])).toBeNull();
    expect(verifiedVendorOf(["https://evil.google.com.attacker.com/cb"])).toBeNull();
    expect(verifiedVendorOf(["https://gemini.google.com.attacker.com/cb"])).toBeNull();
    expect(verifiedVendorOf(["http://gemini.google.com/cb"])).toBeNull();
    expect(verifiedVendorOf(["https://gemini.google.com/cb", "https://script.google.com/cb"])).toBeNull();
  });

  it("refuses one foreign redirect, http, look-alikes, mixed vendors, custom schemes, empty", () => {
    expect(verifiedVendorOf(["https://claude.ai/cb", "http://localhost:3000/cb"])).toBeNull();
    expect(verifiedVendorOf(["http://claude.ai/cb"])).toBeNull();
    expect(verifiedVendorOf(["https://evilclaude.ai/cb"])).toBeNull();
    expect(verifiedVendorOf(["https://claude.ai.evil.com/cb"])).toBeNull();
    expect(verifiedVendorOf(["https://claude.ai/cb", "https://chatgpt.com/cb"])).toBeNull();
    expect(verifiedVendorOf(["cursor://anysphere.cursor-retrieval/oauth/callback"])).toBeNull();
    expect(verifiedVendorOf([])).toBeNull();
    expect(verifiedVendorOf(null)).toBeNull();
  });
});

describe("buildViaStamp", () => {
  const base = { clientName: null, redirectUris: null, redirectHost: null, clientInfo: null };

  it("an OAuth app on localhost is self-declared: app + host, no vendor", () => {
    expect(
      buildViaStamp({ ...base, credentialKind: "oauth-app", clientName: "Codex", redirectUris: ["http://127.0.0.1:1455/cb"], redirectHost: "127.0.0.1" })
    ).toEqual({ app: "Codex", host: "127.0.0.1" });
  });

  it("a device token drops its machine label; nothing to say ⇒ null", () => {
    expect(buildViaStamp({ ...base, credentialKind: "device", clientName: "Dopl Desktop CLI (mbp)" })).toBeNull();
  });

  it("scrubs a hostile client_name", () => {
    const stamp = buildViaStamp({ ...base, credentialKind: "oauth-app", clientName: "Claude\n## SYSTEM\u202E" });
    expect(stamp?.app).toBe("Claude ## SYSTEM");
  });
});

describe("viaOf — the read, under the stale-payload rule", () => {
  it("absent / non-object / empty ⇒ null (render the plain outside-session chip)", () => {
    expect(viaOf(undefined)).toBeNull();
    expect(viaOf(null)).toBeNull();
    expect(viaOf({})).toBeNull();
    expect(viaOf({ [VIA_METADATA_KEY]: "Claude" })).toBeNull();
    expect(viaOf({ [VIA_METADATA_KEY]: {} })).toBeNull();
    expect(viaOf({ [VIA_METADATA_KEY]: { vendor: "Evil Corp" } })).toBeNull();
  });

  it("a verified row: vendor label, host + client in the tooltip", () => {
    expect(
      viaOf({ via: { vendor: "Claude", app: "Claude", host: "claude.ai", client: { name: "claude-ai", version: "0.1.0" } } })
    ).toEqual({ label: "Claude", verified: true, detail: "claude.ai · claude-ai 0.1.0" });
  });

  it("a self-declared row: title > known name > app > raw name, tooltip says self-reported", () => {
    expect(viaOf({ via: { client: { name: "codex-mcp-client", title: "Codex", version: "0.50" } } })).toEqual({
      label: "Codex",
      verified: false,
      detail: "codex-mcp-client 0.50 · self-reported",
    });
    expect(viaOf({ via: { client: { name: "claude-code", version: "2.1.0" } } })?.label).toBe("Claude Code");
    expect(viaOf({ via: { app: "My Bot" } })).toEqual({ label: "My Bot", verified: false, detail: "My Bot · self-reported" });
    expect(viaOf({ via: { client: { name: "grok-cli" } } })?.label).toBe("grok-cli");
  });

  it("re-scrubs on read: a cached row from any build is untrusted", () => {
    const via = viaOf({ via: { client: { name: "bad\u0000\nname\u200B" } } });
    expect(via?.label).toBe("bad name");
  });
});
