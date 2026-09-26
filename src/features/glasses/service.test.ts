import { describe, expect, it } from "vitest";
import { createFakeGlassesStore, fakeClock } from "./fake-store";
import { createFakeDeviceStore } from "./fake-device-store";
import {
  ASK_HOLD_CAP_SEC,
  glassesAsk,
  glassesGetAnswer,
  glassesNotify,
  glassesShow,
  glassesStatus,
} from "./service";

const USER = "11111111-1111-4111-8111-111111111111";

function setup() {
  const fake = createFakeGlassesStore();
  const clock = fakeClock();
  const { devices, deviceRows } = createFakeDeviceStore();
  return { ...fake, clock, devices, deviceRows, deps: { store: fake.store, devices, now: clock.now, sleep: clock.sleep } };
}

describe("glasses_notify", () => {
  it("inserts a sanitized notify row with a 60s default ttl", async () => {
    const { deps, rows } = setup();
    const res = await glassesNotify(deps, USER, { title: "Build ✅", body: "It’s green" });
    expect(res.status).toBe("pending");
    expect(rows[0].payload).toEqual({ title: "Build", body: "It's green" });
    expect(Date.parse(rows[0].expires_at) - Date.parse(rows[0].created_at)).toBe(60_000);
  });

  it("returns a fixable error for an oversized title", async () => {
    const { deps } = setup();
    await expect(glassesNotify(deps, USER, { title: "x".repeat(65), body: "b" })).rejects.toThrow(
      "title is 65 bytes; max 64",
    );
  });
});

describe("glasses_show", () => {
  it("updates the same card_id in place and re-queues it", async () => {
    const { deps, rows, clock } = setup();
    const first = await glassesShow(deps, USER, { title: "Deploy", lines: ["1/3"], card_id: "d" });
    rows[0].status = "delivered";
    clock.advance(1000);
    const second = await glassesShow(deps, USER, { title: "Deploy", lines: ["2/3"], card_id: "d" });
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("pending");
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ title: "Deploy", lines: ["2/3"] });
    expect(rows[0].updated_at > rows[0].created_at).toBe(true);
  });

  it("inserts a new card when the old one is dismissed", async () => {
    const { deps, rows } = setup();
    await glassesShow(deps, USER, { title: "T", lines: ["a"], card_id: "c" });
    rows[0].status = "dismissed";
    await glassesShow(deps, USER, { title: "T", lines: ["b"], card_id: "c" });
    expect(rows).toHaveLength(2);
  });

  it("rejects 5 lines", async () => {
    const { deps } = setup();
    await expect(
      glassesShow(deps, USER, { title: "T", lines: ["1", "2", "3", "4", "5"] }),
    ).rejects.toThrow("lines has 5 items; need 1-4");
  });
});

describe("glasses_ask hold", () => {
  const ask = { question: "Ship it?", options: ["Yes", "No"] };

  it("returns the answer once the device writes it", async () => {
    const { deps, store, clock } = setup();
    let ticks = 0;
    clock.onSleep(async () => {
      ticks += 1;
      if (ticks === 3) {
        const [row] = await store.listInbox(USER, new Date(clock.now()).toISOString(), null);
        await store.transition(USER, row.id, ["pending", "delivered"], "answered", "t", {
          choice: "No",
          index: 1,
          at: "t",
        });
      }
    });
    const res = await glassesAsk(deps, USER, ask);
    expect(res).toMatchObject({ status: "answered", answer: { choice: "No", index: 1 } });
  });

  it("times out, marks the row expired", async () => {
    const { deps, rows } = setup();
    const res = await glassesAsk(deps, USER, { ...ask, timeout_sec: 10 });
    expect(res).toMatchObject({ status: "timeout", answer: null });
    expect(rows[0].status).toBe("expired");
  });

  it("returns pending after the hold cap when timeout_sec exceeds it", async () => {
    const { deps, rows, clock } = setup();
    const start = clock.now();
    const res = await glassesAsk(deps, USER, { ...ask, timeout_sec: 600 });
    expect(res.status).toBe("pending");
    expect(clock.now() - start).toBeGreaterThanOrEqual(ASK_HOLD_CAP_SEC * 1000);
    expect(rows[0].status).toBe("pending");
  });

  it("stops holding when the client disconnects", async () => {
    const { deps } = setup();
    const ctrl = new AbortController();
    ctrl.abort();
    const res = await glassesAsk(deps, USER, ask, ctrl.signal);
    expect(res.status).toBe("pending");
  });

  it("validates options", async () => {
    const { deps } = setup();
    await expect(glassesAsk(deps, USER, { question: "q", options: ["only"] })).rejects.toThrow(
      "options has 1 items; need 2-4",
    );
  });
});

describe("glasses_get_answer / glasses_status", () => {
  it("reports status + answer and lazily expires", async () => {
    const { deps, store, clock } = setup();
    const row = await store.insert(USER, {
      kind: "ask",
      card_id: null,
      payload: { question: "q", options: ["a", "b"] },
      expires_at: new Date(clock.now() + 5000).toISOString(),
      now: new Date(clock.now()).toISOString(),
    });
    expect(await glassesGetAnswer(deps, USER, { id: row.id })).toEqual({
      id: row.id,
      status: "pending",
      answer: null,
    });
    clock.advance(6000);
    expect((await glassesGetAnswer(deps, USER, { id: row.id })).status).toBe("expired");
    await expect(glassesGetAnswer(deps, USER, { id: "bogus" })).rejects.toThrow("no glasses message");
  });

  it("lists the caller's devices; online within 60s of a device's last request", async () => {
    const { deps, devices, clock } = setup();
    expect(await glassesStatus(deps, USER)).toEqual({ online: false, last_seen: null, active_count: 0, devices: [] });
    const now = new Date(clock.now()).toISOString();
    const d = await devices.insertDevice({ userId: USER, name: "Lens", platform: "even_g2", linkedChannelId: null, linkedContainerId: null, now });
    await devices.insertDevice({ userId: "someone-else", name: "Other", platform: "even_g2", linkedChannelId: null, linkedContainerId: null, now });
    await devices.touchDevice(d.id, now);
    await glassesNotify(deps, USER, { title: "t", body: "b" });
    expect(await glassesStatus(deps, USER)).toEqual({
      online: true,
      last_seen: now,
      active_count: 1,
      devices: [{ id: d.id, name: "Lens", online: true, last_seen: now }],
    });
    clock.advance(61_000);
    expect(await glassesStatus(deps, USER)).toMatchObject({ online: false, active_count: 0 });
  });
});
