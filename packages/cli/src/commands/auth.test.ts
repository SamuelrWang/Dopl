import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildTestProgram,
  captureIo,
  installFetchMock,
  jsonResponse,
  type FetchMock,
  type IoCapture,
} from "../lib/test-support.js";

describe("auth whoami", () => {
  let tmp: string;
  let configFile: string;
  let fetchMock: FetchMock | null;
  let io: IoCapture;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "dopl-auth-test-"));
    configFile = join(tmp, "config.json");
    vi.stubEnv("DOPL_CONFIG_PATH", configFile);
    vi.stubEnv("DOPL_API_KEY", "sk-dopl-test");
    vi.stubEnv("DOPL_BASE_URL", "https://api.example.test");
    fetchMock = null;
    io = captureIo();
  });

  afterEach(() => {
    fetchMock?.restore();
    io.restore();
    vi.unstubAllEnvs();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("prints ok + admin status on a healthy ping", async () => {
    fetchMock = installFetchMock([
      () => jsonResponse(200, { ok: true, is_admin: true }),
    ]);

    const program = buildTestProgram();
    await program.parseAsync(["node", "dopl", "auth", "whoami"]);

    const out = io.stdout();
    expect(out).toContain("Status: ok");
    expect(out).toContain("Admin:  yes");
  });

  it("whoami --json emits parseable JSON without redundant ok flag", async () => {
    fetchMock = installFetchMock([
      () => jsonResponse(200, { ok: true, is_admin: false }),
    ]);

    const program = buildTestProgram();
    await program.parseAsync(["node", "dopl", "--json", "auth", "whoami"]);

    const parsed = JSON.parse(io.stdout()) as {
      is_admin: boolean;
      baseUrl: string;
    };
    expect(parsed.is_admin).toBe(false);
    expect(parsed.baseUrl).toBe("https://api.example.test");
  });

  it("bubbles DoplAuthError on 401", async () => {
    fetchMock = installFetchMock([
      () => new Response("", { status: 401 }),
    ]);

    const program = buildTestProgram();
    await expect(
      program.parseAsync(["node", "dopl", "auth", "whoami"])
    ).rejects.toMatchObject({ status: 401, name: "DoplAuthError" });
  });

  it("rethrows server 500 instead of swallowing it (Bug 2)", async () => {
    fetchMock = installFetchMock([() => new Response("", { status: 500 })]);

    const program = buildTestProgram();
    await expect(
      program.parseAsync(["node", "dopl", "auth", "whoami"])
    ).rejects.toMatchObject({ status: 500 });
  });

  it("rethrows network error instead of swallowing it (Bug 2)", async () => {
    fetchMock = installFetchMock([
      () => {
        throw new TypeError("fetch failed");
      },
      () => {
        throw new TypeError("fetch failed");
      },
    ]);

    const program = buildTestProgram();
    await expect(
      program.parseAsync(["node", "dopl", "auth", "whoami"])
    ).rejects.toMatchObject({ name: "DoplNetworkError" });
  });
});

describe("auth logout", () => {
  let tmp: string;
  let configFile: string;
  let io: IoCapture;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "dopl-logout-test-"));
    configFile = join(tmp, "config.json");
    vi.stubEnv("DOPL_CONFIG_PATH", configFile);
    io = captureIo();
  });

  afterEach(() => {
    io.restore();
    vi.unstubAllEnvs();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("removes an existing config file", async () => {
    writeFileSync(configFile, JSON.stringify({ apiKey: "k" }), { mode: 0o600 });
    const program = buildTestProgram();
    await program.parseAsync(["node", "dopl", "auth", "logout"]);
    expect(existsSync(configFile)).toBe(false);
    expect(io.stderr()).toContain("Cleared");
  });

  it("reports no-op when nothing was stored", async () => {
    const program = buildTestProgram();
    await program.parseAsync(["node", "dopl", "auth", "logout"]);
    expect(io.stderr()).toContain("No credentials were stored");
  });
});

