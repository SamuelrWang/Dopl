"use strict";
// Shared helpers for *.test.ts files. Not part of the published CLI surface;
// imported only from tests. Lives under src/lib/ to satisfy ENGINEERING.md §13
// (no separate __tests__/ tree) while keeping helpers DRY across command tests.
Object.defineProperty(exports, "__esModule", { value: true });
exports.installFetchMock = installFetchMock;
exports.jsonResponse = jsonResponse;
exports.captureIo = captureIo;
exports.buildTestProgram = buildTestProgram;
const commander_1 = require("commander");
const vitest_1 = require("vitest");
const auth_js_1 = require("../commands/auth.js");
const packs_js_1 = require("../commands/packs.js");
function installFetchMock(responders) {
    const calls = [];
    const original = global.fetch;
    let i = 0;
    global.fetch = (async (...args) => {
        const [input, init] = args;
        calls.push({ url: String(input), init: init ?? {} });
        const responder = responders[Math.min(i++, responders.length - 1)];
        return responder();
    });
    return {
        calls,
        restore: () => {
            global.fetch = original;
        },
    };
}
function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}
function captureIo() {
    const stdoutChunks = [];
    const stderrChunks = [];
    const outSpy = vitest_1.vi
        .spyOn(process.stdout, "write")
        .mockImplementation(((chunk) => {
        stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
    }));
    const errSpy = vitest_1.vi
        .spyOn(process.stderr, "write")
        .mockImplementation(((chunk) => {
        stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
    }));
    return {
        stdout: () => stdoutChunks.join(""),
        stderr: () => stderrChunks.join(""),
        restore: () => {
            outSpy.mockRestore();
            errSpy.mockRestore();
        },
    };
}
function buildTestProgram() {
    const program = new commander_1.Command();
    program
        .exitOverride()
        .option("--api-key <key>")
        .option("--base-url <url>")
        .option("--json", "", false)
        .option("--verbose", "", false);
    (0, auth_js_1.registerAuthCommands)(program);
    (0, packs_js_1.registerPacksCommands)(program);
    return program;
}
