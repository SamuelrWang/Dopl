"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const vitest_1 = require("vitest");
const test_support_js_1 = require("../lib/test-support.js");
(0, vitest_1.describe)("auth whoami", () => {
    let tmp;
    let configFile;
    let fetchMock;
    let io;
    (0, vitest_1.beforeEach)(() => {
        tmp = (0, fs_1.mkdtempSync)((0, path_1.join)((0, os_1.tmpdir)(), "dopl-auth-test-"));
        configFile = (0, path_1.join)(tmp, "config.json");
        vitest_1.vi.stubEnv("DOPL_CONFIG_PATH", configFile);
        vitest_1.vi.stubEnv("DOPL_API_KEY", "sk-dopl-test");
        vitest_1.vi.stubEnv("DOPL_BASE_URL", "https://api.example.test");
        fetchMock = null;
        io = (0, test_support_js_1.captureIo)();
    });
    (0, vitest_1.afterEach)(() => {
        fetchMock?.restore();
        io.restore();
        vitest_1.vi.unstubAllEnvs();
        (0, fs_1.rmSync)(tmp, { recursive: true, force: true });
    });
    (0, vitest_1.it)("prints ok + admin status on a healthy ping", async () => {
        fetchMock = (0, test_support_js_1.installFetchMock)([
            () => (0, test_support_js_1.jsonResponse)(200, { ok: true, is_admin: true }),
        ]);
        const program = (0, test_support_js_1.buildTestProgram)();
        await program.parseAsync(["node", "dopl", "auth", "whoami"]);
        const out = io.stdout();
        (0, vitest_1.expect)(out).toContain("Status: ok");
        (0, vitest_1.expect)(out).toContain("Admin:  yes");
    });
    (0, vitest_1.it)("whoami --json emits parseable JSON without redundant ok flag", async () => {
        fetchMock = (0, test_support_js_1.installFetchMock)([
            () => (0, test_support_js_1.jsonResponse)(200, { ok: true, is_admin: false }),
        ]);
        const program = (0, test_support_js_1.buildTestProgram)();
        await program.parseAsync(["node", "dopl", "--json", "auth", "whoami"]);
        const parsed = JSON.parse(io.stdout());
        (0, vitest_1.expect)(parsed.is_admin).toBe(false);
        (0, vitest_1.expect)(parsed.baseUrl).toBe("https://api.example.test");
    });
    (0, vitest_1.it)("bubbles DoplAuthError on 401", async () => {
        fetchMock = (0, test_support_js_1.installFetchMock)([
            () => new Response("", { status: 401 }),
        ]);
        const program = (0, test_support_js_1.buildTestProgram)();
        await (0, vitest_1.expect)(program.parseAsync(["node", "dopl", "auth", "whoami"])).rejects.toMatchObject({ status: 401, name: "DoplAuthError" });
    });
    (0, vitest_1.it)("rethrows server 500 instead of swallowing it (Bug 2)", async () => {
        fetchMock = (0, test_support_js_1.installFetchMock)([() => new Response("", { status: 500 })]);
        const program = (0, test_support_js_1.buildTestProgram)();
        await (0, vitest_1.expect)(program.parseAsync(["node", "dopl", "auth", "whoami"])).rejects.toMatchObject({ status: 500 });
    });
    (0, vitest_1.it)("rethrows network error instead of swallowing it (Bug 2)", async () => {
        fetchMock = (0, test_support_js_1.installFetchMock)([
            () => {
                throw new TypeError("fetch failed");
            },
            () => {
                throw new TypeError("fetch failed");
            },
        ]);
        const program = (0, test_support_js_1.buildTestProgram)();
        await (0, vitest_1.expect)(program.parseAsync(["node", "dopl", "auth", "whoami"])).rejects.toMatchObject({ name: "DoplNetworkError" });
    });
});
(0, vitest_1.describe)("auth logout", () => {
    let tmp;
    let configFile;
    let io;
    (0, vitest_1.beforeEach)(() => {
        tmp = (0, fs_1.mkdtempSync)((0, path_1.join)((0, os_1.tmpdir)(), "dopl-logout-test-"));
        configFile = (0, path_1.join)(tmp, "config.json");
        vitest_1.vi.stubEnv("DOPL_CONFIG_PATH", configFile);
        io = (0, test_support_js_1.captureIo)();
    });
    (0, vitest_1.afterEach)(() => {
        io.restore();
        vitest_1.vi.unstubAllEnvs();
        (0, fs_1.rmSync)(tmp, { recursive: true, force: true });
    });
    (0, vitest_1.it)("removes an existing config file", async () => {
        (0, fs_1.writeFileSync)(configFile, JSON.stringify({ apiKey: "k" }), { mode: 0o600 });
        const program = (0, test_support_js_1.buildTestProgram)();
        await program.parseAsync(["node", "dopl", "auth", "logout"]);
        (0, vitest_1.expect)((0, fs_1.existsSync)(configFile)).toBe(false);
        (0, vitest_1.expect)(io.stderr()).toContain("Cleared");
    });
    (0, vitest_1.it)("reports no-op when nothing was stored", async () => {
        const program = (0, test_support_js_1.buildTestProgram)();
        await program.parseAsync(["node", "dopl", "auth", "logout"]);
        (0, vitest_1.expect)(io.stderr()).toContain("No credentials were stored");
    });
});
(0, vitest_1.describe)("auth login --no-verify", () => {
    let tmp;
    let configFile;
    let io;
    (0, vitest_1.beforeEach)(() => {
        tmp = (0, fs_1.mkdtempSync)((0, path_1.join)((0, os_1.tmpdir)(), "dopl-login-test-"));
        configFile = (0, path_1.join)(tmp, "config.json");
        vitest_1.vi.stubEnv("DOPL_CONFIG_PATH", configFile);
        vitest_1.vi.stubEnv("DOPL_BASE_URL", "https://api.example.test");
        io = (0, test_support_js_1.captureIo)();
    });
    (0, vitest_1.afterEach)(() => {
        io.restore();
        vitest_1.vi.unstubAllEnvs();
        (0, fs_1.rmSync)(tmp, { recursive: true, force: true });
    });
    (0, vitest_1.it)("saves the key without a server ping", async () => {
        const originalStdin = process.stdin;
        const stdinMock = Object.create(originalStdin);
        Object.defineProperty(stdinMock, "isTTY", { value: false });
        stdinMock.setEncoding = () => stdinMock;
        stdinMock[Symbol.asyncIterator] = async function* () {
            yield "sk-dopl-piped-key\n";
        };
        Object.defineProperty(process, "stdin", {
            value: stdinMock,
            configurable: true,
        });
        try {
            const program = (0, test_support_js_1.buildTestProgram)();
            await program.parseAsync(["node", "dopl", "auth", "login", "--no-verify"]);
            const saved = JSON.parse((0, fs_1.readFileSync)(configFile, "utf8"));
            (0, vitest_1.expect)(saved.apiKey).toBe("sk-dopl-piped-key");
        }
        finally {
            Object.defineProperty(process, "stdin", {
                value: originalStdin,
                configurable: true,
            });
        }
    });
});
(0, vitest_1.describe)("auth login verify path (Bug 3)", () => {
    let tmp;
    let configFile;
    let io;
    let fetchMock;
    function installPipedKey(key) {
        const originalStdin = process.stdin;
        const stdinMock = Object.create(originalStdin);
        Object.defineProperty(stdinMock, "isTTY", { value: false });
        stdinMock.setEncoding = () => stdinMock;
        stdinMock[Symbol.asyncIterator] = async function* () {
            yield `${key}\n`;
        };
        Object.defineProperty(process, "stdin", {
            value: stdinMock,
            configurable: true,
        });
        return () => {
            Object.defineProperty(process, "stdin", {
                value: originalStdin,
                configurable: true,
            });
        };
    }
    (0, vitest_1.beforeEach)(() => {
        tmp = (0, fs_1.mkdtempSync)((0, path_1.join)((0, os_1.tmpdir)(), "dopl-login-verify-"));
        configFile = (0, path_1.join)(tmp, "config.json");
        vitest_1.vi.stubEnv("DOPL_CONFIG_PATH", configFile);
        vitest_1.vi.stubEnv("DOPL_BASE_URL", "https://api.example.test");
        fetchMock = null;
        io = (0, test_support_js_1.captureIo)();
    });
    (0, vitest_1.afterEach)(() => {
        fetchMock?.restore();
        io.restore();
        vitest_1.vi.unstubAllEnvs();
        (0, fs_1.rmSync)(tmp, { recursive: true, force: true });
    });
    (0, vitest_1.it)("on 401 → message says key not saved + exit 2 + config NOT written", async () => {
        fetchMock = (0, test_support_js_1.installFetchMock)([() => new Response("", { status: 401 })]);
        const restoreStdin = installPipedKey("sk-dopl-bad");
        try {
            const program = (0, test_support_js_1.buildTestProgram)();
            await program.parseAsync(["node", "dopl", "auth", "login"]);
            (0, vitest_1.expect)(io.stderr()).toContain("Authentication failed (401)");
            (0, vitest_1.expect)(io.stderr()).toContain("key not saved");
            (0, vitest_1.expect)(process.exitCode).toBe(2);
            (0, vitest_1.expect)((0, fs_1.existsSync)(configFile)).toBe(false);
        }
        finally {
            restoreStdin();
            process.exitCode = 0;
        }
    });
    (0, vitest_1.it)("on network down → exit 3 + config NOT written", async () => {
        fetchMock = (0, test_support_js_1.installFetchMock)([
            () => {
                throw new TypeError("fetch failed");
            },
        ]);
        const restoreStdin = installPipedKey("sk-dopl-net");
        try {
            const program = (0, test_support_js_1.buildTestProgram)();
            await program.parseAsync(["node", "dopl", "auth", "login"]);
            (0, vitest_1.expect)(io.stderr()).toContain("Could not reach");
            (0, vitest_1.expect)(io.stderr()).toContain("Key not saved");
            (0, vitest_1.expect)(process.exitCode).toBe(3);
            (0, vitest_1.expect)((0, fs_1.existsSync)(configFile)).toBe(false);
        }
        finally {
            restoreStdin();
            process.exitCode = 0;
        }
    });
    (0, vitest_1.it)("on 200 → saves config + writes 'Verified' to stderr", async () => {
        fetchMock = (0, test_support_js_1.installFetchMock)([
            () => (0, test_support_js_1.jsonResponse)(200, { ok: true, is_admin: false }),
        ]);
        const restoreStdin = installPipedKey("sk-dopl-good");
        try {
            const program = (0, test_support_js_1.buildTestProgram)();
            await program.parseAsync(["node", "dopl", "auth", "login"]);
            (0, vitest_1.expect)(io.stderr()).toContain("Verified against");
            (0, vitest_1.expect)((0, fs_1.existsSync)(configFile)).toBe(true);
            const saved = JSON.parse((0, fs_1.readFileSync)(configFile, "utf8"));
            (0, vitest_1.expect)(saved.apiKey).toBe("sk-dopl-good");
        }
        finally {
            restoreStdin();
        }
    });
});
