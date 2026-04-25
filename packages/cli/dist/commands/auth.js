"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAuthCommands = registerAuthCommands;
const client_1 = require("@dopl/client");
const config_js_1 = require("../lib/config.js");
const client_factory_js_1 = require("../lib/client-factory.js");
const global_options_js_1 = require("../lib/global-options.js");
const output_js_1 = require("../lib/output.js");
const prompt_js_1 = require("../lib/prompt.js");
const version_js_1 = require("../lib/version.js");
function registerAuthCommands(program) {
    const auth = program
        .command("auth")
        .description("Manage Dopl API credentials");
    auth
        .command("login")
        .description("Store a Dopl API key for this CLI")
        .option("--base-url <url>", "Override API base URL for this login")
        .option("--no-verify", "Skip the live /mcp-status ping before saving")
        .addHelpText("after", "\nExamples:\n  $ dopl auth login\n  $ dopl auth login --base-url http://localhost:3000\n  $ dopl auth login --no-verify        # offline / proxy\n")
        .action(async (cmdOpts, cmd) => {
        const globals = (0, global_options_js_1.getGlobalOpts)(cmd);
        const existing = await (0, config_js_1.readConfig)();
        const key = await readKeyOrBail();
        if (!key)
            return;
        const baseUrl = (0, client_factory_js_1.nonEmpty)(cmdOpts.baseUrl) ??
            (0, client_factory_js_1.nonEmpty)(globals.baseUrl) ??
            (0, client_factory_js_1.nonEmpty)(existing.baseUrl) ??
            (0, config_js_1.defaultBaseUrl)();
        if (cmdOpts.verify !== false) {
            try {
                const { is_admin } = await verifyKey(baseUrl, key);
                (0, output_js_1.writeError)(`Verified against ${baseUrl}${is_admin ? " (admin)" : ""}.`);
            }
            catch (err) {
                const verdict = describeVerifyFailure(err, baseUrl);
                (0, output_js_1.writeError)(verdict.message);
                process.exitCode = verdict.exitCode;
                return;
            }
        }
        const next = { ...existing, apiKey: key };
        if ((0, client_factory_js_1.nonEmpty)(cmdOpts.baseUrl) || (0, client_factory_js_1.nonEmpty)(globals.baseUrl)) {
            next.baseUrl = baseUrl;
        }
        await (0, config_js_1.writeConfig)(next);
        (0, output_js_1.writeError)(`Saved to ${(0, config_js_1.configFilePath)()} (base: ${baseUrl})`);
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
        const globals = (0, global_options_js_1.getGlobalOpts)(cmd);
        const client = await (0, client_factory_js_1.createClient)(globals);
        const res = await pingWhoami(client);
        if (globals.json) {
            (0, output_js_1.writeJson)(res);
            return;
        }
        (0, output_js_1.writeLine)(`Status: ok`);
        (0, output_js_1.writeLine)(`Admin:  ${res.is_admin ? "yes" : "no"}`);
        (0, output_js_1.writeLine)(`Base:   ${res.baseUrl}`);
    });
}
async function readKeyOrBail() {
    try {
        const key = await (0, prompt_js_1.promptSecret)("Paste your Dopl API key (sk-dopl-…): ");
        const trimmed = key.trim();
        if (!trimmed) {
            (0, output_js_1.writeError)("No key provided. Aborted.");
            process.exitCode = 1;
            return null;
        }
        if (!trimmed.startsWith("sk-dopl-")) {
            (0, output_js_1.writeError)("Warning: key does not start with `sk-dopl-`.");
        }
        return trimmed;
    }
    catch (err) {
        if (err instanceof prompt_js_1.PromptAbortedError) {
            (0, output_js_1.writeError)("\nAborted.");
            process.exitCode = 130;
            return null;
        }
        throw err;
    }
}
async function verifyKey(baseUrl, apiKey) {
    const client = new client_1.DoplClient(baseUrl, apiKey, {
        toolHeaderName: "X-Dopl-Cli",
        clientIdentifier: version_js_1.clientIdentifier,
    });
    return client.pingMcpStatus();
}
function describeVerifyFailure(err, baseUrl) {
    if (err instanceof client_1.DoplAuthError) {
        return {
            message: `Authentication failed (${err.status}): key not saved. Pass --no-verify to override.`,
            exitCode: 2,
        };
    }
    if (err instanceof client_1.DoplApiError) {
        return {
            message: `Server rejected the key (${err.status}): ${err.message}. Key not saved.`,
            exitCode: err.status >= 500 ? 3 : 1,
        };
    }
    if (err instanceof client_1.DoplNetworkError) {
        return {
            message: `Could not reach ${baseUrl}: ${err.message}. Key not saved. Re-run with --no-verify to save anyway.`,
            exitCode: 3,
        };
    }
    throw err;
}
async function pingWhoami(client) {
    const baseUrl = client.getBaseUrl();
    const { is_admin } = await client.pingMcpStatus();
    return { is_admin, baseUrl };
}
