import { describe, expect, it, vi } from "vitest";
import { createFakeGlassesStore, fakeClock } from "../testing/fake-store";
import { createFakeDeviceStore } from "../testing/fake-device-store";
import { answerAsk, dismissMessage, parseInboxQuery, readInbox } from "./inbox";
import { glassesNotify } from "./service";

const USER = "11111111-1111-4111-8111-111111111111";

function setup() {
  const fake = createFakeGlassesStore();
  const clock = fakeClock();
  const { devices, deviceRows } = createFakeDeviceStore();
  return { ...fake, clock, devices, deviceRows, deps: { store: fake.store, devices, now: clock.now, sleep: clock.sleep } };
}

describe("inbox query", () => {
  it("parses inbox query", () => {
    const u = (q: string) => new URL(`http://x/api/glasses/device/inbox${q}`);
    expect(parseInboxQuery(u(""))).toEqual({ after: null, waitSec: 25 });
    expect(parseInboxQuery(u("?wait=90"))).toEqual({ after: null, waitSec: 25 });
    expect(parseInboxQuery(u("?wait=0&after=2026-09-26T12:00:00.123456+00:00"))).toEqual({
      after: "2026-09-26T12:00:00.123456+00:00",
      waitSec: 0,
    });
    expect(parseInboxQuery(u("?after=2026-09-26T12:00:00.123%2B00:00"))).toMatchObject({
      after: "2026-09-26T12:00:00.123+00:00",
    });
    expect(parseInboxQuery(u("?after=garbage"))).toEqual({ error: "after must be an ISO timestamp" });
  });
});

describe("inbox long-poll", () => {
  it("returns queued rows and marks them delivered", async () => {
    const { deps, rows } = setup();
    await glassesNotify(deps, USER, { title: "t", body: "b" });
    const res = await readInbox(deps, USER, null, 25);
    expect(res.messages).toHaveLength(1);
    expect(res.messages[0]).toMatchObject({ kind: "notify", status: "delivered", payload: { title: "t", body: "b" } });
    expect(rows[0].status).toBe("delivered");
  });

  it("re-sends the 15s overlap unchanged (the device dedupes by id + updated_at) and holds for newer", async () => {
    const { deps, clock } = setup();
    await glassesNotify(deps, USER, { title: "t", body: "b" });
    const first = await readInbox(deps, USER, null, 0);
    const cursor = first.messages[0].updated_at;
    const again = await readInbox(deps, USER, cursor, 0);
    expect(again.messages.map((m) => [m.id, m.updated_at])).toEqual([[first.messages[0].id, cursor]]);
    // Nothing newer than the cursor: the hold runs its full wait before answering.
    const start = clock.now();
    await readInbox(deps, USER, cursor, 6);
    expect(clock.now() - start).toBeGreaterThanOrEqual(4000);
  });

  it("includes rows that turned terminal after the cursor, so other devices clear them", async () => {
    const { deps, store, clock } = setup();
    const n = await glassesNotify(deps, USER, { title: "t", body: "b" });
    const first = await readInbox(deps, USER, null, 0);
    clock.advance(1000);
    await store.transition(USER, n.id, ["pending", "delivered"], "dismissed", new Date(clock.now()).toISOString());
    const res = await readInbox(deps, USER, first.messages[0].updated_at, 25);
    expect(res.messages).toEqual([expect.objectContaining({ id: n.id, status: "dismissed" })]);
  });

  it("drops rows touched more than 15s before the cursor", async () => {
    const { deps, clock } = setup();
    await glassesNotify(deps, USER, { title: "old", body: "b" });
    clock.advance(20_000);
    const res = await readInbox(deps, USER, new Date(clock.now()).toISOString(), 0);
    expect(res.messages).toEqual([]);
  });

  it("waits up to `wait` seconds and wakes on a new row", async () => {
    const { deps, clock } = setup();
    let ticks = 0;
    clock.onSleep(async () => {
      ticks += 1;
      if (ticks === 4) await glassesNotify(deps, USER, { title: "late", body: "b" });
    });
    const res = await readInbox(deps, USER, null, 25);
    expect(res.messages.map((m) => (m.payload as { title: string }).title)).toEqual(["late"]);
  });

  it("returns empty after the wait with nothing queued", async () => {
    const { deps, clock } = setup();
    const start = clock.now();
    const res = await readInbox(deps, USER, null, 3);
    expect(res.messages).toEqual([]);
    expect(clock.now() - start).toBeLessThanOrEqual(3000);
  });

  it("runs the pre-read hook each tick and survives its failure", async () => {
    const { deps } = setup();
    let calls = 0;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await readInbox(
      {
        ...deps,
        beforeRead: async () => {
          calls += 1;
          if (calls === 1) throw new Error("channel read failed");
          await glassesNotify(deps, USER, { title: "mirrored", body: "b" });
        },
      },
      USER,
      null,
      5,
    );
    expect(calls).toBe(2);
    expect(res.messages).toHaveLength(1);
    spy.mockRestore();
  });

  it("lazily expires stale rows", async () => {
    const { deps, rows, clock } = setup();
    await glassesNotify(deps, USER, { title: "t", body: "b", ttl_sec: 5 });
    clock.advance(6000);
    expect((await readInbox(deps, USER, null, 0)).messages).toEqual([]);
    expect(rows[0].status).toBe("expired");
  });
});

