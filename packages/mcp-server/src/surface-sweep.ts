/**
 * TEST FIXTURE (excluded from the build): a real `createServer` over a real transport against a
 * recording backend double, and the SWEEP — every manifest binding called bare, with its required
 * params and with its whole row, once through the legacy tool on a legacy connection and once
 * through the granular tool on a granular one. `granular.test.ts` compares the two sides' backend
 * traffic, `legacy-surface.test.ts` pins the legacy texts, `call-ref.test.ts` scans the granular ones.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";

import { createServer } from "./server.js";
import {
  GRANULAR_TOOLS,
  parseBinding,
  selectorOf,
  type BindingKey,
  type GranularTool,
  type ToolSet,
} from "./tool-manifest.js";

export const WS: WorkspaceListItem = {
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

/** Every client method answers `{}` (or its `answers` entry) and is logged, so backend traffic is comparable. */
export function recordingClient(log: string[], answers: Record<string, unknown> = {}): DoplClient {
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
        return answers[prop] ?? {};
      };
    },
  });
}

export interface Booted {
  client: Client;
  log: string[];
}

export async function boot(
  toolSet: ToolSet,
  opts: { scopes?: string[]; toolProfile?: string; answers?: Record<string, unknown>; deprecateLegacy?: boolean } = {},
): Promise<Booted> {
  const log: string[] = [];
  const server = createServer(recordingClient(log, opts.answers), {
    toolSet,
    directory: [WS],
    workspace: WS,
    role: "owner",
    workspaceSource: "header pin",
    scopes: opts.scopes ?? ["dopl.read", "dopl.write"],
    toolProfile: opts.toolProfile,
    deprecateLegacy: opts.deprecateLegacy,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "surface-probe", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, log };
}

export interface CallResult {
  text: string;
  isError: boolean;
}

export async function call(b: Booted, name: string, args: Record<string, unknown>): Promise<CallResult> {
  const res = (await b.client.callTool({ name, arguments: args })) as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  return { text: res.content.map((c) => c.text).join("\n"), isError: res.isError === true };
}

/** The legacy call a binding stands for, as a caller of the legacy tool would spell it. */
export function legacySpelling(key: BindingKey, t: GranularTool): { tool: string; args: Record<string, unknown> } {
  const { tool, op } = parseBinding(key);
  const [base, action] = op?.split(".") ?? [];
  return { tool, args: { ...t.preset, ...(base && { op: base }), ...(action && { action }) } };
}

export function jobsOf(t: GranularTool): Array<[string | null, BindingKey]> {
  return typeof t.bind === "string" ? [[null, t.bind]] : Object.entries(t.bind);
}

export type JsonSchema = {
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

/** Random per-response fence tokens aside, a text is deterministic. */
export const normalize = (s: string) => s.replace(/_[0-9a-f]{8,}/g, "_HEX");

export interface SweepSide extends CallResult {
  log: string[];
}

export interface SweepCase {
  /** `<granular tool>(<job>) = <binding> #<variant>`. */
  label: string;
  legacy: SweepSide;
  granular: SweepSide;
}

/** Every binding, three arg variants each: bare, the granular schema's required params, the whole row. */
export async function sweep(): Promise<SweepCase[]> {
  const listed = async (set: ToolSet) => (await (await boot(set)).client.listTools()).tools;
  const bySet = { legacy: await listed("legacy"), granular: await listed("granular") };
  const schemaOf = (set: ToolSet, name: string) => bySet[set].find((s) => s.name === name)!.inputSchema as JsonSchema;
  const cases: SweepCase[] = [];
  for (const t of GRANULAR_TOOLS) {
    for (const [job, key] of jobsOf(t)) {
      const { tool, args } = legacySpelling(key, t);
      const legacyProps = schemaOf("legacy", tool).properties ?? {};
      const granular = schemaOf("granular", t.name);
      // Every param both tools publish; a hold's wait_ms aside.
      const fill = (params: readonly string[]) =>
        Object.fromEntries(
          params
            .filter((p) => p in legacyProps && p !== "wait_ms" && p !== selectorOf(t))
            .map((p) => [p, sample(granular.properties![p])]),
        );
      const selected = job ? { [selectorOf(t)!]: job } : {};
      const variants = [{}, fill(granular.required ?? []), fill(t.params)];
      for (const [i, extra] of variants.entries()) {
        const a = await boot("legacy");
        const b = await boot("granular");
        const legacy = await call(a, tool, { ...args, ...extra });
        const gran = await call(b, t.name, { ...selected, ...extra });
        cases.push({
          label: `${t.name}${job ? `(${job})` : ""} = ${key} #${i}`,
          legacy: { ...legacy, text: normalize(legacy.text), log: a.log.map(normalize) },
          granular: { ...gran, text: normalize(gran.text), log: b.log.map(normalize) },
        });
      }
    }
  }
  return cases;
}
