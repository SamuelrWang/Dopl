"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromptAbortedError = void 0;
exports.promptSecret = promptSecret;
const KEY_CTRL_C = "\u0003";
const KEY_BACKSPACE_DEL = "\u007f";
const KEY_BACKSPACE_BS = "\b";
const KEY_EOF = "\u0004";
async function promptSecret(label, streams) {
    const input = streams?.input ?? process.stdin;
    const output = streams?.output ?? process.stderr;
    if (!input.isTTY)
        return readFromPipe(input, output, label);
    output.write(label);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    return new Promise((resolve, reject) => {
        let buffer = "";
        const cleanup = () => {
            input.setRawMode(false);
            input.pause();
            input.removeListener("data", onData);
        };
        const onData = (chunk) => {
            for (const ch of chunk) {
                if (ch === "\r" || ch === "\n" || ch === KEY_EOF) {
                    output.write("\n");
                    cleanup();
                    resolve(buffer);
                    return;
                }
                if (ch === KEY_CTRL_C) {
                    output.write("\n");
                    cleanup();
                    reject(new PromptAbortedError());
                    return;
                }
                if (ch === KEY_BACKSPACE_DEL || ch === KEY_BACKSPACE_BS) {
                    if (buffer.length > 0) {
                        buffer = buffer.slice(0, -1);
                        output.write("\b \b");
                    }
                    continue;
                }
                if (ch >= " ") {
                    buffer += ch;
                    output.write("*");
                }
            }
        };
        input.on("data", onData);
    });
}
async function readFromPipe(input, output, label) {
    output.write(label);
    input.setEncoding("utf8");
    let buffer = "";
    for await (const chunk of input)
        buffer += chunk;
    const firstLine = buffer.split(/\r?\n/, 1)[0] ?? "";
    return firstLine.trim();
}
class PromptAbortedError extends Error {
    constructor() {
        super("Prompt aborted");
        this.name = "PromptAbortedError";
    }
}
exports.PromptAbortedError = PromptAbortedError;
