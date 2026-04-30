"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MissingApiKeyError = void 0;
exports.nonEmpty = nonEmpty;
exports.resolveCredentials = resolveCredentials;
exports.createClient = createClient;
const client_1 = require("@dopl/client");
const config_js_1 = require("./config.js");
const version_js_1 = require("./version.js");
class MissingApiKeyError extends Error {
    constructor() {
        super("No Dopl API key found. Run `dopl auth login` or set DOPL_API_KEY.");
        this.name = "MissingApiKeyError";
    }
}
exports.MissingApiKeyError = MissingApiKeyError;
function nonEmpty(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}
async function resolveCredentials(flags) {
    const cfg = await (0, config_js_1.readConfig)();
    let apiKey;
    let source = "config";
    const fromFlag = nonEmpty(flags.apiKey);
    const fromEnv = nonEmpty(process.env.DOPL_API_KEY);
    const fromConfig = nonEmpty(cfg.apiKey);
    if (fromFlag) {
        apiKey = fromFlag;
        source = "flag";
    }
    else if (fromEnv) {
        apiKey = fromEnv;
        source = "env";
    }
    else if (fromConfig) {
        apiKey = fromConfig;
        source = "config";
    }
    if (!apiKey)
        throw new MissingApiKeyError();
    const baseUrl = nonEmpty(flags.baseUrl) ??
        nonEmpty(process.env.DOPL_BASE_URL) ??
        nonEmpty(cfg.baseUrl) ??
        (0, config_js_1.defaultBaseUrl)();
    // Workspace resolution priority:
    //   --workspace flag (UUID; slug-flag handling lives in the workspace
    //     command which resolves to UUID before constructing the client)
    //   DOPL_WORKSPACE_ID env var (UUID)
    //   config file workspaceId
    //   nothing → server falls back to the user's default workspace
    const workspaceId = nonEmpty(flags.workspace) ??
        nonEmpty(process.env.DOPL_WORKSPACE_ID) ??
        nonEmpty(cfg.workspaceId);
    const workspaceSlug = flags.workspace && flags.workspace === cfg.workspaceId
        ? cfg.workspaceSlug
        : nonEmpty(cfg.workspaceSlug);
    return { apiKey, baseUrl, source, workspaceId, workspaceSlug };
}
async function createClient(flags) {
    const { apiKey, baseUrl, workspaceId } = await resolveCredentials(flags);
    return new client_1.DoplClient(baseUrl, apiKey, {
        toolHeaderName: "X-Dopl-Cli",
        clientIdentifier: version_js_1.clientIdentifier,
        workspaceId,
    });
}
