import { afterEach, describe, it, expect, vi } from "vitest";
import { getProviderConfig, resolveAuthConfigId } from "./providers";
import { ProviderNotConfiguredError } from "./errors";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getProviderConfig", () => {
  it("returns deterministic configs per supported provider", () => {
    const notion = getProviderConfig("notion");
    expect(notion.sourcePlatform).toBe("notion");
    expect(notion.sourceType).toBe("notion_page");
    expect(notion.urlBuilder("abc-def-123")).toBe("https://www.notion.so/abcdef123");

    const gmail = getProviderConfig("gmail");
    expect(gmail.sourcePlatform).toBe("gmail");
    expect(gmail.urlBuilder("THREAD-id")).toMatch(
      /^https:\/\/mail\.google\.com\/.*THREAD-id$/
    );

    const drive = getProviderConfig("google_drive");
    expect(drive.sourcePlatform).toBe("google_drive");
    expect(drive.urlBuilder("FILE_ID")).toBe(
      "https://drive.google.com/file/d/FILE_ID/view"
    );
  });
});

describe("resolveAuthConfigId", () => {
  it("returns the configured id when env is set", () => {
    vi.stubEnv("INTEGRATIONS_NOTION_AUTH_CONFIG_ID", "auth_xyz");
    expect(resolveAuthConfigId("notion")).toBe("auth_xyz");
  });

  it("throws ProviderNotConfiguredError when env is missing", () => {
    vi.stubEnv("INTEGRATIONS_GMAIL_AUTH_CONFIG_ID", "");
    expect(() => resolveAuthConfigId("gmail")).toThrow(ProviderNotConfiguredError);
  });
});
