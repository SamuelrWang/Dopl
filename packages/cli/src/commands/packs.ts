import { Command } from "commander";

import { createClient } from "../lib/client-factory.js";
import {
  formatDateCompact,
  formatTable,
  truncate,
  writeJson,
  writeLine,
} from "../lib/output.js";

interface GlobalOptions {
  json?: boolean;
  apiKey?: string;
  baseUrl?: string;
}

function getGlobalOpts(cmd: Command): GlobalOptions {
  return cmd.optsWithGlobals<GlobalOptions>();
}

export function registerPacksCommands(program: Command): void {
  const packs = program
    .command("packs")
    .description("Browse installed knowledge packs");

  packs
    .command("list")
    .description("List installed knowledge packs")
    .action(async (_cmdOpts: unknown, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      const client = await createClient(globals);
      const { packs: rows } = await client.listPacks();
      if (globals.json) {
        writeJson({ packs: rows });
        return;
      }
      if (rows.length === 0) {
        writeLine("No knowledge packs installed.");
        return;
      }
      const table = formatTable(
        ["ID", "NAME", "DESCRIPTION", "LAST SYNCED"],
        rows.map((p) => [
          p.id,
          p.name,
          truncate(p.description, 60),
          formatDateCompact(p.last_synced_at),
        ])
      );
      writeLine(table);
    });

  packs
    .command("files <pack>")
    .description("List files in a pack (metadata only)")
    .option("-c, --category <category>", "Restrict to one /docs/<category>/ subtree")
    .option("-l, --limit <n>", "Max results", (v) => Number.parseInt(v, 10))
    .action(
      async (
        pack: string,
        cmdOpts: { category?: string; limit?: number },
        cmd: Command
      ) => {
        const globals = getGlobalOpts(cmd);
        const client = await createClient(globals);
        const res = await client.kbList(pack, {
          category: cmdOpts.category,
          limit: cmdOpts.limit,
        });
        if (globals.json) {
          writeJson(res);
          return;
        }
        if (res.files.length === 0) {
          writeLine(`No files found in pack '${pack}'.`);
          return;
        }
        const grouped = new Map<string, typeof res.files>();
        for (const f of res.files) {
          const key = f.category ?? "(uncategorized)";
          const list = grouped.get(key) ?? [];
          list.push(f);
          grouped.set(key, list);
        }
        const categories = [...grouped.keys()].sort();
        for (const category of categories) {
          writeLine(`\n${category}/`);
          const files = grouped.get(category) ?? [];
          for (const f of files) {
            const title = f.title ?? "(untitled)";
            writeLine(`  ${f.path}  —  ${truncate(title, 80)}`);
          }
        }
      }
    );

  packs
    .command("get <pack> <path>")
    .description("Fetch one file's markdown body from a pack")
    .action(async (pack: string, path: string, _cmdOpts: unknown, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      const client = await createClient(globals);
      const res = await client.kbGet(pack, path);
      if (globals.json) {
        writeJson(res);
        return;
      }
      writeLine(res.file.body);
    });
}
