"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const vitest_1 = require("vitest");
const config_js_1 = require("./config.js");
(0, vitest_1.describe)("configFilePath", () => {
    const originalPlatform = process.platform;
    const originalEnv = { ...process.env };
    (0, vitest_1.beforeEach)(() => {
        delete process.env.DOPL_CONFIG_PATH;
        delete process.env.XDG_CONFIG_HOME;
        delete process.env.APPDATA;
    });
    (0, vitest_1.afterEach)(() => {
        Object.defineProperty(process, "platform", { value: originalPlatform });
        process.env = { ...originalEnv };
    });
    (0, vitest_1.it)("prefers DOPL_CONFIG_PATH over everything", () => {
        process.env.DOPL_CONFIG_PATH = "/tmp/custom-config.json";
        (0, vitest_1.expect)((0, config_js_1.configFilePath)()).toBe("/tmp/custom-config.json");
    });
    (0, vitest_1.it)("uses APPDATA on Windows", () => {
        Object.defineProperty(process, "platform", { value: "win32" });
        process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
        (0, vitest_1.expect)((0, config_js_1.configFilePath)()).toMatch(/Roaming.+dopl.+config\.json$/);
    });
    (0, vitest_1.it)("falls back to ~/AppData/Roaming on Windows without APPDATA", () => {
        Object.defineProperty(process, "platform", { value: "win32" });
        (0, vitest_1.expect)((0, config_js_1.configFilePath)()).toMatch(/AppData.+Roaming.+dopl.+config\.json$/);
    });
    (0, vitest_1.it)("uses XDG_CONFIG_HOME on Linux when set", () => {
        Object.defineProperty(process, "platform", { value: "linux" });
        process.env.XDG_CONFIG_HOME = "/custom/xdg";
        (0, vitest_1.expect)((0, config_js_1.configFilePath)()).toBe((0, path_1.join)("/custom/xdg", "dopl", "config.json"));
    });
    (0, vitest_1.it)("falls back to ~/.config on Linux without XDG_CONFIG_HOME", () => {
        Object.defineProperty(process, "platform", { value: "linux" });
        (0, vitest_1.expect)((0, config_js_1.configFilePath)()).toMatch(/\.config.+dopl.+config\.json$/);
    });
    (0, vitest_1.it)("uses ~/.config on macOS", () => {
        Object.defineProperty(process, "platform", { value: "darwin" });
        (0, vitest_1.expect)((0, config_js_1.configFilePath)()).toMatch(/\.config.+dopl.+config\.json$/);
    });
});
(0, vitest_1.describe)("readConfig / writeConfig / clearConfig", () => {
    let tmp;
    let configFile;
    (0, vitest_1.beforeEach)(() => {
        tmp = (0, fs_1.mkdtempSync)((0, path_1.join)((0, os_1.tmpdir)(), "dopl-config-"));
        configFile = (0, path_1.join)(tmp, "config.json");
        vitest_1.vi.stubEnv("DOPL_CONFIG_PATH", configFile);
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.unstubAllEnvs();
        (0, fs_1.rmSync)(tmp, { recursive: true, force: true });
    });
    (0, vitest_1.it)("readConfig returns {} when file missing", async () => {
        (0, vitest_1.expect)(await (0, config_js_1.readConfig)()).toEqual({});
    });
    (0, vitest_1.it)("writeConfig creates parent dir and writes JSON", async () => {
        const nested = (0, path_1.join)(tmp, "nested", "deeper", "config.json");
        vitest_1.vi.stubEnv("DOPL_CONFIG_PATH", nested);
        await (0, config_js_1.writeConfig)({ apiKey: "sk-dopl-test", baseUrl: "https://example.com" });
        const body = JSON.parse((0, fs_1.readFileSync)(nested, "utf8"));
        (0, vitest_1.expect)(body).toEqual({ apiKey: "sk-dopl-test", baseUrl: "https://example.com" });
    });
    (0, vitest_1.it)("writeConfig writes mode 0600 on POSIX", async () => {
        if (process.platform === "win32")
            return;
        await (0, config_js_1.writeConfig)({ apiKey: "sk-dopl-test" });
        const mode = (0, fs_1.statSync)(configFile).mode & 0o777;
        (0, vitest_1.expect)(mode).toBe(0o600);
    });
    (0, vitest_1.it)("readConfig round-trips writeConfig", async () => {
        await (0, config_js_1.writeConfig)({ apiKey: "sk-dopl-test", baseUrl: "https://example.com" });
        (0, vitest_1.expect)(await (0, config_js_1.readConfig)()).toEqual({
            apiKey: "sk-dopl-test",
            baseUrl: "https://example.com",
        });
    });
    (0, vitest_1.it)("readConfig ignores unknown fields", async () => {
        await (0, config_js_1.writeConfig)({ apiKey: "k" });
        const raw = (0, fs_1.readFileSync)(configFile, "utf8");
        const withExtras = JSON.stringify({ ...JSON.parse(raw), extraneous: 42 });
        vitest_1.vi.stubEnv("DOPL_CONFIG_PATH", configFile);
        const fs = await import("fs/promises");
        await fs.writeFile(configFile, withExtras);
        (0, vitest_1.expect)(await (0, config_js_1.readConfig)()).toEqual({ apiKey: "k" });
    });
    (0, vitest_1.it)("clearConfig removes the file and returns true", async () => {
        await (0, config_js_1.writeConfig)({ apiKey: "k" });
        (0, vitest_1.expect)(await (0, config_js_1.clearConfig)()).toBe(true);
        (0, vitest_1.expect)(await (0, config_js_1.readConfig)()).toEqual({});
    });
    (0, vitest_1.it)("clearConfig returns false when file already missing", async () => {
        (0, vitest_1.expect)(await (0, config_js_1.clearConfig)()).toBe(false);
    });
});
