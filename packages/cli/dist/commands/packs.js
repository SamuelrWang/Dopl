"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPacksCommands = registerPacksCommands;
const client_factory_js_1 = require("../lib/client-factory.js");
const global_options_js_1 = require("../lib/global-options.js");
const output_js_1 = require("../lib/output.js");
function registerPacksCommands(program) {
    const packs = program
        .command("packs")
        .description("Browse installed knowledge packs");
    packs
        .command("list")
        .description("List installed knowledge packs")
        .addHelpText("after", "\nExamples:\n  $ dopl packs list\n  $ dopl packs list --json | jq '.packs[].id'\n")
        .action(async (_cmdOpts, cmd) => {
        const globals = (0, global_options_js_1.getGlobalOpts)(cmd);
        const client = await (0, client_factory_js_1.createClient)(globals);
        const { packs: rows } = await client.listPacks();
        if (globals.json) {
            (0, output_js_1.writeJson)({ packs: rows });
            return;
        }
        if (rows.length === 0) {
            (0, output_js_1.writeLine)("No knowledge packs installed.");
            return;
        }
        const table = (0, output_js_1.formatTable)(["ID", "NAME", "DESCRIPTION", "LAST SYNCED"], rows.map((p) => [
            p.id,
            p.name,
            (0, output_js_1.truncate)(p.description, 60),
            (0, output_js_1.formatDateCompact)(p.last_synced_at),
        ]));
        (0, output_js_1.writeLine)(table);
    });
    packs
        .command("files <pack>")
        .description("List files in a pack (metadata only)")
        .option("-c, --category <category>", "Restrict to one /docs/<category>/ subtree")
        .option("-l, --limit <n>", "Max results", (v) => Number.parseInt(v, 10))
        .addHelpText("after", "\nExamples:\n  $ dopl packs files rokid\n  $ dopl packs files rokid --category sdk --limit 20\n")
        .action(async (pack, cmdOpts, cmd) => {
        const globals = (0, global_options_js_1.getGlobalOpts)(cmd);
        const client = await (0, client_factory_js_1.createClient)(globals);
        const res = await client.kbList(pack, {
            category: cmdOpts.category,
            limit: cmdOpts.limit,
        });
        if (globals.json) {
            (0, output_js_1.writeJson)(res);
            return;
        }
        if (res.files.length === 0) {
            (0, output_js_1.writeLine)(`No files found in pack '${pack}'.`);
            return;
        }
        const grouped = new Map();
        for (const f of res.files) {
            const key = f.category ?? "(uncategorized)";
            const list = grouped.get(key) ?? [];
            list.push(f);
            grouped.set(key, list);
        }
        const categories = [...grouped.keys()].sort();
        for (const category of categories) {
            (0, output_js_1.writeLine)(`\n${category}/`);
            const files = grouped.get(category) ?? [];
            for (const f of files) {
                const title = f.title ?? "(untitled)";
                (0, output_js_1.writeLine)(`  ${f.path}  —  ${(0, output_js_1.truncate)(title, 80)}`);
            }
        }
    });
    packs
        .command("get <pack> <path>")
        .description("Fetch one file's markdown body from a pack")
        .addHelpText("after", "\nExamples:\n  $ dopl packs get rokid docs/sdk/camera.md\n  $ dopl packs get rokid docs/sdk/camera.md > camera.md\n")
        .action(async (pack, path, _cmdOpts, cmd) => {
        const globals = (0, global_options_js_1.getGlobalOpts)(cmd);
        const client = await (0, client_factory_js_1.createClient)(globals);
        const res = await client.kbGet(pack, path);
        if (globals.json) {
            (0, output_js_1.writeJson)(res);
            return;
        }
        (0, output_js_1.writeLine)(res.file.body);
    });
}
