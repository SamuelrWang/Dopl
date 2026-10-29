import { describe, expect, it, vi } from "vitest";
import type { StoredAction } from "../delivery-store";
import type { OutboxRow } from "../connect/store-types";
import { emitActionSettled } from "./action-events";

const row = (status: StoredAction["status"], id = "a1"): StoredAction => ({
  id,
  project_id: "p1",
  env: "live",
  end_user_id: null,
  device_id: "d1",
  source: "action",
  capability: "display.ask",
  intent: null,
  status,
  idempotency_key: "k",
  request_hash: "h",
  http_status: 200,
  response: {},
  result: status === "done" ? { index: 0, label: "Yes" } : null,
  error: status === "failed" ? { type: "device_error", code: "vendor_error", message: "x", retryable: true, doc_url: "https://dopl.dev/x" } : null,
  route_decision: null,
  created_at: "2026-10-28T00:00:00Z",
  updated_at: "2026-10-28T00:00:05Z",
});

describe("action settle webhooks", () => {
  it("done → action.completed, failed → action.failed, in-flight → nothing; data = public Action", async () => {
    const out: OutboxRow[] = [];
    const n = await emitActionSettled({ insertOutbox: async (r) => void out.push(r) }, [
      row("done", "a1"),
      row("failed", "a2"),
      row("delivered", "a3"),
      row("queued", "a4"),
    ]);
    expect(n).toBe(2);
    expect(out.map((o) => o.event_type)).toEqual(["action.completed", "action.failed"]);
    expect(out[0]).toMatchObject({ project_id: "p1", env: "live" });
    expect(out[0].payload).toMatchObject({
      id: `evt_${out[0].id}`,
      type: "action.completed",
      livemode: true,
      data: { action_id: "a1", device_id: "d1", capability: "display.ask", status: "done", result: { index: 0, label: "Yes" } },
    });
  });

  it("a failed outbox write never throws into the device's answer path", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const n = await emitActionSettled(
      {
        insertOutbox: async () => {
          throw new Error("db down");
        },
      },
      [row("done")]
    );
    expect(n).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
