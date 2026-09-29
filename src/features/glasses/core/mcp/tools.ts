import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DoplApiError, type ShowDisplayInput, type ShowDisplayResult } from "@dopl/client";
import { z } from "zod";
import { fromV1 } from "@/features/display/core/normalize";
import { checkTemplateSpec, cleanTemplateName, DisplayInputError, templateSpecOf, templateVariables } from "@/features/display/core/template";
import { iso, nowOf } from "../clock";
import { glassesGetAnswer, glassesNotify, glassesShow, glassesStatus, platformOf, type GlassesDeps } from "../messages/service";
import { BLOCKS_DOC, BLOCK_TYPES } from "../screens/spec";
import { GLASSES_LIMITS as L, GlassesValidationError } from "../validation";

/**
 * The ONE glasses tool implementation. `exposure.ts` puts it on two surfaces: `/api/mcp/glasses`
 * and, for a caller with paired glasses, the main `/api/mcp`. Every tool acts on the caller's own
 * queue, which all their devices share.
 *
 * ⚠ **SHORTCUTS OVER THE ONE DISPLAY DOOR** (docs/specs/unified-display.md §4.4): `glasses_render`,
 * `glasses_ask`, `glasses_use_template` and `glasses_update` call `show` (`POST /api/displays` on
 * the caller's loopback client) with `target: "glasses"`, so a glasses screen and a `dopl_show`
 * display are one thing, posted and answered one way. Names, args and return shapes are unchanged.
 * `glasses_show` / `glasses_notify` stay lens notices (no channel copy).
 */

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const errorResult = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

