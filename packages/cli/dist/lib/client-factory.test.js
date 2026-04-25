"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const vitest_1 = require("vitest");
const config_js_1 = require("./config.js");
const client_factory_js_1 = require("./client-factory.js");
(0, vitest_1.describe)("resolveCredentials", () => {
    let tmp;
    (0, vitest_1.beforeEach)(() => {
        tmp = (0, fs_1.mkdtempSync)((0, path_1.join)((0, os_1.tmpdir)(), "dopl-factory-"));
        vitest_1.vi.stubEnv("DOPL_CONFIG_PATH", (0, path_1.join)(tmp, "config.json"));
        vitest_1.vi.stubEnv("DOPL_API_KEY", "");
        vitest_1.vi.stubEnv("DOPL_BASE_URL", "");
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.unstubAllEnvs();
        (0, fs_1.rmSync)(tmp, { recursive: true, force: true });
    });
    (0, vitest_1.it)("throws MissingApiKeyError when no source yields a key", async () => {
        await (0, vitest_1.expect)((0, client_factory_js_1.resolveCredentials)({})).rejects.toBeInstanceOf(client_factory_js_1.MissingApiKeyError);
    });
    (0, vitest_1.it)("prefers --api-key flag over env and config", async () => {
        vitest_1.vi.stubEnv("DOPL_API_KEY", "from-env");
        await (0, config_js_1.writeConfig)({ apiKey: "from-config" });
        const res = await (0, client_factory_js_1.resolveCredentials)({ apiKey: "from-flag" });
        (0, vitest_1.expect)(res.apiKey).toBe("from-flag");
        (0, vitest_1.expect)(res.source).toBe("flag");
    });
    (0, vitest_1.it)("prefers env over config when no flag", async () => {
        vitest_1.vi.stubEnv("DOPL_API_KEY", "from-env");
        await (0, config_js_1.writeConfig)({ apiKey: "from-config" });
        const res = await (0, client_factory_js_1.resolveCredentials)({});
        (0, vitest_1.expect)(res.apiKey).toBe("from-env");
        (0, vitest_1.expect)(res.source).toBe("env");
    });
    (0, vitest_1.it)("falls back to config when flag + env absent", async () => {
        await (0, config_js_1.writeConfig)({ apiKey: "from-config" });
        const res = await (0, client_factory_js_1.resolveCredentials)({});
        (0, vitest_1.expect)(res.apiKey).toBe("from-config");
        (0, vitest_1.expect)(res.source).toBe("config");
    });
    (0, vitest_1.it)("applies same precedence to baseUrl (flag > env > config > default)", async () => {
        await (0, config_js_1.writeConfig)({ apiKey: "k", baseUrl: "https://from-config" });
        vitest_1.vi.stubEnv("DOPL_BASE_URL", "https://from-env");
        const res = await (0, client_factory_js_1.resolveCredentials)({ baseUrl: "https://from-flag" });
        (0, vitest_1.expect)(res.baseUrl).toBe("https://from-flag");
    });
    (0, vitest_1.it)("uses default base URL when nothing else set", async () => {
        await (0, config_js_1.writeConfig)({ apiKey: "k" });
        const res = await (0, client_factory_js_1.resolveCredentials)({});
        (0, vitest_1.expect)(res.baseUrl).toMatch(/^https:\/\//);
    });
});
(0, vitest_1.describe)("createClient", () => {
    let tmp;
    (0, vitest_1.beforeEach)(() => {
        tmp = (0, fs_1.mkdtempSync)((0, path_1.join)((0, os_1.tmpdir)(), "dopl-factory-"));
        vitest_1.vi.stubEnv("DOPL_CONFIG_PATH", (0, path_1.join)(tmp, "config.json"));
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.unstubAllEnvs();
        (0, fs_1.rmSync)(tmp, { recursive: true, force: true });
    });
    (0, vitest_1.it)("constructs a DoplClient with resolved base URL", async () => {
        const client = await (0, client_factory_js_1.createClient)({
            apiKey: "k",
            baseUrl: "https://example.test",
        });
        (0, vitest_1.expect)(client.getBaseUrl()).toBe("https://example.test");
    });
});
