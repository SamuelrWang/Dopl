import { mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearConfig,
  configFilePath,
  readConfig,
  writeConfig,
} from "./config.js";

describe("configFilePath", () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.DOPL_CONFIG_PATH;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.APPDATA;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    process.env = { ...originalEnv };
  });

  it("prefers DOPL_CONFIG_PATH over everything", () => {
    process.env.DOPL_CONFIG_PATH = "/tmp/custom-config.json";
    expect(configFilePath()).toBe("/tmp/custom-config.json");
  });

  it("uses APPDATA on Windows", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
    expect(configFilePath()).toMatch(/Roaming.+dopl.+config\.json$/);
  });

  it("falls back to ~/AppData/Roaming on Windows without APPDATA", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    expect(configFilePath()).toMatch(/AppData.+Roaming.+dopl.+config\.json$/);
  });

  it("uses XDG_CONFIG_HOME on Linux when set", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.XDG_CONFIG_HOME = "/custom/xdg";
    expect(configFilePath()).toBe(join("/custom/xdg", "dopl", "config.json"));
  });

  it("falls back to ~/.config on Linux without XDG_CONFIG_HOME", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    expect(configFilePath()).toMatch(/\.config.+dopl.+config\.json$/);
  });

  it("uses ~/.config on macOS", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    expect(configFilePath()).toMatch(/\.config.+dopl.+config\.json$/);
  });
});

describe("readConfig / writeConfig / clearConfig", () => {
  let tmp: string;
  let configFile: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "dopl-config-"));
    configFile = join(tmp, "config.json");
    vi.stubEnv("DOPL_CONFIG_PATH", configFile);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("readConfig returns {} when file missing", async () => {
    expect(await readConfig()).toEqual({});
  });

  it("writeConfig creates parent dir and writes JSON", async () => {
    const nested = join(tmp, "nested", "deeper", "config.json");
    vi.stubEnv("DOPL_CONFIG_PATH", nested);
    await writeConfig({ apiKey: "sk-dopl-test", baseUrl: "https://example.com" });
    const body = JSON.parse(readFileSync(nested, "utf8"));
    expect(body).toEqual({ apiKey: "sk-dopl-test", baseUrl: "https://example.com" });
  });

  it("writeConfig writes mode 0600 on POSIX", async () => {
    if (process.platform === "win32") return;
    await writeConfig({ apiKey: "sk-dopl-test" });
    const mode = statSync(configFile).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("readConfig round-trips writeConfig", async () => {
    await writeConfig({ apiKey: "sk-dopl-test", baseUrl: "https://example.com" });
    expect(await readConfig()).toEqual({
      apiKey: "sk-dopl-test",
      baseUrl: "https://example.com",
    });
  });

  it("readConfig ignores unknown fields", async () => {
    await writeConfig({ apiKey: "k" });
    const raw = readFileSync(configFile, "utf8");
    const withExtras = JSON.stringify({ ...JSON.parse(raw), extraneous: 42 });
    vi.stubEnv("DOPL_CONFIG_PATH", configFile);
    const fs = await import("fs/promises");
    await fs.writeFile(configFile, withExtras);
    expect(await readConfig()).toEqual({ apiKey: "k" });
  });

  it("clearConfig removes the file and returns true", async () => {
    await writeConfig({ apiKey: "k" });
    expect(await clearConfig()).toBe(true);
    expect(await readConfig()).toEqual({});
  });

  it("clearConfig returns false when file already missing", async () => {
    expect(await clearConfig()).toBe(false);
  });
});
