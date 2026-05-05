import "server-only";
import { ZodError } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  defaultComposioClient,
  type ComposioClient,
} from "./composio-client";
import {
  findConnectionForWorkspace,
  touchConnection,
} from "./repository";
import {
  IntegrationActionNotFoundError,
  IntegrationActionValidationError,
  IntegrationNotConnectedError,
} from "./errors";
import {
  actionNameForSlug,
  findAction,
  getProviderConfig,
} from "./providers";
import type {
  IntegrationActionDescriptor,
  IntegrationActionResult,
  IntegrationProvider,
} from "../types";

/**
 * Action discovery + execution for connected providers. Pulls the
 * full Composio toolkit catalog at runtime and merges with each
 * provider's hand-curated overrides, so adding a new write action
 * usually requires zero code — Composio's catalog is the source of
 * truth, our `providers.ts` only customizes the actions that need
 * friendlier params or response shaping.
 *
 * Lives in its own module (separate from `service.ts`) to keep both
 * files under the §2 file-size cap and to give a clean boundary
 * between OAuth/connection plumbing (service.ts) and the
 * action-execution layer (here).
 */

export type ActionsServiceDeps = {
  db?: SupabaseClient;
  broker?: ComposioClient;
};

function brokerEntityId(userId: string): string {
  return userId;
}

/**
 * In-process cache of Composio's per-toolkit tool catalog. Toolkits
 * have ~10–120 actions and the catalog rarely changes; a 5-minute
 * TTL keeps `list_integration_actions` from making a network round-
 * trip on every agent call. Keyed by toolkit slug so multiple
 * providers with the same broker share state cleanly.
 */
type CachedToolkit = {
  fetchedAt: number;
  tools: Awaited<ReturnType<ComposioClient["listToolkitTools"]>>;
};
const TOOLKIT_TTL_MS = 5 * 60 * 1000;
const toolkitCache = new Map<string, CachedToolkit>();

/**
 * Test-only escape hatch: drop the in-memory toolkit catalog cache so
 * the next `list_integration_actions` call re-fetches from the
 * broker. Production code never needs this — TTL handles refresh —
 * but tests need to start each case with a fresh cache so a previous
 * test's fake broker doesn't bleed into the next one.
 */
export function _resetToolkitCacheForTests(): void {
  toolkitCache.clear();
}

async function getToolkitCatalog(
  broker: ComposioClient,
  toolkitSlug: string
): Promise<CachedToolkit["tools"]> {
  const now = Date.now();
  const cached = toolkitCache.get(toolkitSlug);
  if (cached && now - cached.fetchedAt < TOOLKIT_TTL_MS) {
    return cached.tools;
  }
  const tools = await broker.listToolkitTools(toolkitSlug);
  toolkitCache.set(toolkitSlug, { fetchedAt: now, tools });
  return tools;
}

/**
 * Discovery for write actions. Merges the provider's hand-curated
 * registry with the broker's full toolkit catalog so every Composio
 * tool for a connected provider becomes available without per-action
 * code. Hand-curated entries override auto-generated ones by
 * normalized name (e.g. our `send_email` wraps Composio's
 * `GMAIL_SEND_EMAIL` with friendlier params).
 *
 * `query` does a case-insensitive substring filter against the action
 * name + summary. Critical for big toolkits — Calendar's catalog is
 * ~180KB unfiltered, Sheets is ~300KB. With a query like "event" or
 * "spreadsheet" the response collapses to a few KB, which is the
 * difference between a usable agent flow and an unusable one.
 */