async function runTool(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn()) }] };
  } catch (err) {
    if (err instanceof GlassesValidationError || err instanceof DisplayInputError) return errorResult(err.message);
    // The display door's 400 carries the fixable text (a compile error is `{"ok":false,"errors":[…]}`).
    if (err instanceof DoplApiError && err.status === 400 && err.apiMessage) return errorResult(err.apiMessage);
    return errorResult(`glasses tool failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const NEEDS_WRITE = errorResult("This credential lacks the dopl.write scope; reconnect with write access.");
const TEXT_RULE = "Plain text only: no emoji; curly quotes/long dashes are converted.";

export interface GlassesToolOptions {
  /** Fail closed: only an explicit `dopl.write` scope may queue anything. */
  canWrite: boolean;
  /** The display door (`client.showDisplay`). */
  show: (input: ShowDisplayInput) => Promise<ShowDisplayResult>;
  /** `"dopl_show"` where that tool is listed beside these (`/api/mcp`): the texts say they are its shortcuts. */
  shortcutOf?: "dopl_show" | null;
  /** Meter one call before its handler: the refusal text, else null. Absent = unmetered (tests). */
  charge?: (write: boolean) => Promise<string | null>;
}

const blocks = z.array(z.looseObject({ type: z.enum(BLOCK_TYPES as [string, ...string[]]), id: z.string().optional() })).describe(BLOCKS_DOC);
const layout = z.enum(["stack", "absolute"]).optional().describe("Default 'stack'.");
const waitArgs = {
  wait_for_input: z.boolean().optional().describe("Hold (<=200s) until the wearer taps; returns input, or status 'dismissed' if they leave via back."),
  timeout_sec: z.number().optional().describe("Seconds to wait for input (default 120)."),
};

/** A screen result in `glasses_render`'s shape: `{id, screen_id, status[, input]}`. */
function screenResult(r: ShowDisplayResult, waited: boolean) {
  const base = { id: r.glasses_message_id ?? null, screen_id: r.display_id, status: r.status ?? "pending" };
  if (!waited) return base;
  const a = r.answer;
  return {
    ...base,
    input: a ? { block_id: a.block_id || null, choice: a.choice, index: a.index, at: a.at } : null,
    ...(r.status === "pending" && { note: "Still on the glasses. Call glasses_get_answer with this id later." }),
  };
}

const PATCHABLE = ["content", "text", "items", "value", "label", "rows"] as const;

export function registerGlassesTools(server: McpServer, deps: GlassesDeps, userId: string, opts: GlassesToolOptions): void {
  const { canWrite, charge, show } = opts;
  const metered = (isWrite: boolean) => async (fn: () => Promise<unknown>) => {
    const refusal = charge ? await charge(isWrite) : null;
    return refusal ? errorResult(refusal) : runTool(fn);
  };
  const run = metered(false);
  const runWrite = metered(true);
  const write = (fn: () => Promise<unknown>) => (canWrite ? runWrite(fn) : Promise.resolve(NEEDS_WRITE));
  /** A dry run (`validate_only`) queues nothing, so it needs no write scope. */
  const maybeWrite = (validateOnly: unknown, fn: () => Promise<unknown>) => (validateOnly === true ? run(fn) : write(fn));
  const platform = platformOf(deps);
  /** Why an agent reaches for these tools: said once on the tools that draw. */
  const lead = opts.shortcutOf
    ? `Shortcut for ${opts.shortcutOf}(target="glasses"): also posted in your channel.`
    : "How a glasses wearer sees choices/structure (also posted in chat from a channel).";

  type RenderArgs = { screen_id?: string; blocks?: unknown[]; layout?: "stack" | "absolute"; wait_for_input?: boolean; timeout_sec?: number; ttl_sec?: number; validate_only?: boolean };
  const render = async (args: RenderArgs, extra: Partial<ShowDisplayInput>) => {
    const r = await show({
      target: "glasses",
      shortcut: "render",
      origin: "glasses_render",
      ...(args.screen_id && { display_id: args.screen_id }),
      ...(args.blocks && { blocks: fromV1(args.blocks) as Record<string, unknown>[] }),
      ...(args.layout && { layout: args.layout }),
      ...(args.wait_for_input && { wait: true }),
      ...(args.timeout_sec !== undefined && { timeout_sec: args.timeout_sec }),
      ...(args.ttl_sec !== undefined && { ttl_sec: args.ttl_sec }),
      ...(args.validate_only && { validate_only: true }),
      ...extra,
    });
    if (args.validate_only) return { ok: true, screen_id: r.display_id, compiled: r.compiled, preview: r.preview };
    return screenResult(r, args.wait_for_input === true);
  };

  server.registerTool(
    "glasses_notify",
    {
      title: "glasses_notify",
      description: `Flash a short notification on the user's glasses. title <=${L.title} bytes, body <=${L.body} bytes. ${TEXT_RULE}`,
      inputSchema: z.object({
        title: z.string(),
        body: z.string(),
        ttl_sec: z.number().optional().describe("Seconds before it expires (default 60)."),
      }),
    },
    (args) => write(() => glassesNotify(deps, userId, args)),
  );

  server.registerTool(
    "glasses_show",
    {
      title: "glasses_show",
      description: `Show a card of 1-${L.lines.max} lines on the glasses. title <=${L.title} bytes, each line <=${L.line} bytes. Reuse card_id to update the same card live. ${TEXT_RULE}`,
      inputSchema: z.object({
        title: z.string(),
        lines: z.array(z.string()),
        card_id: z.string().optional(),
        ttl_sec: z.number().optional().describe("Seconds before it expires (default 600)."),
      }),
    },
    (args) => write(() => glassesShow(deps, userId, args)),
  );

  server.registerTool(
    "glasses_ask",
    {
      title: "glasses_ask",
      description: `${lead} Ask a multiple-choice question; WAITS <=200s for the tap. question <=${L.question} bytes; ${L.options.min}-${L.options.max} options, each <=${L.option} bytes. Returns answered|timeout|dismissed, or pending (then glasses_get_answer). No emoji.`,
      inputSchema: z.object({
        question: z.string(),
        options: z.array(z.string()),
        timeout_sec: z.number().optional().describe("Seconds to wait (default 120)."),
      }),
    },
    (args) =>
      write(async () => {
        const r = await show({
          target: "glasses",
          shortcut: "ask",
          origin: "glasses_ask",
          blocks: [
            { id: "question", type: "text", content: args.question },
            { id: "options", type: "choice", options: args.options.map((label) => ({ label })) },
          ],
          wait: true,
          ...(args.timeout_sec !== undefined && { timeout_sec: args.timeout_sec }),
        });
        const a = r.answer;
        return {
          id: r.glasses_message_id ?? null,
          status: r.status,
          answer: a ? { choice: a.choice, index: a.index, at: a.at } : null,
          ...(r.status === "pending" && { note: "Still waiting on the wearer. Call glasses_get_answer with this id later." }),
        };
      }),
  );

  server.registerTool(
    "glasses_get_answer",
    {
      title: "glasses_get_answer",
      description: "Check a glasses_ask by id: {id, status, answer}.",
      inputSchema: z.object({ id: z.string() }),
    },
    (args) => run(() => glassesGetAnswer(deps, userId, args)),
  );

  server.registerTool(
    "glasses_status",
    {
      title: "glasses_status",
      description:
        "Your paired glasses: {online (any device seen in the last 60s), last_seen, active_count (queued messages), devices:[{id, name, online, last_seen}]}.",
      inputSchema: z.object({}),
    },
    () => run(() => glassesStatus(deps, userId)),
  );

  server.registerTool(
    "glasses_capabilities",
    {
      title: "glasses_capabilities",
      description: "Display size, limits and block types for glasses_render. Read once before designing screens.",
      inputSchema: z.object({}),
    },
    () => run(async () => platform.capabilities()),
  );

  server.registerTool(
    "glasses_render",
    {
      title: "glasses_render",
      description:
        `${lead} Draw a screen from blocks (${platform.renderHint}). Same screen_id replaces it live. ` +
        "validate_only:true previews (layout + ASCII) without sending.",
      inputSchema: z.object({
        screen_id: z.string().optional(),
        blocks,
        layout,
        ...waitArgs,
        ttl_sec: z.number().optional().describe("Seconds before it expires (default 600)."),
        validate_only: z.boolean().optional(),
      }),
    },
    (args) => maybeWrite(args.validate_only, () => render(args, {})),
  );

  server.registerTool(
    "glasses_update",
    {
      title: "glasses_update",
      description: "Patch blocks of a live screen by block id (content, items, value, label); it re-renders in place.",
      inputSchema: z.object({
        screen_id: z.string(),
        patches: z.array(
          z.object({
            id: z.string(),
            content: z.string().optional(),
            text: z.string().optional(),
            items: z.array(z.string()).optional(),
            value: z.number().optional(),
            label: z.string().optional(),
            rows: z.array(z.unknown()).optional(),
          }),
        ),
      }),
    },
    (args) =>
      write(async () => {
        const now = nowOf(deps);
        const row = await deps.store.findActiveCard(userId, args.screen_id, iso(now), "screen", ["pending", "delivered", "answered"]);
        if (!row) throw new GlassesValidationError(`no live screen '${args.screen_id}'; render it first with glasses_render`);
        const spec = templateSpecOf(await deps.store.getSpec(userId, row.id));
        const stored = spec.blocks.map((b, i): Record<string, unknown> => ({ id: `b${i + 1}`, ...(b as Record<string, unknown>) }));
        for (const p of args.patches) {
          const target = stored.find((b) => b.id === p.id);
          if (!target) throw new GlassesValidationError(`no block '${p.id}' on screen ${args.screen_id}; ids: ${stored.map((b) => b.id).join(", ")}`);
          for (const k of PATCHABLE) if (p[k] !== undefined) target[k] = p[k];
          // A v1 selectable list is a choice now: its `items` patch is its options.
          if (target.type === "choice" && p.items) {
            delete target.items;
            target.options = p.items.map((label) => ({ label }));
          }
        }
        const r = await show({ target: "glasses", shortcut: "render", origin: "glasses_update", display_id: args.screen_id, blocks: stored, layout: spec.layout });
        return screenResult(r, false);
      }),
  );

  server.registerTool(
    "glasses_save_template",
    {
      title: "glasses_save_template",
      description: "Save a reusable screen under a name. Strings/items may hold {{var}} placeholders (value:'{{pct}}' takes a number).",
      inputSchema: z.object({ name: z.string(), blocks, layout }),
    },
    (args) =>
      write(async () => {
        const name = cleanTemplateName(args.name);
        const spec = checkTemplateSpec({ blocks: args.blocks, layout: args.layout }, 1);
        const t = await deps.store.saveTemplate(userId, name, spec, iso(nowOf(deps)));
        return { name: t.name, variables: templateVariables(spec), updated_at: t.updated_at };
      }),
  );

  server.registerTool(
    "glasses_list_templates",
    {
      title: "glasses_list_templates",
      description: "Your saved screen templates with their {{variables}}.",
      inputSchema: z.object({}),
    },
    () =>
      run(async () => ({
        templates: (await deps.store.listTemplates(userId)).map((t) => ({
          name: t.name,
          variables: templateVariables(t.spec),
          blocks: templateSpecOf(t.spec).blocks.length,
          updated_at: t.updated_at,
        })),
      })),
  );

  server.registerTool(
    "glasses_use_template",
    {
      title: "glasses_use_template",
      description: "Render a saved template: data fills its {{variables}} (an array fills a list item '{{var}}').",
      inputSchema: z.object({
        name: z.string(),
        data: z.record(z.string(), z.unknown()).optional(),
        screen_id: z.string().optional(),
        ...waitArgs,
        ttl_sec: z.number().optional(),
        validate_only: z.boolean().optional(),
      }),
    },
    (args) =>
      maybeWrite(args.validate_only, () =>
        render(args, { origin: "glasses_use_template", template: args.name, ...(args.data && { data: args.data }) }),
      ),
  );
}
