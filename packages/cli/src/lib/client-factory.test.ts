import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeConfig } from "./config.js";
import {
  createClient,
  MissingApiKeyError,
  resolveCredentials,
} from "./client-factory.js";

describe("resolveCredentials", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "dopl-factory-"));
    vi.stubEnv("DOPL_CONFIG_PATH", join(tmp, "config.json"));
    vi.stubEnv("DOPL_API_KEY", "");
    vi.stubEnv("DOPL_BASE_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("throws MissingApiKeyError when no source yields a key", async () => {
    await expect(resolveCredentials({})).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it("prefers --api-key flag over env and config", async () => {
    vi.stubEnv("DOPL_API_KEY", "from-env");
    await writeConfig({ apiKey: "from-config" });
    const res = await resolveCredentials({ apiKey: "from-flag" });
    expect(res.apiKey).toBe("from-flag");
    expect(res.source).toBe("flag");
  });

  it("prefers env over config when no flag", async () => {
    vi.stubEnv("DOPL_API_KEY", "from-env");
    await writeConfig({ apiKey: "from-config" });
    const res = await resolveCredentials({});
    expect(res.apiKey).toBe("from-env");
    expect(res.source).toBe("env");
  });

  it("falls back to config when flag + env absent", async () => {
    await writeConfig({ apiKey: "from-config" });
    const res = await resolveCredentials({});
    expect(res.apiKey).toBe("from-config");
    expect(res.source).toBe("config");
  });

  it("applies same precedence to baseUrl (flag > env > config > default)", async () => {
    await writeConfig({ apiKey: "k", baseUrl: "https://from-config" });
    vi.stubEnv("DOPL_BASE_URL", "https://from-env");
    const res = await resolveCredentials({ baseUrl: "https://from-flag" });
    expect(res.baseUrl).toBe("https://from-flag");
  });

  it("uses default base URL when nothing else set", async () => {
    await writeConfig({ apiKey: "k" });
    const res = await resolveCredentials({});
    expect(res.baseUrl).toMatch(/^https:\/\//);
  });
});

describe("createClient", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "dopl-factory-"));
    vi.stubEnv("DOPL_CONFIG_PATH", join(tmp, "config.json"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("constructs a DoplClient with resolved base URL", async () => {
    const client = await createClient({
      apiKey: "k",
      baseUrl: "https://example.test",
    });
    expect(client.getBaseUrl()).toBe("https://example.test");
  });
});
