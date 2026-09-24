/**
 * The granular set as SERVED (DMP-013 B1): which set a connection lists, that the other stays
 * callable, the published annotations and titles, the per-tool param fence, and that every granular
 * call is its legacy twin — same result, same backend calls, same charge. Real `createServer`, real
 * transport; the backend is a recording double, so both sides meet identical data.
 */

import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";

import { createServer } from "./server.js";
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
  type BindingKey,
  type GranularTool,
  type ToolSet,
} from "./tool-manifest.js";

const WS: WorkspaceListItem = {
  id: "11111111-1111-1111-1111-111111111111",
  ownerId: "owner",
  name: "Alpha",
  slug: "alpha",
  publicId: "pub-1",
  description: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  role: "owner",
};

/** Every client method answers `{}` and is logged, so a handler's backend traffic is comparable. */
function recordingClient(log: string[]): DoplClient {
  const fixed: Record<string, unknown> = {
    getWorkspaceId: () => null,
    setWorkspaceId: () => {},
    listWorkspaces: async () => ({ workspaces: [WS] }),
  };
  return new Proxy({} as DoplClient, {
    get(_target, prop) {
      if (typeof prop !== "string" || prop === "then") return undefined;
      if (prop in fixed) return fixed[prop];
      return async (...args: unknown[]) => {
        log.push(`${prop} ${JSON.stringify(args)}`);
        return {};
      };
    },
  });
}

interface Booted {
  client: Client;
  log: string[];
}

async function boot(
  toolSet: ToolSet,
  opts: { scopes?: string[]; toolProfile?: string } = {},
): Promise<Booted> {
  const log: string[] = [];
  const server = createServer(recordingClient(log), {
    toolSet,
    directory: [WS],
    workspace: WS,
    role: "owner",
    workspaceSource: "header pin",
    scopes: opts.scopes ?? ["dopl.read", "dopl.write"],
    toolProfile: opts.toolProfile,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "granular-probe", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, log };
}

const listedNames = async (b: Booted) => (await b.client.listTools()).tools.map((t) => t.name).sort();

async function call(b: Booted, name: string, args: Record<string, unknown>) {
  const res = (await b.client.callTool({ name, arguments: args })) as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  return { text: res.content.map((c) => c.text).join("\n"), isError: res.isError === true };
}

/** The legacy call a binding stands for, as a caller of the legacy tool would spell it. */
function legacySpelling(key: BindingKey, t: GranularTool): { tool: string; args: Record<string, unknown> } {
  const { tool, op } = parseBinding(key);
  const [base, action] = op?.split(".") ?? [];
  return { tool, args: { ...t.preset, ...(base && { op: base }), ...(action && { action }) } };
}

function jobsOf(t: GranularTool): Array<[string | null, BindingKey]> {
  return typeof t.bind === "string" ? [[null, t.bind]] : Object.entries(t.bind);
}

describe("tool-set selection", () => {
  it("legacy (the default) lists the 11, granular lists the 39", async () => {
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

  it("a legacy dopl_search call still works where the granular tool took the name", async () => {
    const legacy = await boot("legacy");
    const granular = await boot("granular");
    const a = await call(legacy, "dopl_search", { query: "pricing", limit: 3 });
    const b = await call(granular, "dopl_search", { query: "pricing", limit: 3 });
    expect(b).toEqual(a);
    expect(granular.log).toEqual(legacy.log);
  });

  it("a profile offers the granular tools whose every bound legacy tool it offers", async () => {
    const offChannel = GRANULAR_TOOLS.filter((t) => bindingsOf(t).every((k) => parseBinding(k).tool !== "dopl_channel"));
    expect(await listedNames(await boot("granular", { toolProfile: "dopl_only" }))).toEqual(
      offChannel.map((t) => t.name).sort(),
    );
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

type JsonSchema = {
  type?: string;
  enum?: unknown[];
  format?: string;
  minimum?: number;
  minItems?: number;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

/** A value the published schema accepts, so the call reaches past validation. */
function sample(s: JsonSchema): unknown {
  if (s.enum) return s.enum[0];
  if (s.anyOf) return sample(s.anyOf[0]);
  switch (s.type) {
    case "string":
      return s.format === "uuid" ? "11111111-1111-4111-8111-111111111111" : "x";
    case "number":
    case "integer":
      return Math.max(1, s.minimum ?? 1);
    case "boolean":
      return true;
    case "array":
      return Array.from({ length: Math.max(1, s.minItems ?? 1) }, () => sample(s.items ?? {}));
    default:
      return Object.fromEntries((s.required ?? []).map((k) => [k, sample(s.properties?.[k] ?? {})]));
  }
}

/** Random per-response fence tokens aside, the two texts must match byte for byte. */
const normalize = (s: string) => s.replace(/_[0-9a-f]{8,}/g, "_HEX");
const INVALID = "MCP error -32602";

describe("each granular call is its legacy twin", async () => {
  const bySet = {
    legacy: (await (await boot("legacy")).client.listTools()).tools,
    granular: (await (await boot("granular")).client.listTools()).tools,
  };
  const propsOf = (set: ToolSet, name: string) =>
    (bySet[set].find((s) => s.name === name)!.inputSchema as JsonSchema).properties ?? {};
  const cases = GRANULAR_TOOLS.flatMap((t) =>
    jobsOf(t).map(([job, key]) => [`${t.name}${job ? `(${job})` : ""} = ${key}`, t, job, key] as const),
  );

  it.each(cases)("%s", async (_label, t, job, key) => {
    const { tool, args } = legacySpelling(key, t);
    const legacyProps = propsOf("legacy", tool);
    const props = propsOf("granular", t.name);
    // Bare; the schema's required params; every row param this legacy tool also publishes (a hold's
    // wait_ms aside).
    const fill = (params: readonly string[]) =>
      Object.fromEntries(
        params
          .filter((p) => p in legacyProps && p !== "wait_ms" && p !== selectorOf(t))
          .map((p) => [p, sample(props[p])]),
      );
    const required = (bySet.granular.find((s) => s.name === t.name)!.inputSchema as JsonSchema).required ?? [];
    const selected = job ? { [selectorOf(t)!]: job } : {};
    let compared = 0;
    for (const extra of [{}, fill(required), fill(t.params)]) {
      const legacy = await boot("legacy");
      const granular = await boot("granular");
      const a = await call(legacy, tool, { ...args, ...extra });
      const b = await call(granular, t.name, { ...selected, ...extra });
      // A schema refusal names the tool called, and a row param takes its first legacy owner's type
      // (dopl_search requires `query`; dopl_kb checks it after the charge): refused on both sides,
      // the granular one before any backend call.
      if (a.text.startsWith(INVALID) || b.text.startsWith(INVALID)) {
        expect([a.isError, b.isError, granular.log]).toEqual([true, true, []]);
        continue;
      }
      expect(granular.log.map(normalize)).toEqual(legacy.log.map(normalize));
      expect(normalize(b.text)).toBe(normalize(a.text));
      expect(b.isError).toBe(a.isError);
      compared++;
    }
    expect(compared, "no variant got past the schema on both sides").toBeGreaterThan(0);
  });
});