describe("auth login --no-verify", () => {
  let tmp: string;
  let configFile: string;
  let io: IoCapture;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "dopl-login-test-"));
    configFile = join(tmp, "config.json");
    vi.stubEnv("DOPL_CONFIG_PATH", configFile);
    vi.stubEnv("DOPL_BASE_URL", "https://api.example.test");
    io = captureIo();
  });

  afterEach(() => {
    io.restore();
    vi.unstubAllEnvs();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("saves the key without a server ping", async () => {
    const originalStdin = process.stdin;
    const stdinMock = Object.create(originalStdin) as NodeJS.ReadStream;
    Object.defineProperty(stdinMock, "isTTY", { value: false });
    stdinMock.setEncoding = () => stdinMock;
    (
      stdinMock as unknown as { [Symbol.asyncIterator]: () => AsyncIterator<string> }
    )[Symbol.asyncIterator] = async function* () {
      yield "sk-dopl-piped-key\n";
    };
    Object.defineProperty(process, "stdin", {
      value: stdinMock,
      configurable: true,
    });

    try {
      const program = buildTestProgram();
      await program.parseAsync(["node", "dopl", "auth", "login", "--no-verify"]);
      const saved = JSON.parse(readFileSync(configFile, "utf8"));
      expect(saved.apiKey).toBe("sk-dopl-piped-key");
    } finally {
      Object.defineProperty(process, "stdin", {
        value: originalStdin,
        configurable: true,
      });
    }
  });
});

describe("auth login verify path (Bug 3)", () => {
  let tmp: string;
  let configFile: string;
  let io: IoCapture;
  let fetchMock: FetchMock | null;

  function installPipedKey(key: string): () => void {
    const originalStdin = process.stdin;
    const stdinMock = Object.create(originalStdin) as NodeJS.ReadStream;
    Object.defineProperty(stdinMock, "isTTY", { value: false });
    stdinMock.setEncoding = () => stdinMock;
    (
      stdinMock as unknown as { [Symbol.asyncIterator]: () => AsyncIterator<string> }
    )[Symbol.asyncIterator] = async function* () {
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

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "dopl-login-verify-"));
    configFile = join(tmp, "config.json");
    vi.stubEnv("DOPL_CONFIG_PATH", configFile);
    vi.stubEnv("DOPL_BASE_URL", "https://api.example.test");
    fetchMock = null;
    io = captureIo();
  });

  afterEach(() => {
    fetchMock?.restore();
    io.restore();
    vi.unstubAllEnvs();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("on 401 → message says key not saved + exit 2 + config NOT written", async () => {
    fetchMock = installFetchMock([() => new Response("", { status: 401 })]);
    const restoreStdin = installPipedKey("sk-dopl-bad");
    try {
      const program = buildTestProgram();
      await program.parseAsync(["node", "dopl", "auth", "login"]);
      expect(io.stderr()).toContain("Authentication failed (401)");
      expect(io.stderr()).toContain("key not saved");
      expect(process.exitCode).toBe(2);
      expect(existsSync(configFile)).toBe(false);
    } finally {
      restoreStdin();
      process.exitCode = 0;
    }
  });

  it("on network down → exit 3 + config NOT written", async () => {
    fetchMock = installFetchMock([
      () => {
        throw new TypeError("fetch failed");
      },
    ]);
    const restoreStdin = installPipedKey("sk-dopl-net");
    try {
      const program = buildTestProgram();
      await program.parseAsync(["node", "dopl", "auth", "login"]);
      expect(io.stderr()).toContain("Could not reach");
      expect(io.stderr()).toContain("Key not saved");
      expect(process.exitCode).toBe(3);
      expect(existsSync(configFile)).toBe(false);
    } finally {
      restoreStdin();
      process.exitCode = 0;
    }
  });

  it("on 200 → saves config + writes 'Verified' to stderr", async () => {
    fetchMock = installFetchMock([
      () => jsonResponse(200, { ok: true, is_admin: false }),
    ]);
    const restoreStdin = installPipedKey("sk-dopl-good");
    try {
      const program = buildTestProgram();
      await program.parseAsync(["node", "dopl", "auth", "login"]);
      expect(io.stderr()).toContain("Verified against");
      expect(existsSync(configFile)).toBe(true);
      const saved = JSON.parse(readFileSync(configFile, "utf8"));
      expect(saved.apiKey).toBe("sk-dopl-good");
    } finally {
      restoreStdin();
    }
  });
});
