/**
 * Both launch-directive handlers pass the parsed body through whole. A hand-enumerated field list
 * silently dropped validated fields three times (`color`, `agentName`, `appliedAgentName`; F-708),
 * because a missing optional property is not a type error. Source read: importing the handlers
 * needs `next/server` and an auth context.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LaunchCreateSchema, LaunchDecideSchema } from "./schema-launch";

const ROUTE_PATH = path.join(
  process.cwd(),
  "src/app/api/channels/launch-directives/route.ts",
);

const DECIDE_ROUTE_PATH = path.join(
  process.cwd(),
  "src/app/api/channels/launch-directives/decide/route.ts",
);

describe("POST /api/channels/launch-directives — the handler forwards the whole schema", () => {
  // F21: the create handler passes the parsed input through whole, as the decide handler does, so
  // no validated field can be dropped by a hand-enumerated list (F-708). `tsc` checks the types.
  it("passes the parsed input straight to createLaunchDirective", () => {
    const src = readFileSync(ROUTE_PATH, "utf8");
    expect(src).toMatch(/createLaunchDirective\(ctx, input\)/);
    expect(src).not.toMatch(/createLaunchDirective\(ctx,\s*\{/);
  });

  it("the schema still carries agentName and color", () => {
    expect(Object.keys(LaunchCreateSchema.shape)).toEqual(
      expect.arrayContaining(["agentName", "color"]),
    );
  });
});

// 🔒 F2: the decide handler re-built each arm by enumerating fields, and dropped the `done` arm's
// `set_agent_mode` echo (as it had dropped `appliedAgentName` before). It now passes the parsed
// decision through whole, so no field the schema validates can be lost at this handler.
describe("POST /api/channels/launch-directives/decide — the machine's whole report lands", () => {
  it("passes the parsed decision through whole — no arm is re-built by hand", () => {
    const src = readFileSync(DECIDE_ROUTE_PATH, "utf8");
    expect(src).toMatch(/const \{ directiveId, \.\.\.decision \} = input;/);
    expect(src).toMatch(/decideLaunchDirective\(ctx, directiveId, decision\)/);
    expect(src).not.toMatch(/status:\s*"(launched|done|refused)"/);
  });

  it("the schema's `done` arm carries the re-posture echo the handler now forwards", () => {
    const done = LaunchDecideSchema.options.find((o) => o.shape.status.value === "done");
    expect(Object.keys(done!.shape)).toEqual(
      expect.arrayContaining(["appliedTools", "appliedMessages"]),
    );
  });
});
