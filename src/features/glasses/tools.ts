import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GLASSES_LIMITS as L, GlassesValidationError } from "./text";
import {
  glassesAsk,
  glassesGetAnswer,
  glassesNotify,
  glassesShow,
  glassesStatus,
  type GlassesDeps,
} from "./service";
import { registerScreenTools } from "./screen-tools";

/**
 * The ONE glasses tool implementation, registered on two surfaces:
 * `/api/mcp/glasses` (its own server, for external agents) and the main
 * `/api/mcp` — there only for a caller with at least one paired device
 * (`mcp-exposure.ts`), so users without glasses see no extra tools. Every tool
 * acts on the authenticated caller's own queue, which all their devices share.
 */

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

async function runTool(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn()) }] };
  } catch (err) {
    const message =
      err instanceof GlassesValidationError
        ? err.message
        : `glasses tool failed: ${err instanceof Error ? err.message : String(err)}`;
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

const NEEDS_WRITE: ToolResult = {
  content: [{ type: "text", text: "This credential lacks the dopl.write scope; reconnect with write access." }],
  isError: true,
};

const TEXT_RULE = "Plain text only: no emoji; curly quotes/long dashes are converted.";

export interface GlassesToolOptions {
  /** `/api/mcp`'s fail-closed rule: only an explicit `dopl.write` scope may queue anything. */
  canWrite: boolean;
  signal?: AbortSignal;
  /**
   * Meter one call (`mcp-exposure.ts › glassesCreditCharger`): the refusal text
   * when the wallet is empty, else null. Charged before the handler, once per
   * call, like every Dopl MCP tool; absent = unmetered (tests).
   */
  charge?: () => Promise<string | null>;
}

/** Register every glasses tool on `server`. */
export function registerGlassesTools(
  server: McpServer,
  deps: GlassesDeps,
  userId: string,
  opts: GlassesToolOptions,
): void {
  const { canWrite, signal, charge } = opts;
  const run = async (fn: () => Promise<unknown>): Promise<ToolResult> => {
    const refusal = charge ? await charge() : null;
    return refusal ? { content: [{ type: "text", text: refusal }], isError: true } : runTool(fn);
  };
  const write = (fn: () => Promise<unknown>) => (canWrite ? run(fn) : Promise.resolve(NEEDS_WRITE));

  server.registerTool(
    "glasses_notify",
    {
      title: "glasses_notify",
      description: `Flash a short notification on the user's G2 glasses. title <=${L.title} bytes, body <=${L.body} bytes. ${TEXT_RULE}`,
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
      description: `Ask the wearer a multiple-choice question and WAIT for the tap (holds up to 200s). question <=${L.question} bytes; ${L.options.min}-${L.options.max} options, each <=${L.option} bytes. Returns status answered|timeout|dismissed, or pending (then use glasses_get_answer). ${TEXT_RULE}`,
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
      description: "Are the glasses online (polled in the last 60s)? Returns {online, last_seen, active_count}.",
      inputSchema: z.object({}),
    },
    () => run(() => glassesStatus(deps, userId)),
  );

  registerScreenTools(server, { run, write }, deps, userId, signal);
}

/** The standalone `/api/mcp/glasses` server. */
export function createGlassesMcpServer(deps: GlassesDeps, userId: string, opts: GlassesToolOptions): McpServer {
  const server = new McpServer({ name: "dopl-glasses", version: "0.2.0" });
  registerGlassesTools(server, deps, userId, opts);
  return server;
}
