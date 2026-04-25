import { mkdtempSync, rmSync } from "fs";
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

describe("packs commands", () => {
  let tmp: string;
  let fetchMock: FetchMock | null;
  let io: IoCapture;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "dopl-packs-test-"));
    vi.stubEnv("DOPL_CONFIG_PATH", join(tmp, "config.json"));
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

  it("`packs list` renders a human table", async () => {
    fetchMock = installFetchMock([
      () =>
        jsonResponse(200, {
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

    const program = buildTestProgram();
    await program.parseAsync(["node", "dopl", "packs", "list"]);

    const out = io.stdout();
    expect(out).toContain("Rokid AR");
    expect(out).toContain("rokid");
    expect(out).toContain("2025-11-15");
    expect(fetchMock.calls[0].url).toBe("https://api.example.test/api/knowledge/packs");
  });

  it("`packs list --json` emits parseable JSON", async () => {
    fetchMock = installFetchMock([
      () => jsonResponse(200, { packs: [{ id: "a", name: "A" }] }),
    ]);

    const program = buildTestProgram();
    await program.parseAsync(["node", "dopl", "--json", "packs", "list"]);

    const parsed = JSON.parse(io.stdout());
    expect(parsed).toEqual({ packs: [{ id: "a", name: "A" }] });
  });

  it("`packs list` prints a friendly message when empty", async () => {
    fetchMock = installFetchMock([() => jsonResponse(200, { packs: [] })]);

    const program = buildTestProgram();
    await program.parseAsync(["node", "dopl", "packs", "list"]);

    expect(io.stdout()).toContain("No knowledge packs installed");
  });

  it("`packs files <pack>` groups files by category", async () => {
    fetchMock = installFetchMock([
      () =>
        jsonResponse(200, {
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

    const program = buildTestProgram();
    await program.parseAsync(["node", "dopl", "packs", "files", "rokid"]);

    const out = io.stdout();
    expect(out).toContain("sdk/");
    expect(out).toContain("overview/");
    expect(out).toContain("docs/sdk/camera.md");
    expect(out).toContain("Camera SDK");
  });

  it("`packs files <pack>` passes category to the API", async () => {
    fetchMock = installFetchMock([
      () => jsonResponse(200, { pack_id: "rokid", files: [] }),
    ]);

    const program = buildTestProgram();
    await program.parseAsync([
      "node",
      "dopl",
      "packs",
      "files",
      "rokid",
      "--category",
      "sdk",
    ]);

    expect(fetchMock.calls[0].url).toContain("category=sdk");
  });

  it("`packs get <pack> <path>` writes raw body to stdout", async () => {
    const body = "# Hello\n\nThis is the body.\n";
    fetchMock = installFetchMock([
      () =>
        jsonResponse(200, {
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

    const program = buildTestProgram();
    await program.parseAsync([
      "node",
      "dopl",
      "packs",
      "get",
      "rokid",
      "docs/sdk/camera.md",
    ]);

    expect(io.stdout()).toContain(body.trim());
  });

  it("unknown pack → throws DoplApiError (404)", async () => {
    fetchMock = installFetchMock([
      () => new Response("", { status: 404 }),
    ]);

    const program = buildTestProgram();
    await expect(
      program.parseAsync(["node", "dopl", "packs", "files", "ghost"])
    ).rejects.toMatchObject({ status: 404 });
  });
});
