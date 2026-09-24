/**
 * Rollout R4's deprecation notice, built and OFF: with `deprecateLegacy`, a direct legacy call's reply
 * ends with one line naming its granular successor, derived from the manifest. Nothing sets the flag
 * yet (`bootServer` never passes it), so every connection answers as before.
 */

import { describe, it, expect } from "vitest";

import { boot, call } from "./surface-sweep.js";
import { successorOf } from "./call-ref.js";
import { GRANULAR_TOOLS, bindingsOf, parseBinding } from "./tool-manifest.js";

const NOTICE = /⚠ dopl_\w+ is deprecated: call /;

describe("the legacy deprecation notice", () => {
  it("is off unless the flag is set", async () => {
    for (const set of ["legacy", "granular"] as const) {
      const b = await boot(set);
      expect((await call(b, "dopl_workspaces", { op: "list" })).text, set).not.toMatch(NOTICE);
    }
  });

  it.each([
    ["dopl_workspaces", { op: "list" }, "dopl_list_workspaces()"],
    ["dopl_status", {}, "dopl_get_status()"],
    ["dopl_channel", { op: "rooms", action: "help" }, 'dopl_get_guide(topic="channels")'],
    ["dopl_kb", { op: "get_tree", base: "notes" }, 'dopl_browse_knowledge(action="tree")'],
  ] as const)("%s %j names %s, on either set, success or refusal", async (name, args, successor) => {
    for (const set of ["legacy", "granular"] as const) {
      const b = await boot(set, { deprecateLegacy: true, answers: { listKbBases: [] } });
      const lines = (await call(b, name, args)).text.split("\n");
      expect(lines.at(-1), set).toBe(`⚠ ${name} is deprecated: call ${successor} instead.`);
    }
  });

  it("never rides a granular call, or a legacy name the granular set kept", async () => {
    const b = await boot("legacy", { deprecateLegacy: true });
    expect((await call(b, "dopl_list_workspaces", {})).text).not.toMatch(NOTICE);
    expect((await call(b, "dopl_search", { query: "x" })).text).not.toMatch(NOTICE);
  });

  it("every renamed legacy job has a successor that binds it", () => {
    for (const t of GRANULAR_TOOLS) {
      for (const key of bindingsOf(t)) {
        const { tool, op } = parseBinding(key);
        const successor = successorOf(tool, op);
        if (t.name === tool) {
          expect(successor, key).toBeNull();
          continue;
        }
        const named = GRANULAR_TOOLS.find((g) => successor?.startsWith(`${g.name}(`));
        expect(named && bindingsOf(named).includes(key), `${key} → ${successor}`).toBe(true);
      }
    }
  });

  it("an op no job binds names nothing", () => {
    expect(successorOf("dopl_kb", "no_such_op")).toBeNull();
    expect(successorOf("dopl_kb", undefined)).toBeNull();
  });
});
