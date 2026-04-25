// Shared helpers for *.test.ts files. Not part of the published CLI surface;
// imported only from tests. Lives under src/lib/ to satisfy ENGINEERING.md §13
// (no separate __tests__/ tree) while keeping helpers DRY across command tests.

import { Command } from "commander";
import { vi } from "vitest";

import { registerAuthCommands } from "../commands/auth.js";
import { registerPacksCommands } from "../commands/packs.js";

type FetchArgs = Parameters<typeof fetch>;

export interface FetchCall {
  url: string;
  init: RequestInit;
}

export interface FetchMock {
  calls: FetchCall[];
  restore: () => void;
}

export function installFetchMock(
  responders: Array<() => Promise<Response> | Response>
): FetchMock {
  const calls: FetchCall[] = [];
  const original = global.fetch;
  let i = 0;
  global.fetch = (async (...args: FetchArgs) => {
    const [input, init] = args;
    calls.push({ url: String(input), init: init ?? {} });
    const responder = responders[Math.min(i++, responders.length - 1)];
    return responder();
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      global.fetch = original;
    },
  };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export interface IoCapture {
  stdout: () => string;
  stderr: () => string;
  restore: () => void;
}

export function captureIo(): IoCapture {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const outSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(((chunk: string | Uint8Array) => {
      stdoutChunks.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
      );
      return true;
    }) as typeof process.stdout.write);
  const errSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(((chunk: string | Uint8Array) => {
      stderrChunks.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
      );
      return true;
    }) as typeof process.stderr.write);
  return {
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join(""),
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

export function buildTestProgram(): Command {
  const program = new Command();
  program
    .exitOverride()
    .option("--api-key <key>")
    .option("--base-url <url>")
    .option("--json", "", false)
    .option("--verbose", "", false);
  registerAuthCommands(program);
  registerPacksCommands(program);
  return program;
}
