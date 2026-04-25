"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const vitest_1 = require("vitest");
const test_support_js_1 = require("../lib/test-support.js");
(0, vitest_1.describe)("packs commands", () => {
    let tmp;
    let fetchMock;
    let io;
    (0, vitest_1.beforeEach)(() => {
        tmp = (0, fs_1.mkdtempSync)((0, path_1.join)((0, os_1.tmpdir)(), "dopl-packs-test-"));
        vitest_1.vi.stubEnv("DOPL_CONFIG_PATH", (0, path_1.join)(tmp, "config.json"));
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
    (0, vitest_1.it)("`packs list` renders a human table", async () => {
        fetchMock = (0, test_support_js_1.installFetchMock)([
            () => (0, test_support_js_1.jsonResponse)(200, {
                packs: [
                    {
                        id: "rokid",
                        name: "Rokid AR",
                        description: "SDK reference for Rokid AR glasses",
                        sdk_version: "1.2.3",
                        repo_url: "https://github.com/x/y",
                        last_synced_at: "2025-11-15T12:00:00Z",
                        last_commit_sha: "abc",
                    },
                ],
            }),
        ]);
        const program = (0, test_support_js_1.buildTestProgram)();
        await program.parseAsync(["node", "dopl", "packs", "list"]);
        const out = io.stdout();
        (0, vitest_1.expect)(out).toContain("Rokid AR");
        (0, vitest_1.expect)(out).toContain("rokid");
        (0, vitest_1.expect)(out).toContain("2025-11-15");
        (0, vitest_1.expect)(fetchMock.calls[0].url).toBe("https://api.example.test/api/knowledge/packs");
    });
    (0, vitest_1.it)("`packs list --json` emits parseable JSON", async () => {
        fetchMock = (0, test_support_js_1.installFetchMock)([
            () => (0, test_support_js_1.jsonResponse)(200, { packs: [{ id: "a", name: "A" }] }),
        ]);
        const program = (0, test_support_js_1.buildTestProgram)();
        await program.parseAsync(["node", "dopl", "--json", "packs", "list"]);
        const parsed = JSON.parse(io.stdout());
        (0, vitest_1.expect)(parsed).toEqual({ packs: [{ id: "a", name: "A" }] });
    });
    (0, vitest_1.it)("`packs list` prints a friendly message when empty", async () => {
        fetchMock = (0, test_support_js_1.installFetchMock)([() => (0, test_support_js_1.jsonResponse)(200, { packs: [] })]);
        const program = (0, test_support_js_1.buildTestProgram)();
        await program.parseAsync(["node", "dopl", "packs", "list"]);
        (0, vitest_1.expect)(io.stdout()).toContain("No knowledge packs installed");
    });
    (0, vitest_1.it)("`packs files <pack>` groups files by category", async () => {
        fetchMock = (0, test_support_js_1.installFetchMock)([
            () => (0, test_support_js_1.jsonResponse)(200, {
                pack_id: "rokid",
                files: [
                    {
                        pack_id: "rokid",
                        path: "docs/sdk/camera.md",
                        title: "Camera SDK",
                        summary: null,
                        tags: [],
                        category: "sdk",
                        updated_at: "2025-11-15T12:00:00Z",
                    },
                    {
                        pack_id: "rokid",
                        path: "docs/overview/intro.md",
                        title: "Intro",
                        summary: null,
                        tags: [],
                        category: "overview",
                        updated_at: "2025-11-15T12:00:00Z",
                    },
                ],
            }),
        ]);
        const program = (0, test_support_js_1.buildTestProgram)();
        await program.parseAsync(["node", "dopl", "packs", "files", "rokid"]);
        const out = io.stdout();
        (0, vitest_1.expect)(out).toContain("sdk/");
        (0, vitest_1.expect)(out).toContain("overview/");
        (0, vitest_1.expect)(out).toContain("docs/sdk/camera.md");
        (0, vitest_1.expect)(out).toContain("Camera SDK");
    });
    (0, vitest_1.it)("`packs files <pack>` passes category to the API", async () => {
        fetchMock = (0, test_support_js_1.installFetchMock)([
            () => (0, test_support_js_1.jsonResponse)(200, { pack_id: "rokid", files: [] }),
        ]);
        const program = (0, test_support_js_1.buildTestProgram)();
        await program.parseAsync([
            "node",
            "dopl",
            "packs",
            "files",
            "rokid",
            "--category",
            "sdk",
        ]);
        (0, vitest_1.expect)(fetchMock.calls[0].url).toContain("category=sdk");
    });
    (0, vitest_1.it)("`packs get <pack> <path>` writes raw body to stdout", async () => {
        const body = "# Hello\n\nThis is the body.\n";
        fetchMock = (0, test_support_js_1.installFetchMock)([
            () => (0, test_support_js_1.jsonResponse)(200, {
                file: {
                    pack_id: "rokid",
                    path: "docs/sdk/camera.md",
                    title: "Camera SDK",
                    summary: null,
                    body,
                    frontmatter: {},
                    tags: [],
                    category: "sdk",
                    updated_at: "2025-11-15T12:00:00Z",
                },
            }),
        ]);
        const program = (0, test_support_js_1.buildTestProgram)();
        await program.parseAsync([
            "node",
            "dopl",
            "packs",
            "get",
            "rokid",
            "docs/sdk/camera.md",
        ]);
        (0, vitest_1.expect)(io.stdout()).toContain(body.trim());
    });
    (0, vitest_1.it)("unknown pack → throws DoplApiError (404)", async () => {
        fetchMock = (0, test_support_js_1.installFetchMock)([
            () => new Response("", { status: 404 }),
        ]);
        const program = (0, test_support_js_1.buildTestProgram)();
        await (0, vitest_1.expect)(program.parseAsync(["node", "dopl", "packs", "files", "ghost"])).rejects.toMatchObject({ status: 404 });
    });
});
