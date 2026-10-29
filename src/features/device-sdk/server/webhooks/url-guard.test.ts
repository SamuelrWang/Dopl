import { describe, expect, it } from "vitest";
import { checkEndpointUrl, isBlockedAddress, parseEndpointUrl } from "./url-guard";

describe("webhook URL guard", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fd00:ec2::254", "fc00::1",
    "::ffff:127.0.0.1", "::ffff:169.254.169.254", "64:ff9b::7f00:1", "not-an-ip",
  ])("🔒 blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:8.8.8.8"])(
    "allows public %s",
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  );

  it.each([
    ["http://example.com/hook", "https"],
    ["https://user:pw@example.com/hook", "credentials"],
    ["https://example.com/hook#x", "fragment"],
    ["https://127.0.0.1/hook", "private"],
    ["https://[::1]/hook", "private"],
    ["https://169.254.169.254/latest", "private"],
    ["https://localhost/hook", "private"],
    ["https://api.internal/hook", "private"],
    ["not a url", "valid URL"],
    ["", "characters"],
  ])("🔒 refuses %s", (url, reason) => {
    const r = parseEndpointUrl(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(reason);
  });

  it("accepts a public https URL and normalizes it", () => {
    expect(parseEndpointUrl("https://Example.com:8443/hooks/dopl?x=1")).toEqual({
      ok: true,
      url: "https://example.com:8443/hooks/dopl?x=1",
    });
  });

  it("🔒 register-time check refuses a host that resolves to a private address (any of them)", async () => {
    const r = await checkEndpointUrl("https://rebind.example.com/h", async () => ["93.184.216.34", "10.0.0.5"]);
    expect(r).toEqual({ ok: false, reason: "url resolves to a private or reserved address" });
  });

  it("register-time check refuses an unresolvable host, accepts a public one", async () => {
    expect(
      await checkEndpointUrl("https://nx.example.com/h", async () => {
        throw new Error("ENOTFOUND");
      })
    ).toEqual({ ok: false, reason: "url host does not resolve" });
    expect(await checkEndpointUrl("https://ok.example.com/h", async () => ["93.184.216.34"])).toEqual({
      ok: true,
      url: "https://ok.example.com/h",
    });
  });
});
