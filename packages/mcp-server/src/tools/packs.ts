/**
 * `dopl_packs` — Dopl's curated, READ-ONLY knowledge packs (specialist
 * verticals backed by public GitHub repos). Distinct from the user's own
 * knowledge bases (those live in the `kb_*` user-KB tools).
 *
 * Consolidates the old `dopl_packs(op='list')`, `dopl_packs(op='list_files')`, and `dopl_packs(op='get_file')` tools.
 * Follows the canonical pattern in `setups.ts`: one `register(...)` with an
 * `op` enum + a flat schema of all per-op params (optional), a handler that
 * switches on `op`, validates required params via `missingParams`, then calls
 * a lifted op-function. Op bodies are lifted verbatim from the old handlers.
 */

import { z } from "zod";
import type { DoplClient } from "@dopl/client";
import { missingParams, type RegisterTool, type ToolResponse } from "./respond";

const DESCRIPTION = `Browse Dopl's curated knowledge packs — specialist verticals (e.g. Rokid AR, Unity VR) backed by public GitHub repos. Read-only and distinct from the user's own knowledge bases. Set \`op\` to one of:
- "list" — list installed knowledge packs. Each pack exposes nested reference docs that the agent can pull on demand via op="list_files" and op="get_file". Call this when the user asks about a vertical you don't recognize, or to discover what specialist domains the engine covers.
- "list_files" — list files in a knowledge pack. Returns paths + titles + summaries — cheap, no bodies. Use this to browse what's available before drilling into a specific doc with op="get_file". Optional \`category\` narrows to one section (e.g. 'sdk' for /docs/sdk/*).
- "get_file" — fetch one file's full markdown body from a knowledge pack. Use after op="list_files" to drill into a specific doc. Always cite the returned path in your reply so the user can verify against the public repo.`;

export function registerPacksTools(
  register: RegisterTool,
  client: DoplClient,
): void {
  register(
    "dopl_packs",
    DESCRIPTION,
    {
      op: z.enum(["list", "list_files", "get_file"]).describe("Operation to perform."),
      pack: z
        .string()
        .optional()
        .describe("op=list_files / op=get_file: pack id from op=list, e.g. 'rokid'."),
      category: z
        .string()
        .optional()
        .describe("op=list_files: restrict to one /docs/<category>/ subtree."),
      limit: z
        .number()
        .optional()
        .describe("op=list_files: max results (default 50, max 500)."),
      path: z
        .string()
        .optional()
        .describe("op=get_file: file path within the pack, e.g. 'docs/sdk/camera.md'."),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "list":
          return opList(client);
        case "list_files": {
          const miss = missingParams("list_files", args, ["pack"]);
          if (miss) return miss;
          return opListFiles(client, args.pack as string, args.category, args.limit);
        }
        case "get_file": {
          const miss = missingParams("get_file", args, ["pack", "path"]);
          if (miss) return miss;
          return opGetFile(client, args.pack as string, args.path as string);
        }
      }
    },
  );
}

async function opList(client: DoplClient): Promise<ToolResponse> {
  const { packs } = await client.listPacks();
  if (packs.length === 0) {
    return { content: [{ type: "text" as const, text: "No knowledge packs installed." }] };
  }
  const lines = packs.map((p) => {
    const sdk = p.sdk_version ? ` (SDK ${p.sdk_version})` : "";
    const synced = p.last_synced_at
      ? ` — last synced ${p.last_synced_at}`
      : " — never synced";
    return `- **${p.name}** (id: \`${p.id}\`)${sdk}${synced}\n  ${p.description ?? "(no description)"}\n  Repo: ${p.repo_url}`;
  });
  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function opListFiles(
  client: DoplClient,
  pack: string,
  category?: string,
  limit?: number,
): Promise<ToolResponse> {
  const { files } = await client.kbList(pack, { category, limit });
  if (files.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: `No files found in pack \`${pack}\`${category ? ` for category \`${category}\`` : ""}.`,
        },
      ],
    };
  }
  const lines: string[] = [`## ${pack} — ${files.length} files\n`];
  for (const f of files) {
    const cat = f.category ? `[${f.category}] ` : "";
    const summary = f.summary ? ` — ${f.summary}` : "";
    lines.push(`- ${cat}**${f.title ?? f.path}** \`${f.path}\`${summary}`);
  }
  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function opGetFile(
  client: DoplClient,
  pack: string,
  path: string,
): Promise<ToolResponse> {
  const { file } = await client.kbGet(pack, path);
  const lines: string[] = [];
  lines.push(`# ${file.title ?? file.path}`);
  lines.push(`Pack: \`${pack}\` · Path: \`${file.path}\``);
  if (file.tags.length > 0) lines.push(`Tags: ${file.tags.join(", ")}`);
  if (file.summary) lines.push(`\n${file.summary}`);
  lines.push("\n---\n");
  lines.push(file.body);
  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}
