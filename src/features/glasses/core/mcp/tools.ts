import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  glassesAsk,
  glassesGetAnswer,
  glassesNotify,
  glassesShow,
  glassesStatus,
  platformOf,
  type GlassesDeps,
} from "../messages/service";
import { listTemplates, renderScreen, saveTemplate, updateScreen, useTemplate } from "../screens/service";
import { BLOCKS_DOC, BLOCK_TYPES } from "../screens/spec";
import { GLASSES_LIMITS as L, GlassesValidationError } from "../validation";

/**
 * The ONE glasses tool implementation. `exposure.ts` puts it on two surfaces:
 * `/api/mcp/glasses` and, for a caller with paired glasses, the main `/api/mcp`.
 * Every tool acts on the caller's own queue, which all their devices share.
 */

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const errorResult = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

async function runTool(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn()) }] };
  } catch (err) {
    if (err instanceof GlassesValidationError) return errorResult(err.message);
    return errorResult(`glasses tool failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const NEEDS_WRITE = errorResult("This credential lacks the dopl.write scope; reconnect with write access.");
const TEXT_RULE = "Plain text only: no emoji; curly quotes/long dashes are converted.";
/** Why an agent reaches for these tools, said once on the two that carry it (device-aware messages). */
const FOR_WEARER = "How a glasses wearer sees choices/structure (also posted in chat from a channel).";

export interface GlassesToolOptions {
  /** Fail closed: only an explicit `dopl.write` scope may queue anything. */
  canWrite: boolean;
  signal?: AbortSignal;
  /** Meter one call before its handler: the refusal text, else null. Absent = unmetered (tests). */
  charge?: (write: boolean) => Promise<string | null>;
}

const blocks = z.array(z.looseObject({ type: z.enum(BLOCK_TYPES as [string, ...string[]]), id: z.string().optional() })).describe(BLOCKS_DOC);
const layout = z.enum(["stack", "absolute"]).optional().describe("Default 'stack'.");
const waitArgs = {
  wait_for_input: z.boolean().optional().describe("Hold (<=200s) until the wearer taps; returns input, or status 'dismissed' if they leave via back."),
  timeout_sec: z.number().optional().describe("Seconds to wait for input (default 120)."),
};

export function registerGlassesTools(server: McpServer, deps: GlassesDeps, userId: string, opts: GlassesToolOptions): void {
  const { canWrite, signal, charge } = opts;
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
      description: `${FOR_WEARER} Ask a multiple-choice question; WAITS <=200s for the tap. question <=${L.question} bytes; ${L.options.min}-${L.options.max} options, each <=${L.option} bytes. Returns answered|timeout|dismissed, or pending (then glasses_get_answer). No emoji.`,
      inputSchema: z.object({
        question: z.string(),
        options: z.array(z.string()),
        timeout_sec: z.number().optional().describe("Seconds to wait (default 120)."),
      }),
    },
    (args) => write(() => glassesAsk(deps, userId, args, signal)),
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
        `${FOR_WEARER} Draw a screen from blocks (${platform.renderHint}). Same screen_id replaces it live. ` +
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
    (args) => maybeWrite(args.validate_only, () => renderScreen(deps, userId, args, signal)),
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
            items: z.array(z.string()).optional(),
            value: z.number().optional(),
            label: z.string().optional(),
          }),
        ),
      }),
    },
    (args) => write(() => updateScreen(deps, userId, args)),
  );

  server.registerTool(
    "glasses_save_template",
    {
      title: "glasses_save_template",
      description: "Save a reusable screen under a name. Strings/items may hold {{var}} placeholders (value:'{{pct}}' takes a number).",
      inputSchema: z.object({ name: z.string(), blocks, layout }),
    },
    (args) => write(() => saveTemplate(deps, userId, args)),
  );

  server.registerTool(
    "glasses_list_templates",
    {
      title: "glasses_list_templates",
      description: "Your saved screen templates with their {{variables}}.",
      inputSchema: z.object({}),
    },
    () => run(() => listTemplates(deps, userId)),
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
    (args) => maybeWrite(args.validate_only, () => useTemplate(deps, userId, args, signal)),
  );
}
