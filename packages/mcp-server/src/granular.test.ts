/**
 * The granular set as SERVED (DMP-013 B1/B2): which set a connection lists, that the other stays
 * callable, the published annotations and titles, the per-tool param fence, the jobs a profile
 * serves, the decision and room-description seams, and that every granular call is its legacy twin
 * — same outcome, same backend calls, same charge. Real `createServer`, real transport; the backend
 * is a recording double, so both sides meet identical data.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { boot, call, sweep, type Booted, type JsonSchema } from "./surface-sweep.js";
import { CHANNEL_DESCRIPTION_MAX_CHARS } from "./granular-text-channels.js";
import { isWriteOp } from "./gating.js";
import {
  ALWAYS_LOAD_META,
  GRANULAR_TOOLS,
  GRANULAR_TOOL_NAMES,
  LEGACY_TOOL_NAMES,
  annotationsFor,
  bindingsOf,
  parseBinding,
  selectorOf,
} from "./tool-manifest.js";

const listedNames = async (b: Booted) => (await b.client.listTools()).tools.map((t) => t.name).sort();

describe("tool-set selection", () => {
  it("legacy lists the 11, granular lists the 39", async () => {
    expect(await listedNames(await boot("legacy"))).toEqual([...LEGACY_TOOL_NAMES].sort());
    expect(await listedNames(await boot("granular"))).toEqual([...GRANULAR_TOOL_NAMES].sort());
    expect(LEGACY_TOOL_NAMES.size).toBe(11);
  });

  it("the inactive set stays callable by name", async () => {
    const legacy = await boot("legacy");
    expect((await call(legacy, "dopl_list_workspaces", {})).text).toContain("alpha");
    const granular = await boot("granular");
    expect((await call(granular, "dopl_workspaces", {})).text).toContain("alpha");
  });

  it("a stale legacy call on a granular connection runs and answers in granular names", async () => {
    const granular = await boot("granular", { answers: { listKbBases: [] } });
    const legacySpelling = /\bdopl_(channel|kb|skill|ontology|chats|agent|map|members|status|workspaces)\b|\bop=/;
    // A pulled guide, and a refusal whose retry hint names the next call.
    const guide = await call(granular, "dopl_channel", { op: "rooms", action: "help" });
    expect(guide.isError).toBe(false);
    expect(guide.text).toContain("dopl_read_channel(");
    expect(guide.text).not.toMatch(legacySpelling);
    const refusal = await call(granular, "dopl_kb", { op: "get_tree", base: "notes" });
    expect(refusal).toMatchObject({ isError: true });
    expect(refusal.text).toMatch(/reason=base_not_found.*retry=dopl_browse_knowledge\(/s);
    expect(refusal.text).not.toMatch(legacySpelling);
  });

  it("a legacy dopl_search call still works where the granular tool took the name", async () => {
    const legacy = await boot("legacy");
    const granular = await boot("granular");
    const a = await call(legacy, "dopl_search", { query: "pricing", limit: 3 });
    const b = await call(granular, "dopl_search", { query: "pricing", limit: 3 });
    expect(b).toEqual(a);
    expect(granular.log).toEqual(legacy.log);
  });

  it("a profile offers a granular tool with only the jobs whose legacy tool it offers", async () => {
    const b = await boot("granular", { toolProfile: "dopl_only" });
    const offered = GRANULAR_TOOLS.filter((t) => bindingsOf(t).some((k) => parseBinding(k).tool !== "dopl_channel"));
    expect(await listedNames(b)).toEqual(offered.map((t) => t.name).sort());
    const guide = (await b.client.listTools()).tools.find((t) => t.name === "dopl_get_guide")!;
    const props = (guide.inputSchema as JsonSchema).properties!;
    expect(props.topic.enum).toEqual(["skill_authoring", "chats", "knowledge"]);
    // The channel guide's own param goes with it.
    expect(Object.keys(props)).toEqual(["topic"]);
    expect(await call(b, "dopl_get_guide", { topic: "channels" })).toMatchObject({ isError: true });
    expect((await call(b, "dopl_get_guide", { topic: "chats" })).isError).toBe(false);
  });

  it('topic="knowledge" serves the knowledge doctrine as the resource does: no backend call, no other param', async () => {
    const b = await boot("granular", { toolProfile: "dopl_only" });
    const res = await call(b, "dopl_get_guide", { topic: "knowledge" });
    const { contents } = await b.client.readResource({ uri: "dopl://doctrine/knowledge" });
    expect(res).toEqual({ text: (contents[0] as { text: string }).text, isError: false });
    expect(res.text).toContain("dopl_write_entry(section=)");
    expect(b.log).toEqual([]);
    // Where `section` is published (the channel guide takes it), this topic still refuses it.
    const refused = await call(await boot("granular"), "dopl_get_guide", { topic: "knowledge", section: "law" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/"section" not taken/);
  });
});

describe("what each tool publishes", () => {
  it("every tool in both sets is titled with its own name (Codex approval identity)", async () => {
    for (const set of ["legacy", "granular"] as const) {
      const { tools } = await (await boot(set)).client.listTools();
      expect(tools.filter((t) => t.title !== t.name).map((t) => t.name), set).toEqual([]);
    }
  });

  it("annotations and alwaysLoad come from the manifest", async () => {
    const { tools } = await (await boot("granular")).client.listTools();
    for (const t of GRANULAR_TOOLS) {
      const served = tools.find((s) => s.name === t.name)!;
      expect(served.annotations, t.name).toEqual(annotationsFor(t));
      expect(served._meta, t.name).toEqual(t.alwaysLoad ? ALWAYS_LOAD_META : undefined);
    }
  });

  it("readOnlyHint iff no bound key is a gated write", () => {
    for (const t of GRANULAR_TOOLS) {
      const writes = bindingsOf(t).some((k) => {
        const { tool, op } = parseBinding(k);
        return op !== undefined && isWriteOp(tool, op);
      });
      expect(annotationsFor(t).readOnlyHint, t.name).toBe(!writes);
    }
  });

  it("destructiveHint exactly where a binding overwrites or removes", () => {
    const overwrites = /(^|[._])(update|write|remove|restore|set|end|dissolve)/;
    for (const t of GRANULAR_TOOLS) {
      const hits = bindingsOf(t).some((k) => overwrites.test(parseBinding(k).op ?? ""));
      expect(annotationsFor(t).destructiveHint === true, t.name).toBe(hits);
    }
  });

  it("a multi-job tool's selector is required unless the manifest names a default", async () => {
    const { tools } = await (await boot("granular")).client.listTools();
    for (const t of GRANULAR_TOOLS) {
      const selector = selectorOf(t);
      if (!selector) continue;
      const schema = tools.find((s) => s.name === t.name)!.inputSchema as { required?: string[] };
      expect(schema.required?.includes(selector) ?? false, t.name).toBe(t.selectDefault === undefined);
    }
  });
});

describe.each(GRANULAR_TOOLS.map((t) => [t.name, t] as const))("%s refuses params outside its row", (_name, t) => {
  it("names each one", async () => {
    const b = await boot("granular");
    const selector = selectorOf(t);
    const job = selector ? { [selector]: Object.keys(t.bind)[0] } : {};
    const res = await call(b, t.name, { ...job, op: "list", stray_param: 1 });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/"op"/);
    expect(res.text).toMatch(/"stray_param"/);
    expect(b.log).toEqual([]);
  });
});

it("a row param the chosen job's legacy tool does not take is refused by name", async () => {
  const b = await boot("granular");
  const res = await call(b, "dopl_search", { within: "everything", query: "x", base: "notes" });
  expect(res).toMatchObject({ isError: true });
  expect(res.text).toMatch(/Invalid arguments for tool dopl_search: .*"base"/s);
  expect(b.log).toEqual([]);
});

describe("a decision is its own tool", () => {
  it('dopl_send_message refuses kind="decision" by name, before any backend call', async () => {
    const b = await boot("granular");
    const res = await call(b, "dopl_send_message", { channel: "eng", body: "x", kind: "decision" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/kind=\\"decision\\" is dopl_request_decision/);
    expect(b.log).toEqual([]);
  });

  it("dopl_request_decision fixes the kind: a caller cannot send one", async () => {
    const b = await boot("granular");
    const options = [{ label: "a", consequence: "b" }, { label: "c", consequence: "d" }];
    const res = await call(b, "dopl_request_decision", { channel: "eng", body: "x", summary: "q", options, kind: "message" });
    expect(res.text).toMatch(/Unrecognized key: \\"kind\\"/);
    expect(b.log).toEqual([]);
  });
});

describe("a room description reaches the route whole, past the legacy 200-char summary", () => {
  const eng = { id: "c-1", slug: "eng", name: "Eng", topic: null, updatedAt: "t" };
  const long = "d".repeat(CHANNEL_DESCRIPTION_MAX_CHARS);

  it("dopl_update_channel writes `description` as the topic", async () => {
    const b = await boot("granular", { answers: { listChannels: [eng], updateChannel: { ...eng, topic: long } } });
    const res = await call(b, "dopl_update_channel", { action: "update", channel: "eng", description: long });
    expect(res.isError).toBe(false);
    expect(b.log).toContain(`updateChannel ${JSON.stringify(["c-1", { topic: long }])}`);
  });

  it("dopl_create_channel opens the room with it", async () => {
    const b = await boot("granular");
    await call(b, "dopl_create_channel", { name: "Eng", description: long });
    expect(b.log.some((l) => l.startsWith("createChannel") && l.includes(long))).toBe(true);
  });

  it("past the route's cap it is refused before any backend call", async () => {
    const b = await boot("granular");
    const res = await call(b, "dopl_update_channel", { action: "update", channel: "eng", description: `${long}d` });
    expect(res.isError).toBe(true);
    expect(b.log).toEqual([]);
  });

  it("the legacy tool still takes no `description`", async () => {
    const b = await boot("legacy");
    const res = await call(b, "dopl_channel", { op: "rooms", action: "update", channel: "eng", description: "x" });
    expect(res.text).toMatch(/Unrecognized key: \\"description\\"/);
  });

  it("mirrors the route's cap", () => {
    const route = readFileSync(path.resolve(process.cwd(), "../../src/features/channels/schema.ts"), "utf8");
    expect(route).toContain(`safeOptionalLabel("Channel topic", ${CHANNEL_DESCRIPTION_MAX_CHARS})`);
  });
});

const INVALID = "MCP error -32602";

describe("each granular call is its legacy twin", async () => {
  const cases = await sweep();

  it.each(cases.map((c) => [c.label, c] as const))("%s", (_label, { legacy, granular }) => {
    // A schema refusal names the tool called, and a row param takes its first legacy owner's type
    // (dopl_search requires `query`; dopl_kb checks it after the charge): refused on both sides,
    // the granular one before any backend call.
    if (legacy.text.startsWith(INVALID) || granular.text.startsWith(INVALID)) {
      expect([legacy.isError, granular.isError, granular.log]).toEqual([true, true, []]);
      return;
    }
    // Same backend traffic, same outcome. The texts differ only in call spelling, which each set
    // renders for itself: `legacy-surface.test.ts` pins one side, `call-ref.test.ts` scans the other.
    expect(granular.log).toEqual(legacy.log);
    expect(granular.isError).toBe(legacy.isError);
  });

  it("every binding gets past the schema on both sides at least once", () => {
    const binding = (label: string) => label.replace(/ #\d+$/, "");
    const passed = (c: (typeof cases)[number]) => !c.legacy.text.startsWith(INVALID) && !c.granular.text.startsWith(INVALID);
    const reached = new Set(cases.filter(passed).map((c) => binding(c.label)));
    expect([...new Set(cases.map((c) => binding(c.label)))].filter((l) => !reached.has(l))).toEqual([]);
  });
});
