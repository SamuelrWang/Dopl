/**
 * A16's LAST THREE RESPONSE-SIZE KNOBS, driven end to end — `fields=` on
 * `dopl_members`, `response_format` on `dopl_ontology`, `max_chars` on
 * `dopl_agent(op="get")`.
 *
 * ⚠ **THEY WERE CLAIMED SHIPPED AND WERE NOT IN THE TREE (F-591).** The wave-B
 * spec's §5 B8 row and the batch-2 record both listed them as landed; the three
 * helpers existed in `response-size.ts` with nothing calling them, and every
 * ratchet stayed green because a knob that does not exist costs no characters.
 * ⚠ THE RATCHET IS NOT A COVERAGE GATE — that is the general lesson here, and it
 * is why these are driven through the real renderers rather than asserted off
 * the schema.
 *
 * THREE PROPERTIES PER KNOB, and the third is the one that makes it usable:
 *   1. the knob is PUBLISHED on the tool (an agent cannot send what it cannot see);
 *   2. it actually SHRINKS the render;
 *   3. it drops nothing a reader would be wrong without — bodies, counts and
 *      truncation notices survive, and `id` is not projectable at all.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { registerMembersTool } from "./members";
import { opGet as ontologyGet, opMap } from "./ontology-ops-read";
import { opGet as agentGet } from "./agent-ops-read";
import { UNKNOWN_CALLER } from "./identity";
import { stub } from "./narration-fixtures";
import type { RegisterTool, ToolResponse } from "./respond";

const text = (r: ToolResponse) => r.content.map((x) => x.text).join("\n");

/* ───────────────────────────── dopl_members ───────────────────────────── */

function memberRow(over: Record<string, unknown> = {}) {
  return {
    workspaceId: "ws-1",
    userId: "u-peer",
    role: "member",
    status: "active",
    joinedAt: "2026-01-01T00:00:00Z",
    invitedBy: null,
    invitedAt: null,
    lastSeenAt: null,
    email: "peer@example.com",
    displayName: "Peer",
    avatarUrl: null,
    teams: [{ id: "t-1", name: "Growth" }],
    ...over,
  };
}

async function members(args: Record<string, unknown>): Promise<string> {
  const client = stub({
    listWorkspaceMembers: vi.fn(async () => [memberRow()]),
  }) as DoplClient;
  let handler: ((a: unknown) => Promise<ToolResponse>) | null = null;
  let shape: Record<string, unknown> = {};
  const cap: RegisterTool = ((name: string, _d: string, s: unknown, h: unknown) => {
    if (name !== "dopl_members") return;
    shape = s as Record<string, unknown>;
    handler = h as (a: unknown) => Promise<ToolResponse>;
  }) as RegisterTool;
  registerMembersTool(cap, client, UNKNOWN_CALLER);
  if (!handler) throw new Error("dopl_members was not registered");
  expect(Object.keys(shape), "the knob must be PUBLISHED").toContain("fields");
  return text(await (handler as (a: unknown) => Promise<ToolResponse>)(args));
}

describe("dopl_members — `fields=`", () => {
  it("omitted: every field, byte-identical to the unprojected row", async () => {
    const out = await members({ op: "list" });
    expect(out).toContain("- `Peer` `peer@example.com` (`u-peer`) — **member** · active · `Growth`");
  });

  it("projects to the asked-for fields, and SHRINKS", async () => {
    const full = await members({ op: "list" });
    const only = await members({ op: "list", fields: "role" });
    expect(only).toContain("- `u-peer` — **member**");
    expect(only).not.toContain("Growth");
    expect(only.length).toBeLessThan(full.length);
  });

  it("🔒 `id` is neither listable nor omittable — it survives every projection", async () => {
    // Samuel's ruling. A roster row whose id can be projected away is a row
    // nothing else in the product can address.
    for (const fields of ["role", "teams", "id", "name,role", "nonsense"]) {
      expect(await members({ op: "list", fields }), fields).toContain("`u-peer`");
    }
  });

  it("an UNKNOWN name costs that field, never the whole read", async () => {
    // A validation error over a cosmetic preference, on a read the caller could
    // have made unfiltered, is the worse answer.
    const out = await members({ op: "list", fields: "rol,role" });
    expect(out).toContain("**member**");
    expect(out).toContain("## Members — 1");
  });
});

/* ──────────────────────────── dopl_ontology ───────────────────────────── */

