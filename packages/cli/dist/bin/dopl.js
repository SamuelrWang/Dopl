#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const debug_1 = __importDefault(require("debug"));
const commander_1 = require("commander");
const client_1 = require("@dopl/client");
const client_factory_js_1 = require("../lib/client-factory.js");
const global_options_js_1 = require("../lib/global-options.js");
const output_js_1 = require("../lib/output.js");
const auth_js_1 = require("../commands/auth.js");
const packs_js_1 = require("../commands/packs.js");
const update_check_js_1 = require("../lib/update-check.js");
const version_js_1 = require("../lib/version.js");
const cliLog = (0, debug_1.default)("dopl:cli");
const EXIT_USER_ERROR = 1;
const EXIT_AUTH = 2;
const EXIT_NETWORK = 3;
async function run() {
    await (0, update_check_js_1.maybeNotifyOfUpdate)();
    const program = new commander_1.Command();
    program
        .name("dopl")
        .description("Dopl CLI — browse and query the Dopl knowledge base from the shell")
        .version(version_js_1.packageVersion)
        .option("--api-key <key>", "Dopl API key (overrides env + config)")
        .option("--base-url <url>", "API base URL (overrides env + config)")
        .option("--json", "Emit JSON instead of human-readable output", false)
        .option("--verbose", "Log request/response trace to stderr", false)
        .option("--no-update-notifier", "Skip the once-a-day npm update check")
        .configureHelp({ showGlobalOptions: true });
    program.hook("preAction", (_thisCommand, actionCommand) => {
        const opts = (0, global_options_js_1.getGlobalOpts)(actionCommand);
        if (opts.verbose)
            debug_1.default.enable("dopl:*");
        cliLog("command=%s verbose=%s json=%s", actionCommand.name(), opts.verbose ? "yes" : "no", opts.json ? "yes" : "no");
    });
    (0, auth_js_1.registerAuthCommands)(program);
    (0, packs_js_1.registerPacksCommands)(program);
    await program.parseAsync(process.argv);
}
function formatApiError(err) {
    if (err.code && err.apiMessage)
        return `${err.code}: ${err.apiMessage}`;
    if (err.apiMessage)
        return err.apiMessage;
    return null;
}
function handleError(err) {
    if (err instanceof client_factory_js_1.MissingApiKeyError) {
        (0, output_js_1.writeError)(err.message);
        process.exit(EXIT_AUTH);
    }
    if (err instanceof client_1.DoplAuthError) {
        const detail = formatApiError(err);
        (0, output_js_1.writeError)(`Authentication failed (${err.status})${detail ? `: ${detail}` : ""}. Check your API key or run \`dopl auth login\`.`);
        process.exit(EXIT_AUTH);
    }
    if (err instanceof client_1.DoplApiError) {
        const detail = formatApiError(err);
        const prefix = err.status >= 500 ? "Server error" : "Request failed";
        (0, output_js_1.writeError)(`${prefix} (${err.status})${detail ? `: ${detail}` : ""}`);
        process.exit(err.status >= 500 ? EXIT_NETWORK : EXIT_USER_ERROR);
    }
    if (err instanceof client_1.DoplNetworkError) {
        (0, output_js_1.writeError)(`Network error: ${err.message}`);
        process.exit(EXIT_NETWORK);
    }
    (0, output_js_1.writeError)(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_USER_ERROR);
}
run().catch(handleError);
