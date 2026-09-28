import { describe, expect, it } from "vitest";
import { createFakeGlassesStore, fakeClock } from "../testing/fake-store";
import { createFakeDeviceStore } from "../testing/fake-device-store";
import { answerAsk, dismissMessage, readInbox } from "../messages/inbox";
import {
  ScreenInvalidError,
  listTemplates,
  renderScreen,
  saveTemplate,
  updateScreen,
  useTemplate,
} from "./service";
import { fillTemplate, templateVariables } from "./template";
import type { ScreenPayload } from "../messages/types";

const USER = "11111111-1111-4111-8111-111111111111";
const BLOCKS = [
  { type: "text", id: "title", content: "Deploy" },
  { type: "progress", id: "bar", value: 0.2, label: "Build" },
  { type: "list", id: "act", items: ["Approve", "Hold"] },
];

function setup() {
  const fake = createFakeGlassesStore();
  const clock = fakeClock();
  const { devices, deviceRows } = createFakeDeviceStore();
  return { ...fake, clock, devices, deviceRows, deps: { store: fake.store, devices, now: clock.now, sleep: clock.sleep } };
}

describe("glasses_render", () => {
  it("validate_only returns compiled + preview and stores nothing", async () => {
    const { deps, rows } = setup();
    const res = (await renderScreen(deps, USER, { blocks: BLOCKS, validate_only: true })) as {
      ok: boolean;
      compiled: ScreenPayload;
      preview: string;
    };
    expect(res.ok).toBe(true);
    expect(res.compiled.containers).toHaveLength(3);
    expect(res.preview).toContain("[act*]");
    expect(rows).toHaveLength(0);
  });

  it("inserts a screen row, and the same screen_id replaces it live", async () => {
    const { deps, rows, clock } = setup();
    const a = await renderScreen(deps, USER, { screen_id: "deploy", blocks: BLOCKS });
    expect(a).toMatchObject({ screen_id: "deploy", status: "pending" });
    rows[0].status = "delivered";
    clock.advance(1000);
    const b = await renderScreen(deps, USER, { screen_id: "deploy", blocks: BLOCKS.slice(0, 1) });
    expect(b.id).toBe(a.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "screen", card_id: "deploy", status: "pending" });
    expect((rows[0].payload as ScreenPayload).containers).toHaveLength(1);
  });

  it("generates a screen_id when absent", async () => {
    const { deps } = setup();
    const r = await renderScreen(deps, USER, { blocks: BLOCKS });
    expect(r.screen_id).toMatch(/^s-[0-9a-f]{8}$/);
  });

  it("throws fixable JSON errors", async () => {
    const { deps } = setup();
    const err = await renderScreen(deps, USER, { blocks: [{ type: "list", items: [] }] }).catch((e) => e);
    expect(err).toBeInstanceOf(ScreenInvalidError);
    expect(JSON.parse(err.message)).toMatchObject({ ok: false, errors: [{ block: "b1", code: "bad_value" }] });
  });

  it("wait_for_input returns the tap from the device", async () => {
    const { deps, clock } = setup();
    let ticks = 0;
    clock.onSleep(async () => {
      if (++ticks !== 2) return;
      const inbox = await readInbox(deps, USER, null, 0);
      await answerAsk(deps, USER, { id: inbox.messages[0].id, choice: "Hold", index: 1, block_id: "act" });
    });
    const res = await renderScreen(deps, USER, { screen_id: "q", blocks: BLOCKS, wait_for_input: true });
    expect(res).toMatchObject({ status: "answered", input: { block_id: "act", choice: "Hold", index: 1 } });
  });

  it("wait_for_input returns dismissed promptly when the wearer leaves via back", async () => {
    const { deps, clock } = setup();
    let ticks = 0;
    clock.onSleep(async () => {
      if (++ticks !== 1) return;
      const inbox = await readInbox(deps, USER, null, 0);
      expect((await dismissMessage(deps, USER, { id: inbox.messages[0].id })).ok).toBe(true);
    });
    const start = clock.now();
    const res = await renderScreen(deps, USER, { screen_id: "q", blocks: BLOCKS, wait_for_input: true, timeout_sec: 120 });
    expect(res).toMatchObject({ status: "dismissed", input: null });
    expect(clock.now() - start).toBeLessThanOrEqual(3000);
  });

  it("wait_for_input times out without taking the screen down", async () => {
    const { deps, rows } = setup();
    const res = await renderScreen(deps, USER, { blocks: BLOCKS, wait_for_input: true, timeout_sec: 5 });
    expect(res).toMatchObject({ status: "timeout", input: null });
    expect(rows[0].status).toBe("pending");
  });
});

