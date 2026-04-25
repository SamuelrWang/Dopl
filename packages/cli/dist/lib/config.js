"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readConfig = readConfig;
exports.writeConfig = writeConfig;
exports.clearConfig = clearConfig;
exports.configFilePath = configFilePath;
exports.defaultBaseUrl = defaultBaseUrl;
const os_1 = require("os");
const path_1 = require("path");
const promises_1 = require("fs/promises");
const DEFAULT_BASE_URL = "https://www.usedopl.com";
function configPath() {
    const override = process.env.DOPL_CONFIG_PATH;
    if (override)
        return override;
    if (process.platform === "win32") {
        const appData = process.env.APPDATA ?? (0, path_1.join)((0, os_1.homedir)(), "AppData", "Roaming");
        return (0, path_1.join)(appData, "dopl", "config.json");
    }
    const xdg = process.env.XDG_CONFIG_HOME ?? (0, path_1.join)((0, os_1.homedir)(), ".config");
    return (0, path_1.join)(xdg, "dopl", "config.json");
}
async function readConfig() {
    try {
        const raw = await (0, promises_1.readFile)(configPath(), "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object")
            return {};
        const cfg = parsed;
        const out = {};
        if (typeof cfg.apiKey === "string")
            out.apiKey = cfg.apiKey;
        if (typeof cfg.baseUrl === "string")
            out.baseUrl = cfg.baseUrl;
        return out;
    }
    catch (err) {
        if (err.code === "ENOENT")
            return {};
        throw err;
    }
}
async function writeConfig(config) {
    const path = configPath();
    await (0, promises_1.mkdir)((0, path_1.dirname)(path), { recursive: true });
    await (0, promises_1.writeFile)(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}
async function clearConfig() {
    const path = configPath();
    try {
        await (0, promises_1.rm)(path);
        return true;
    }
    catch (err) {
        if (err.code === "ENOENT")
            return false;
        throw err;
    }
}
function configFilePath() {
    return configPath();
}
function defaultBaseUrl() {
    return DEFAULT_BASE_URL;
}
