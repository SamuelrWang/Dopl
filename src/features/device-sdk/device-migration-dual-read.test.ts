/**
 * §8.4 dual read, pinned (W1.1, Plans/Dopl SDK Split). `migrate_prosumer_device` nulls
 * `devices.user_id` and leaves `glasses_device_links` untouched. That is safe only while every
 * prosumer glasses / display lookup by user reads `glasses_device_links`, never `devices`. If one
 * of these files starts reading `devices` (or `device_credentials`), a migrated user's glasses go
 * dark there: resolve it through `dev_end_users.external_user_id` first, then update this list.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const PROSUMER_DIRS = ["glasses", "display"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("prosumer device lookups stay on glasses_device_links", () => {
  const all = PROSUMER_DIRS.flatMap((d) => files(join(ROOT, d)));

  it("finds the prosumer code to scan", () => {
    expect(all.length).toBeGreaterThan(10);
    expect(all.some((f) => f.endsWith(join("glasses", "core", "devices", "repository.ts")))).toBe(true);
  });

  it("no prosumer file reads the SDK devices / device_credentials tables", () => {
    const hits = all.filter((f) => /\.from\(\s*["'](devices|device_credentials)["']\s*\)/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("the prosumer repository looks devices up by user_id on glasses_device_links", () => {
    const repo = readFileSync(join(ROOT, "glasses", "core", "devices", "repository.ts"), "utf8");
    expect(repo).toMatch(/const DEVICES = "glasses_device_links";/);
  });
});
