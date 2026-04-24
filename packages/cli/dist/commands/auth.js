"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAuthCommands = registerAuthCommands;
const readline_1 = require("readline");
const client_1 = require("@dopl/client");
const config_js_1 = require("../lib/config.js");
const client_factory_js_1 = require("../lib/client-factory.js");
const output_js_1 = require("../lib/output.js");
function getGlobalOpts(cmd) {
    return cmd.optsWithGlobals();
}
async function promptSecret(question) {
    const rl = (0, readline_1.createInterface)({ input: process.stdin, output: process.stderr });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}
function registerAuthCommands(program) {
    const auth = program
        .command("auth")
        .description("Manage Dopl API credentials");
    auth
        .command("login")
        .description("Store a Dopl API key for this CLI")
        .option("--base-url <url>", "Override API base URL for this login")
        .action(async (cmdOpts, cmd) => {
        const globals = getGlobalOpts(cmd);
        const existing = await (0, config_js_1.readConfig)();
        const key = await promptSecret("Paste your Dopl API key (sk-dopl-…): ");
        if (!key) {
            (0, output_js_1.writeError)("No key provided. Aborted.");
            process.exitCode = 1;
            return;
        }
        if (!key.startsWith("sk-dopl-")) {
            (0, output_js_1.writeError)("Warning: key does not start with `sk-dopl-`. Saving anyway.");
        }
        const baseUrl = cmdOpts.baseUrl ?? globals.baseUrl ?? existing.baseUrl;
        const next = {
            ...existing,
            apiKey: key,
            ...(baseUrl ? { baseUrl } : {}),
        };
        await (0, config_js_1.writeConfig)(next);
        const effectiveBase = next.baseUrl ?? (0, config_js_1.defaultBaseUrl)();
        (0, output_js_1.writeError)(`Saved to ${(0, config_js_1.configFilePath)()} (base: ${effectiveBase})`);
    });
    auth
        .command("logout")
        .description("Remove the stored Dopl API key")
        .action(async () => {
        const removed = await (0, config_js_1.clearConfig)();
        if (removed)
            (0, output_js_1.writeError)(`Cleared ${(0, config_js_1.configFilePath)()}`);
        else
            (0, output_js_1.writeError)("No credentials were stored.");
    });
    auth
        .command("whoami")
        .description("Check the current key's identity and admin status")
        .action(async (_cmdOpts, cmd) => {
        const globals = getGlobalOpts(cmd);
        const client = await (0, client_factory_js_1.createClient)(globals);
        const res = await pingWhoami(client);
        if (globals.json) {
            (0, output_js_1.writeJson)(res);
            return;
        }
        (0, output_js_1.writeLine)(`Status: ${res.ok ? "ok" : "error"}`);
        (0, output_js_1.writeLine)(`Admin:  ${res.is_admin ? "yes" : "no"}`);
        (0, output_js_1.writeLine)(`Base:   ${res.baseUrl}`);
    });
}
async function pingWhoami(client) {
    const baseUrl = client.getBaseUrl();
    try {
        const { is_admin } = await client.pingMcpStatus();
        return { ok: true, is_admin, baseUrl };
    }
    catch (err) {
        if (err instanceof client_1.DoplAuthError)
            throw err;
        return { ok: false, is_admin: false, baseUrl };
    }
}