const OBJECT = {
  id: "obj-1",
  name: "Acme",
  subtitle: "A customer",
  attributes: [{ label: "Stage", value: { kind: "text", value: "Won" } }],
  methods: [],
  relationships: [],
  childIds: [],
  template: [{ label: "Owner", kind: "text" }],
  updatedAt: "2026-07-31T00:00:00Z",
};

const SNAPSHOT = {
  clusters: [{ id: "c-1", slug: "crm", name: "CRM", purpose: "", columnIds: ["obj-1"] }],
  objects: { "obj-1": { ...OBJECT, childIds: [] } },
};

const ontologyClient = () =>
  stub({ getOntology: vi.fn(async () => SNAPSHOT) }) as DoplClient;

describe("dopl_ontology — `response_format`", () => {
  it("concise drops the LEGENDS and keeps every value", async () => {
    const detailed = text(await ontologyGet(ontologyClient(), "obj-1"));
    const concise = text(await ontologyGet(ontologyClient(), "obj-1", "concise"));

    // Metadata: a timestamp and its parenthetical instruction.
    expect(detailed).toContain("Version:");
    expect(concise).not.toContain("Version:");
    expect(concise).not.toContain("New objects created inside this one");
    expect(concise.length).toBeLessThan(detailed.length);

    // 🔒 CONTENT IS UNTOUCHED, which is the promise the shared `.describe()`
    // makes and the entire reason an agent would reach for the knob.
    for (const kept of ["Acme", "A customer", "Stage", "Won", "Owner"]) {
      expect(concise, kept).toContain(kept);
    }
  });

  it("op=map: concise drops the scope note and the drill-in pointer", async () => {
    const detailed = text(await opMap(ontologyClient()));
    const concise = text(await opMap(ontologyClient(), "concise"));
    expect(detailed).toContain("Drill in with");
    expect(concise).not.toContain("Drill in with");
    expect(concise).toContain("CRM");
  });
});

/* ────────────────────────────── dopl_agent ────────────────────────────── */

const TEMPLATE = {
  id: "t-1",
  name: "Researcher",
  description: "",
  instructions: "X".repeat(5000),
  model: null,
  fields: [],
  visibility: "private",
  knowledgeBases: [],
  createdBy: "u-me",
};

const agentClient = () =>
  stub({
    listAgentTemplates: vi.fn(async () => [TEMPLATE]),
    getAgentTemplate: vi.fn(async () => TEMPLATE),
  }) as DoplClient;

describe("dopl_agent(op=get) — `max_chars`", () => {
  it("clips the INSTRUCTIONS body and SAYS it clipped", async () => {
    const whole = text(await agentGet(agentClient(), "Researcher", "u-me"));
    const clipped = text(await agentGet(agentClient(), "Researcher", "u-me", 400));
    expect(whole.length).toBeGreaterThan(5000);
    expect(clipped.length).toBeLessThan(1500);
    // ⚠ A clipped document that renders like a whole one is the defect this
    // surface refuses everywhere else — the notice is the knob's licence.
    expect(clipped).toContain("CLIPPED to max_chars=400");
    expect(clipped).toContain("max_chars");
  });

  it("omitted: the whole document, no notice", async () => {
    const whole = text(await agentGet(agentClient(), "Researcher", "u-me"));
    expect(whole).not.toContain("CLIPPED");
    expect(whole).toContain("X".repeat(5000));
  });

  it("🔒 a FOREIGN prompt is clipped INSIDE its fence, never through it", async () => {
    // `fenceBody` closes with a per-response random suffix. Clipping the fenced
    // block would cut that close tag off and leave somebody else's system
    // prompt running to the end of the response with nothing marking where it
    // stops — a size knob may not break the one structure that makes a foreign
    // prompt safe to render.
    const out = text(await agentGet(agentClient(), "Researcher", "u-someone-else", 400));
    const open = /<body_([A-Za-z0-9]+)>/.exec(out);
    expect(open, "the fence must still open").not.toBeNull();
    expect(out, "the fence must still close").toContain(`</body_${open![1]}>`);
    // …and the notice sits OUTSIDE it, so the clipped prompt cannot be read as
    // having written the sentence about its own truncation.
    expect(out.indexOf("CLIPPED to max_chars=400")).toBeGreaterThan(
      out.indexOf(`</body_${open![1]}>`)
    );
  });
});
