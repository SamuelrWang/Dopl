/**
 * 🔒 EVERY `/api/channels/[channelId]/…` ROUTE RESOLVES ITS CONTAINER FROM THE CHANNEL (2026-10-08).
 * A decision card in a home channel answered "Channel not found": its press sent no workspace and
 * landed in the caller's home space. `channelWorkspace` (as `workspaceFromParams`) derives the channel's own container;
 * this pins that no channel route (today's or the next one) uses the bare wrapper.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/app/api/channels/[channelId]";

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return routes(p);
    return name === "route.ts" ? [p] : [];
  });
}

describe("channel routes derive their workspace from the channel", () => {
  const files = routes(ROOT);

  it("finds the routes (the scan is not vacuous)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)("%s: every withWorkspaceAuth call derives from the channel", (file) => {
    const src = readFileSync(file, "utf8");
    const calls = src.match(/withWorkspaceAuth\(\w+(?:,\s*\{[^}]*\})?\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain("workspaceFromParams: channelWorkspace");
  });
});
