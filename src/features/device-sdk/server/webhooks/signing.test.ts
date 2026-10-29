import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { unwrap, verify, WebhookVerificationError } from "./__fixtures__/dopl-sdk-webhooks";
import { generateWebhookSecret, signWebhook, webhookMessageId } from "./signing";

/** The shared test vector (dopl-sdk tests/webhooks.test.ts). */
const SECRET = `whsec_${Buffer.from("test-secret-test-secret-32bytes!").toString("base64")}`;
const NOW = 1_800_000_000;
const PAYLOAD = JSON.stringify({
  type: "action.completed",
  timestamp: "2027-01-15T08:00:00Z",
  data: { action_id: "act_1" },
});

describe("webhook signing", () => {
  it("matches the shared vector (node:crypto reference)", () => {
    const h = signWebhook({ id: "msg_1", timestamp: NOW, body: PAYLOAD, secrets: [SECRET] });
    const key = Buffer.from(SECRET.slice("whsec_".length), "base64");
    const expected = createHmac("sha256", key).update(`msg_1.${NOW}.${PAYLOAD}`).digest("base64");
    expect(h).toEqual({ "webhook-id": "msg_1", "webhook-timestamp": String(NOW), "webhook-signature": `v1,${expected}` });
  });

  it("✅ verifies with the dopl-sdk unwrap and yields the typed event", async () => {
    const h = signWebhook({ id: "msg_1", timestamp: NOW, body: PAYLOAD, secrets: [SECRET] });
    const event = await unwrap(PAYLOAD, h, { secret: SECRET, now: NOW });
    expect(event).toMatchObject({ type: "action.completed", data: { action_id: "act_1" }, webhookId: "msg_1" });
  });

  it("✅ rotation overlap: both the new and the old secret verify", async () => {
    const next = generateWebhookSecret();
    const h = signWebhook({ id: "msg_2", timestamp: NOW, body: PAYLOAD, secrets: [next, SECRET] });
    expect(h["webhook-signature"].split(" ")).toHaveLength(2);
    await expect(verify(PAYLOAD, h, { secret: next, now: NOW })).resolves.toBeUndefined();
    await expect(verify(PAYLOAD, h, { secret: SECRET, now: NOW })).resolves.toBeUndefined();
  });

  it("🔒 a wrong secret, a tampered body or a stale timestamp is rejected by the SDK", async () => {
    const h = signWebhook({ id: "msg_3", timestamp: NOW, body: PAYLOAD, secrets: [SECRET] });
    await expect(verify(PAYLOAD, h, { secret: generateWebhookSecret(), now: NOW })).rejects.toBeInstanceOf(WebhookVerificationError);
    await expect(verify(PAYLOAD + " ", h, { secret: SECRET, now: NOW })).rejects.toBeInstanceOf(WebhookVerificationError);
    await expect(verify(PAYLOAD, h, { secret: SECRET, now: NOW + 301 })).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it("secrets are whsec_ + base64 of 32 bytes, unique", () => {
    const a = generateWebhookSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    expect(Buffer.from(a.slice(6), "base64")).toHaveLength(32);
    expect(generateWebhookSecret()).not.toBe(a);
    // The SQL RPCs accept exactly this shape.
    expect(a).toMatch(/^whsec_[A-Za-z0-9+/]{40,}={0,2}$/);
  });

  it("refuses no secret, a non-whsec secret and fractional timestamps", () => {
    expect(() => signWebhook({ id: "m", timestamp: NOW, body: "{}", secrets: [] })).toThrow();
    expect(() => signWebhook({ id: "m", timestamp: NOW, body: "{}", secrets: ["abc"] })).toThrow();
    expect(() => signWebhook({ id: "m", timestamp: NOW + 0.5, body: "{}", secrets: [SECRET] })).toThrow();
  });

  it("message id is msg_<delivery id>", () => {
    expect(webhookMessageId("0b3f")).toBe("msg_0b3f");
  });
});

describe("vendored SDK verifier", () => {
  const source = join(homedir(), "Downloads", "dopl-sdk", "packages", "sdk", "src", "webhooks", "index.ts");
  it.skipIf(!existsSync(source))("matches dopl-sdk's current source (refresh __fixtures__ when it moves)", () => {
    const upstream = readFileSync(source, "utf8")
      .split("\n")
      .filter((l) => !l.startsWith("import "))
      .join("\n");
    const vendored = readFileSync(join(__dirname, "__fixtures__", "dopl-sdk-webhooks.ts"), "utf8");
    expect(vendored.split("// ---- source below (imports removed) ----\n")[1]).toBe(upstream);
  });
});