export async function listIntegrationActions(
  provider: IntegrationProvider,
  deps: ActionsServiceDeps = {},
  options: { query?: string } = {}
): Promise<IntegrationActionDescriptor[]> {
  const broker = deps.broker ?? defaultComposioClient();
  const cfg = getProviderConfig(provider);

  const curated: IntegrationActionDescriptor[] = cfg.actions.map((a) => ({
    name: a.name,
    summary: a.summary,
    paramsJsonSchema: a.paramsJsonSchema,
    source: "curated",
  }));

  if (!cfg.composioToolkit) return filterByQuery(curated, options.query);

  let tools: CachedToolkit["tools"];
  try {
    tools = await getToolkitCatalog(broker, cfg.composioToolkit);
  } catch (err) {
    // Broker catalog unavailable — return at least the curated set so
    // the agent can still operate on the actions we hand-tuned.
    // Surface the failure to server logs so a sustained outage doesn't
    // hide behind the silent fallback.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[integrations] catalog fetch failed for toolkit "${cfg.composioToolkit}": ${message}`
    );
    return filterByQuery(curated, options.query);
  }

  const curatedNames = new Set(curated.map((a) => a.name));
  const auto: IntegrationActionDescriptor[] = [];
  for (const tool of tools) {
    const name = actionNameForSlug(tool.slug, cfg.composioToolkit);
    if (curatedNames.has(name)) continue;
    auto.push({
      name,
      summary: tool.description,
      paramsJsonSchema: tool.inputSchema,
      source: "auto",
    });
  }
  return filterByQuery([...curated, ...auto], options.query);
}

function filterByQuery(
  actions: IntegrationActionDescriptor[],
  query: string | undefined
): IntegrationActionDescriptor[] {
  if (!query) return actions;
  const q = query.toLowerCase().trim();
  if (!q) return actions;
  return actions.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      a.summary.toLowerCase().includes(q)
  );
}

/**
 * Run one named provider action with the agent-supplied params.
 * Resolution order:
 *   1. Hand-curated registry (typed via Zod, custom buildArgs/parseResponse).
 *   2. Auto-generated fallback: look up the Composio slug from the
 *      toolkit catalog by normalized name, pass params through to the
 *      broker. Composio validates and returns the raw response wrapped
 *      as `{ ok: true, data: raw }`.
 */
export async function executeIntegrationAction(
  ctx: { workspaceId: string; userId: string; provider: IntegrationProvider },
  input: { action: string; params: Record<string, unknown>; alias?: string },
  deps: ActionsServiceDeps = {}
): Promise<IntegrationActionResult> {
  const db = deps.db ?? supabaseAdmin();
  const broker = deps.broker ?? defaultComposioClient();
  const cfg = getProviderConfig(ctx.provider);

  const curated = findAction(ctx.provider, input.action);

  // Resolve the broker call shape: either curated or auto.
  let composioSlug: string;
  let brokerArgs: Record<string, unknown>;
  let parseResponse: (raw: Record<string, unknown>) => IntegrationActionResult;

  if (curated) {
    let parsedParams: Record<string, unknown>;
    try {
      parsedParams = curated.paramsSchema.parse(input.params) as Record<string, unknown>;
    } catch (err) {
      const message =
        err instanceof ZodError
          ? err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")
          : err instanceof Error
            ? err.message
            : String(err);
      throw new IntegrationActionValidationError(ctx.provider, input.action, message);
    }
    composioSlug = curated.composioSlug;
    brokerArgs = curated.buildArgs(parsedParams);
    parseResponse = curated.parseResponse;
  } else {
    if (!cfg.composioToolkit) {
      throw new IntegrationActionNotFoundError(ctx.provider, input.action);
    }
    const tools = await getToolkitCatalog(broker, cfg.composioToolkit);
    const match = tools.find(
      (t) => actionNameForSlug(t.slug, cfg.composioToolkit!) === input.action
    );
    if (!match) {
      throw new IntegrationActionNotFoundError(ctx.provider, input.action);
    }
    composioSlug = match.slug;
    brokerArgs = input.params;
    parseResponse = (raw) => ({ ok: true, data: raw });
  }

  const found = await findConnectionForWorkspace(db, {
    userId: ctx.userId,
    provider: ctx.provider,
    workspaceId: ctx.workspaceId,
    alias: input.alias,
  });
  if (!found || found.connection.status !== "connected") {
    throw new IntegrationNotConnectedError(ctx.provider);
  }

  const { raw } = await broker.executeAction({
    brokerConnectionId: found.brokerConnectionId,
    entityId: brokerEntityId(ctx.userId),
    provider: ctx.provider,
    slug: composioSlug,
    arguments: brokerArgs,
  });
  await touchConnection(db, found.connection.id);

  return parseResponse(raw);
}
