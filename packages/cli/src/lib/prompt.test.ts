import { EventEmitter } from "events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { PromptAbortedError, promptSecret } from "./prompt.js";

type FakeInput = EventEmitter & {
  isTTY: boolean;
  setRawMode: (on: boolean) => void;
  resume: () => void;
  pause: () => void;
  setEncoding: (enc: string) => void;
};

type FakeOutput = {
  write: (chunk: string) => boolean;
  writes: string[];
};

function createStreams(isTTY: boolean): { input: FakeInput; output: FakeOutput } {
  const emitter = new EventEmitter() as FakeInput;
  emitter.isTTY = isTTY;
  emitter.setRawMode = vi.fn();
  emitter.resume = vi.fn();
  emitter.pause = vi.fn();
  emitter.setEncoding = vi.fn();

  const writes: string[] = [];
  const output: FakeOutput = {
    writes,
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    },
  };

  return { input: emitter, output };
}

afterEach(() => vi.restoreAllMocks());

describe("promptSecret (TTY)", () => {
  it("returns the typed text and writes asterisks to output", async () => {
    const { input, output } = createStreams(true);
    const promise = promptSecret("Key: ", {
      input: input as unknown as NodeJS.ReadStream,
      output: output as unknown as NodeJS.WriteStream,
    });

    input.emit("data", "sk-");
    input.emit("data", "dopl\n");

    await expect(promise).resolves.toBe("sk-dopl");
    expect(output.writes[0]).toBe("Key: ");
    const stars = output.writes.filter((w) => w === "*").length;
    expect(stars).toBe("sk-dopl".length);
  });

  it("handles backspace", async () => {
    const { input, output } = createStreams(true);
    const promise = promptSecret("Key: ", {
      input: input as unknown as NodeJS.ReadStream,
      output: output as unknown as NodeJS.WriteStream,
    });

    input.emit("data", "abc");
    input.emit("data", "\u007f");
    input.emit("data", "d\n");

    await expect(promise).resolves.toBe("abd");
    expect(output.writes).toContain("\b \b");
  });

  it("rejects with PromptAbortedError on ctrl-c", async () => {
    const { input, output } = createStreams(true);
    const promise = promptSecret("Key: ", {
      input: input as unknown as NodeJS.ReadStream,
      output: output as unknown as NodeJS.WriteStream,
    });

    input.emit("data", "abc\u0003");

    await expect(promise).rejects.toBeInstanceOf(PromptAbortedError);
  });

  it("never writes the typed key to output", async () => {
    const { input, output } = createStreams(true);
    const promise = promptSecret("Key: ", {
      input: input as unknown as NodeJS.ReadStream,
      output: output as unknown as NodeJS.WriteStream,
    });

    input.emit("data", "supersecret\n");
    await promise;

    const joined = output.writes.join("");
    expect(joined).not.toContain("supersecret");
  });

  it("disables raw mode on completion", async () => {
    const { input, output } = createStreams(true);
    const promise = promptSecret("Key: ", {
      input: input as unknown as NodeJS.ReadStream,
      output: output as unknown as NodeJS.WriteStream,
    });

    input.emit("data", "x\n");
    await promise;

    expect(input.setRawMode).toHaveBeenCalledWith(true);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });
});
