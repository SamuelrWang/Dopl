/** Overhauled pages use the shared components only, so they cannot drift from the Playground. See README.md. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SECTIONS = join(__dirname, "..", "_sections");
const OVERHAULED = /^(users|devices|keys|add-device)[-.a-z]*\.tsx$/;
const files = readdirSync(SECTIONS).filter((f) => OVERHAULED.test(f));

describe("overhauled pages", () => {
  it("finds them", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files)("%s imports no design CSS", (file) => {
    expect(readFileSync(join(SECTIONS, file), "utf8")).not.toMatch(/\.module\.css/);
  });

  it.each(["portal-shell.tsx", "find-anything.tsx"])("the sidebar's %s imports no design CSS", (file) => {
    expect(readFileSync(join(__dirname, "..", "_components", file), "utf8")).not.toMatch(/_design\/[a-z-]+\.module\.css/);
  });

  it("have no CSS modules of their own", () => {
    expect(readdirSync(SECTIONS).filter((f) => f.endsWith(".module.css"))).toEqual([]);
  });
});
