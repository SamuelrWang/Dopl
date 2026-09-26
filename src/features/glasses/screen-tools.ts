import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GlassesDeps } from "./service";
import {
  listTemplates,
  renderScreen,
  saveTemplate,
  updateScreen,
  useTemplate,
} from "./screen-service";
import { BLOCKS_DOC, BLOCK_TYPES, glassesCapabilities } from "./screen-spec";

/** Tool registration for agent-built screens; helpers come from `tools.ts`. */

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
export interface ToolHelpers {
  run: (fn: () => Promise<unknown>) => Promise<Result>;
  write: (fn: () => Promise<unknown>) => Promise<Result>;
}

const block = z.looseObject({
  type: z.enum(BLOCK_TYPES as [string, ...string[]]),
  id: z.string().optional(),
});
const blocks = z.array(block).describe(BLOCKS_DOC);
const layout = z.enum(["stack", "absolute"]).optional().describe("Default 'stack'.");
const waitArgs = {
  wait_for_input: z.boolean().optional().describe("Hold (<=200s) until the wearer taps; returns input."),
  timeout_sec: z.number().optional().describe("Seconds to wait for input (default 120)."),
};

export function registerScreenTools(
  server: McpServer,
  h: ToolHelpers,
  deps: GlassesDeps,
  userId: string,
  signal?: AbortSignal,
) {
  server.registerTool(
    "glasses_capabilities",
    {
      title: "glasses_capabilities",
      description: "Display size, limits and block types for glasses_render. Read once before designing screens.",
      inputSchema: z.object({}),
    },
    () => h.run(async () => glassesCapabilities()),
  );

  server.registerTool(
    "glasses_render",
    {
      title: "glasses_render",
      description:
        "Draw a custom screen on the glasses from blocks (576x288, max 8 text/list blocks). Same screen_id replaces it live. " +
        "validate_only:true returns the compiled layout + ASCII preview without sending. Errors are fixable JSON.",
      inputSchema: z.object({
        screen_id: z.string().optional(),
        blocks,
        layout,
        ...waitArgs,
        ttl_sec: z.number().optional().describe("Seconds before it expires (default 600)."),
        validate_only: z.boolean().optional(),
      }),
    },
    (args) =>
      args.validate_only === true
        ? h.run(() => renderScreen(deps, userId, args, signal))
        : h.write(() => renderScreen(deps, userId, args, signal)),
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
    (args) => h.write(() => updateScreen(deps, userId, args)),
  );

  server.registerTool(
    "glasses_save_template",
    {
      title: "glasses_save_template",
      description: "Save a reusable screen under a name. Strings/items may hold {{var}} placeholders (value:'{{pct}}' takes a number).",
      inputSchema: z.object({ name: z.string(), blocks, layout }),
    },
    (args) => h.write(() => saveTemplate(deps, userId, args)),
  );

  server.registerTool(
    "glasses_list_templates",
    {
      title: "glasses_list_templates",
      description: "Your saved screen templates with their {{variables}}.",
      inputSchema: z.object({}),
    },
    () => h.run(() => listTemplates(deps, userId)),
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
      args.validate_only === true
        ? h.run(() => useTemplate(deps, userId, args, signal))
        : h.write(() => useTemplate(deps, userId, args, signal)),
  );
}
