import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, listDeliveries } from "./api";
import { fakeWebhookStore } from "./fake-store";
import { generateWebhookSecret } from "./signing";

const T = { projectId: "11111111-1111-4111-8111-111111111111", env: "test" as const };

describe("webhook list cursors", () => {
  it("keeps the Postgres timestamp verbatim (microseconds), strict on decode", () => {
    const p = { createdAt: "2026-10-28T09:05:00.123456+00:00", id: "0e9d8c7b-6a5f-4e3d-9c2b-1a0f9e8d7c6b" };
    expect(decodeCursor(encodeCursor(p))).toEqual(p);
    for (const bad of ["x|y", "2026-10-28|0e9d8c7b-6a5f-4e3d-9c2b-1a0f9e8d7c6b", `${p.createdAt}|nope`, `${p.createdAt}|${p.id}|x`, `2026-10-28T09:05:00Z",or(1)|${p.id}`]) {
      expect(() => decodeCursor(Buffer.from(bad).toString("base64url")), bad).toThrow();
    }
  });

  it("✅ a page boundary inside one fan-out (same µs created_at) loses no row", async () => {
    const f = fakeWebhookStore();
    const ep = await f.store.createEndpoint(T, { url: "https://h.example.com/x", description: null, enabledEvents: null, secret: generateWebhookSecret() });
    for (let i = 0; i < 5; i++) f.enqueue(T, "connection.created");
    await f.store.fanOut(10);
    for (const d of f.deliveries) d.created_at = "2026-10-28T09:05:00.123456+00:00";
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const q = new URLSearchParams({ limit: "2", ...(cursor ? { cursor } : {}) });
      const page = await listDeliveries({ store: f.store }, T, ep.id, q);
      seen.push(...page.data.map((d) => d.id));
      cursor = page.next_cursor;
    } while (cursor);
    expect(seen.sort()).toEqual(f.deliveries.map((d) => d.id).sort());
  });
});