describe("device taps on screens", () => {
  it("records a click on a text-capture screen and lets a later tap win", async () => {
    const { deps, rows } = setup();
    const r = await renderScreen(deps, USER, { blocks: [{ type: "text", id: "t", content: "hi" }] });
    expect(await answerAsk(deps, USER, { id: r.id, choice: "click" })).toMatchObject({ ok: true });
    expect(rows[0].answer).toMatchObject({ choice: "click", index: 0, block_id: "t" });
    expect(await answerAsk(deps, USER, { id: r.id, choice: "click", index: 0 })).toMatchObject({ ok: true });
  });

  it("resolves a list index from the choice and rejects unknown blocks", async () => {
    const { deps, rows } = setup();
    const r = await renderScreen(deps, USER, { blocks: BLOCKS });
    expect(await answerAsk(deps, USER, { id: r.id, choice: "Approve" })).toMatchObject({ ok: true });
    expect(rows[0].answer).toMatchObject({ choice: "Approve", index: 0, block_id: "act" });
    expect(await answerAsk(deps, USER, { id: r.id, choice: "x", block_id: "nope" })).toMatchObject({ status: 400 });
  });
});

describe("glasses_update", () => {
  it("patches blocks by id, re-compiles and re-queues", async () => {
    const { deps, rows } = setup();
    await renderScreen(deps, USER, { screen_id: "d", blocks: BLOCKS });
    rows[0].status = "delivered";
    const u = await updateScreen(deps, USER, { screen_id: "d", patches: [{ id: "bar", value: 0.9 }, { id: "title", content: "Deploy done" }] });
    expect(u.status).toBe("pending");
    const [title, bar] = (rows[0].payload as ScreenPayload).containers;
    expect(title.content).toBe("Deploy done");
    expect(bar.content).toMatch(/ 90%$/);
  });

  it("names the valid ids when a patch misses", async () => {
    const { deps } = setup();
    await renderScreen(deps, USER, { screen_id: "d", blocks: BLOCKS });
    await expect(updateScreen(deps, USER, { screen_id: "d", patches: [{ id: "zzz", content: "x" }] })).rejects.toThrow(
      "no block 'zzz' on screen d; ids: title, bar, act",
    );
    await expect(updateScreen(deps, USER, { screen_id: "gone", patches: [{ id: "a" }] })).rejects.toThrow("no live screen");
  });
});

describe("templates", () => {
  it("fills strings, whole-value numbers and spread list items", () => {
    const spec = {
      blocks: [
        { type: "text", content: "Build {{name}} #{{n}}" },
        { type: "progress", value: "{{pct}}" },
        { type: "list", items: ["Top", "{{rows}}"] },
      ],
    };
    expect(templateVariables(spec)).toEqual(["n", "name", "pct", "rows"]);
    expect(fillTemplate(spec, { name: "web", n: 7, pct: 0.4, rows: ["a", "b"] })).toEqual({
      blocks: [
        { type: "text", content: "Build web #7" },
        { type: "progress", value: 0.4 },
        { type: "list", items: ["Top", "a", "b"] },
      ],
    });
    expect(() => fillTemplate(spec, { name: "web" })).toThrow("missing template data: n, pct, rows");
  });

  it("saves, lists and renders a template", async () => {
    const { deps, rows } = setup();
    const saved = await saveTemplate(deps, USER, {
      name: "Build",
      blocks: [{ type: "text", id: "t", content: "{{title}}" }, { type: "progress", id: "p", value: "{{pct}}" }],
    });
    expect(saved).toMatchObject({ name: "build", variables: ["pct", "title"] });
    expect((await listTemplates(deps, USER)).templates).toEqual([
      expect.objectContaining({ name: "build", variables: ["pct", "title"], blocks: 2 }),
    ]);
    const r = await useTemplate(deps, USER, { name: "build", data: { title: "CI", pct: 1 }, screen_id: "ci" });
    expect(r).toMatchObject({ screen_id: "ci", status: "pending" });
    expect((rows[0].payload as ScreenPayload).containers[1].content).toMatch(/ 100%$/);
    await expect(useTemplate(deps, USER, { name: "nope" })).rejects.toThrow("no template 'nope'; saved: build");
    await expect(saveTemplate(deps, USER, { name: "bad name!", blocks: [{ type: "text" }] })).rejects.toThrow("name must be");
  });
});
