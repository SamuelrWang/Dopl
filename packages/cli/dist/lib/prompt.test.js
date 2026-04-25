"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const vitest_1 = require("vitest");
const prompt_js_1 = require("./prompt.js");
function createStreams(isTTY) {
    const emitter = new events_1.EventEmitter();
    emitter.isTTY = isTTY;
    emitter.setRawMode = vitest_1.vi.fn();
    emitter.resume = vitest_1.vi.fn();
    emitter.pause = vitest_1.vi.fn();
    emitter.setEncoding = vitest_1.vi.fn();
    const writes = [];
    const output = {
        writes,
        write: (chunk) => {
            writes.push(chunk);
            return true;
        },
    };
    return { input: emitter, output };
}
(0, vitest_1.afterEach)(() => vitest_1.vi.restoreAllMocks());
(0, vitest_1.describe)("promptSecret (TTY)", () => {
    (0, vitest_1.it)("returns the typed text and writes asterisks to output", async () => {
        const { input, output } = createStreams(true);
        const promise = (0, prompt_js_1.promptSecret)("Key: ", {
            input: input,
            output: output,
        });
        input.emit("data", "sk-");
        input.emit("data", "dopl\n");
        await (0, vitest_1.expect)(promise).resolves.toBe("sk-dopl");
        (0, vitest_1.expect)(output.writes[0]).toBe("Key: ");
        const stars = output.writes.filter((w) => w === "*").length;
        (0, vitest_1.expect)(stars).toBe("sk-dopl".length);
    });
    (0, vitest_1.it)("handles backspace", async () => {
        const { input, output } = createStreams(true);
        const promise = (0, prompt_js_1.promptSecret)("Key: ", {
            input: input,
            output: output,
        });
        input.emit("data", "abc");
        input.emit("data", "\u007f");
        input.emit("data", "d\n");
        await (0, vitest_1.expect)(promise).resolves.toBe("abd");
        (0, vitest_1.expect)(output.writes).toContain("\b \b");
    });
    (0, vitest_1.it)("rejects with PromptAbortedError on ctrl-c", async () => {
        const { input, output } = createStreams(true);
        const promise = (0, prompt_js_1.promptSecret)("Key: ", {
            input: input,
            output: output,
        });
        input.emit("data", "abc\u0003");
        await (0, vitest_1.expect)(promise).rejects.toBeInstanceOf(prompt_js_1.PromptAbortedError);
    });
    (0, vitest_1.it)("never writes the typed key to output", async () => {
        const { input, output } = createStreams(true);
        const promise = (0, prompt_js_1.promptSecret)("Key: ", {
            input: input,
            output: output,
        });
        input.emit("data", "supersecret\n");
        await promise;
        const joined = output.writes.join("");
        (0, vitest_1.expect)(joined).not.toContain("supersecret");
    });
    (0, vitest_1.it)("disables raw mode on completion", async () => {
        const { input, output } = createStreams(true);
        const promise = (0, prompt_js_1.promptSecret)("Key: ", {
            input: input,
            output: output,
        });
        input.emit("data", "x\n");
        await promise;
        (0, vitest_1.expect)(input.setRawMode).toHaveBeenCalledWith(true);
        (0, vitest_1.expect)(input.setRawMode).toHaveBeenLastCalledWith(false);
    });
});