describe("answer + dismiss", () => {
  async function seedAsk(deps: ReturnType<typeof setup>["deps"]) {
    return deps.store.insert(USER, {
      kind: "ask",
      card_id: null,
      payload: { question: "q", options: ["Yes", "No"] },
      expires_at: new Date(deps.now() + 60_000).toISOString(),
      now: new Date(deps.now()).toISOString(),
    });
  }

  it("answers once, then 409", async () => {
    const { deps, rows } = setup();
    const row = await seedAsk(deps);
    expect(await answerAsk(deps, USER, { id: row.id, choice: "No", index: 1 })).toMatchObject({ ok: true });
    expect(rows[0]).toMatchObject({ status: "answered", answer: { choice: "No", index: 1 } });
    expect(await answerAsk(deps, USER, { id: row.id, choice: "Yes", index: 0 })).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("recovers the index from the choice when index is missing", async () => {
    const { deps, rows } = setup();
    const row = await seedAsk(deps);
    expect(await answerAsk(deps, USER, { id: row.id, choice: "Yes" })).toMatchObject({ ok: true });
    expect(rows[0].answer).toMatchObject({ choice: "Yes", index: 0 });
  });

  it("409s an expired ask and 404s a non-ask / unknown id", async () => {
    const { deps, clock } = setup();
    const row = await seedAsk(deps);
    clock.advance(61_000);
    expect(await answerAsk(deps, USER, { id: row.id, index: 0 })).toMatchObject({ status: 409 });
    const n = await glassesNotify(deps, USER, { title: "t", body: "b" });
    expect(await answerAsk(deps, USER, { id: n.id, index: 0 })).toMatchObject({ status: 404 });
    expect(await answerAsk(deps, USER, { id: "nope", index: 0 })).toMatchObject({ status: 404 });
  });

  it("dismisses and scopes to the user", async () => {
    const { deps, rows } = setup();
    const n = await glassesNotify(deps, USER, { title: "t", body: "b" });
    expect(await dismissMessage(deps, "22222222-2222-4222-8222-222222222222", { id: n.id })).toMatchObject({
      status: 404,
    });
    expect(await dismissMessage(deps, USER, { id: n.id })).toMatchObject({ ok: true });
    expect(rows[0].status).toBe("dismissed");
  });
});

describe("a screen choice linked to a channel decision (unified display)", () => {
  const payload = {
    screen_id: "d-1",
    spec_version: 1 as const,
    containers: [{ block_id: "c", kind: "list" as const, x: 8, y: 8, w: 560, h: 60, items: ["Go", "Hold"], capture: true }],
  };

  it("is answered once: a second tap is 409 and the first answer stands; unlinked screens still re-tap", async () => {
    const { store } = createFakeGlassesStore();
    const clock = fakeClock();
    const deps = { store, now: clock.now };
    const insert = () => store.insert(USER, { kind: "screen", card_id: "d-1", payload, expires_at: "2099-01-01T00:00:00Z", now: "2026-09-26T12:00:00Z" });
    const linked = await insert();
    await store.linkChannelMessage(USER, linked.id, "msg-1");
    expect((await answerAsk(deps, USER, { id: linked.id, index: 0 })).ok).toBe(true);
    expect(await answerAsk(deps, USER, { id: linked.id, index: 1 })).toMatchObject({ ok: false, status: 409 });
    expect((await store.get(USER, linked.id))?.answer).toMatchObject({ index: 0, choice: "Go" });
    const loose = await insert();
    expect((await answerAsk(deps, USER, { id: loose.id, index: 0 })).ok).toBe(true);
    expect((await answerAsk(deps, USER, { id: loose.id, index: 1 })).ok).toBe(true);
  });
});
