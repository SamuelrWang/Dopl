/**
 * 🔒 EVERY ID-ADDRESSED ROUTE DECLARES WHERE ITS WORKSPACE COMES FROM (2026-10-08).
 * A header-less request resolves to the caller's HOME space, so a route addressed by a resource id
 * that lives elsewhere answered "not found" (a decision card in a home channel: "Channel not found").
 * Every dynamic-segment route on `withWorkspaceAuth` must pass `workspaceFromParams`: a resolver for
 * its id family (`workspace-derivation.ts`, `channel-route.ts › channelWorkspace`) or an explicit
 * `noDerivation("<reason>")`. A NEW route without one fails here, whatever family it belongs to.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return routes(p);
    return name === "route.ts" ? [p] : [];
  });
}

/** Each `withWorkspaceAuth(handler[, { … }])` call, options included (balanced braces). */
function calls(src: string): string[] {
  const out: string[] = [];
  let i = src.indexOf("withWorkspaceAuth(");
  while (i !== -1) {
    let depth = 0;
    let j = i + "withWorkspaceAuth".length;
    for (; j < src.length; j += 1) {
      if (src[j] === "(") depth += 1;
      else if (src[j] === ")" && --depth === 0) break;
    }
    out.push(src.slice(i, j + 1));
    i = src.indexOf("withWorkspaceAuth(", j);
  }
  return out;
}

const dynamic = routes("src/app/api").filter((p) => p.includes("[") && /withWorkspaceAuth\(/.test(readFileSync(p, "utf8")));

describe("workspace derivation coverage", () => {
  it("finds the id-addressed workspace routes (the scan is not vacuous)", () => {
    expect(dynamic.length).toBeGreaterThan(30);
  });

  it.each(dynamic)("%s: every withWorkspaceAuth call declares workspaceFromParams", (file) => {
    for (const call of calls(readFileSync(file, "utf8"))) {
      expect(call, call).toMatch(/workspaceFromParams:\s*[\w.]+/);
    }
  });

  it.each(dynamic)("%s: an opt-out names its reason", (file) => {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/noDerivation\(([^)]*)\)/g)) expect(m[1].trim().length, file).toBeGreaterThan(2);
  });

  it("channel routes use the channel-member resolver", () => {
    for (const file of dynamic.filter((p) => p.includes(join("channels", "[channelId]")))) {
      for (const call of calls(readFileSync(file, "utf8"))) expect(call, file).toContain("workspaceFromParams: channelWorkspace");
    }
  });
});
