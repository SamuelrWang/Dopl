import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { canManageChannelHere } from "./channel-manage-gate";

describe("canManageChannelHere", () => {
  it("says yes to a channel owner at any workspace role", () => {
    expect(canManageChannelHere({ role: "owner" }, "guest")).toBe(true);
  });

  it("says yes to a workspace admin who is only a channel member", () => {
    expect(canManageChannelHere({ role: "member" }, "admin")).toBe(true);
    expect(canManageChannelHere({ role: null }, "owner")).toBe(true);
  });

  it("says no to a plain member and to a guest", () => {
    expect(canManageChannelHere({ role: "member" }, "member")).toBe(false);
    expect(canManageChannelHere({ role: null }, "guest")).toBe(false);
  });
});

/**
 * ⚠ A SECOND SPELLING IS THE BUG (wave 1 review, 2026-09-17): the mirror lived
 * at three call sites and drifted from the Settings row's copy of it.
 */
describe("🔒 the mirror is spelled once", () => {
  it("has no other `role === \"owner\" || meetsMinRole(role, \"admin\")` in the feature", () => {
    const root = join(process.cwd(), "src/features/channels");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (
          /\.tsx?$/.test(entry.name) &&
          !entry.name.includes(".test.") &&
          entry.name !== "channel-manage-gate.ts"
        ) {
          const src = readFileSync(path, "utf8").replace(/\s+/g, " ");
          if (/role === "owner" \|\| meetsMinRole\(\s*role, "admin"\)/.test(src)) {
            offenders.push(path);
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
