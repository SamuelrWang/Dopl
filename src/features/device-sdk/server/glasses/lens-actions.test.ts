import { describe, expect, it } from "vitest";
import type { GlassesMessage } from "@/features/glasses/core/messages/types";
import { MemoryDeliveryStore } from "../delivery-store-memory";
import { markDelivered, memoryLensActions, settle } from "./lens-actions";

/** `settle` reports the actions IT moved (the ask webhook and the Dopl app's lens bridge read this). */

const DEVICE = "dev-1";
const LENS = "11111111-1111-4111-8111-111111111111";

async function seeded() {
  const store = new MemoryDeliveryStore();
  const { action } = (await store.insertAction({
    project_id: "p1",
    env: "live",
    end_user_id: "eu1",
    device_id: DEVICE,
    source: "deliver",
    capability: "ask.choice",
    intent: "ask",
    status: "queued",
    idempotency_key: "key-1",
    request_hash: "h",
    http_status: 202,
    response: { delivery_id: "x", status: "queued" },
    result: { lens_message_id: LENS },
    error: null,
    route_decision: null,
  })) as { inserted: true; action: { id: string } };
  return { store, actions: memoryLensActions(store), actionId: action.id };
}

const answered = (): GlassesMessage =>
  ({ id: LENS, kind: "ask", status: "answered", answer: { index: 1, choice: "No", at: "2026-10-28T00:00:00.000Z" } }) as unknown as GlassesMessage;

describe("settle", () => {
  it("returns the moved row as stored after the move: tenant, key, done, answer", async () => {
    const { actions, actionId } = await seeded();
    const moved = await settle(actions, DEVICE, answered());
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({
      id: actionId,
      project_id: "p1",
      env: "live",
      idempotency_key: "key-1",
      status: "done",
      result: { lens_message_id: LENS, index: 1, label: "No" },
    });
  });

  it("a late hop (already settled) moves and reports nothing", async () => {
    const { actions } = await seeded();
    await settle(actions, DEVICE, answered());
    expect(await settle(actions, DEVICE, answered())).toEqual([]);
  });

  it("another device's row is neither moved nor reported", async () => {
    const { actions, store } = await seeded();
    expect(await settle(actions, "dev-2", answered())).toEqual([]);
    expect(store.actions[0].status).toBe("queued");
  });

  it("a non-ask row settles nothing", async () => {
    const { actions } = await seeded();
    expect(await settle(actions, DEVICE, { ...answered(), kind: "screen" } as GlassesMessage)).toEqual([]);
  });

  it("markDelivered still moves queued → delivered", async () => {
    const { actions, store } = await seeded();
    await markDelivered(actions, DEVICE, [LENS]);
    expect(store.actions[0].status).toBe("delivered");
  });
});
