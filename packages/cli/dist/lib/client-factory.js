"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MissingApiKeyError = void 0;
exports.resolveCredentials = resolveCredentials;
exports.createClient = createClient;
const client_1 = require("@dopl/client");
const config_js_1 = require("./config.js");
class MissingApiKeyError extends Error {
    constructor() {
        super("No Dopl API key found. Run `dopl auth login` or set DOPL_API_KEY.");
        this.name = "MissingApiKeyError";
    }
}
exports.MissingApiKeyError = MissingApiKeyError;
async function resolveCredentials(flags) {
    const cfg = await (0, config_js_1.readConfig)();
    let apiKey;
    let source = "config";
    if (flags.apiKey) {
        apiKey = flags.apiKey;
        source = "flag";
    }
    else if (process.env.DOPL_API_KEY) {
        apiKey = process.env.DOPL_API_KEY;
        source = "env";
    }
    else if (cfg.apiKey) {
        apiKey = cfg.apiKey;
        source = "config";
    }
    if (!apiKey)
        throw new MissingApiKeyError();
    const baseUrl = flags.baseUrl ?? process.env.DOPL_BASE_URL ?? cfg.baseUrl ?? (0, config_js_1.defaultBaseUrl)();
    return { apiKey, baseUrl, source };
}
async function createClient(flags) {
    const { apiKey, baseUrl } = await resolveCredentials(flags);
    return new client_1.DoplClient(baseUrl, apiKey, { toolHeaderName: "X-Dopl-Cli" });
}
