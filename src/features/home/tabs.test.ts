/**
 * 🔒 **R-33 — SKILLS AND CHATS STAY OUT OF THE HOME SPACE** (Samuel,
 * 2026-09-17: *"NO — Skills and Chats stay out of home."*, option (c), reversing
 * this wave's own recommendation of (a)).
 *
 * ⚠ **THIS IS AN ABSENCE TEST, AND DELETING IT DELETES THE RULING** (04
 * §F-5a). The roadmap's V1/V3 rows proposed a personal Chats shelf and a
 * personal Skills shelf as /home's sixth and seventh faces; the ruling dropped
 * both, so what has to be pinned is that nothing mounts them. A wave that adds
 * one has to come through here.
 *
 * ⚠ **TWO CLAIMS, BECAUSE A FACE AND A MOUNT ARE DIFFERENT THINGS.** The tab
 * SET is the vocabulary (`tabs.ts`, read by the SPA page and by the landing
 * page's hero strip); the IMPORT SCAN is what catches a skills or chats surface
 * arriving inside an existing face, which is the shape the V1/V3 rows actually
 * described ("a personal shelf").
 *
 * ⚠ **IT IS NOT A CLAIM ABOUT THE MCP SURFACE.** `dopl_skill` and `dopl_chats`
 * are `workspace_id`-scoped and already reach a personal container; R-33 is
 * about /home having no FACE for either. ⚠ And V2 — `dopl_chats(op="export")`
 * with no container filing chats nothing lists — is still an OPEN orphan class
 * (00-MASTER §5 Wave 7), not something this file closes.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOME_TABS } from "./tabs";

/** Every source file under a /home tree, on both sides of the `apps/` fence. */
function homeSources(): string[] {
  const roots = [
    path.join(process.cwd(), "src/features/home"),
    path.join(process.cwd(), "apps/desktop-ui/src/pages/home"),
  ];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  roots.forEach(walk);
  return out;
}

describe("R-33 — the home space has no Skills and no Chats", () => {
  it("names FIVE faces, and neither `skills` nor `chats` is one of them", () => {
    expect(HOME_TABS.map((t) => t.key)).toEqual([
      "overview",
      "channels",
      "knowledge",
      "identities",
      "ontology",
    ]);
  });

  /**
   * ⚠ THE SCAN IS OVER SOURCE, not over a render: a shelf mounted three
   * components down would draw nothing this file could query, and the thing
   * the ruling forbids is the DEPENDENCY.
   */
  it("mounts neither feature — no /home module imports `@/features/{skills,chats}`", () => {
    const offenders = homeSources().filter((file) =>
      /from\s+"@\/features\/(skills|chats)/.test(readFileSync(file, "utf8"))
    );
    expect(offenders.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });

  /** A measurement, so the claim above cannot pass by scanning nothing. */
  it("scanned a real tree", () => {
    expect(homeSources().length).toBeGreaterThan(20);
  });
});
