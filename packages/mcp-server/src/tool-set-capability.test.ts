/**
 * The tool-set advertisement (DMP-013 B4): `initialize` names both sets on EVERY connection, so a
 * client can ask for `granular` knowing it will be honoured. The desktop reads it off its launch
 * pre-flight (`dopl-desktop-app/main/mcp-connect.js › advertisedToolSets`) and pins the wire shape
 * on its side. Measured as served: real `createServer`, real transport.
 */

import { describe, expect, it } from "vitest";

import { boot } from "./surface-sweep.js";
import { TOOL_SETS, TOOL_SETS_CAPABILITY } from "./tool-manifest.js";

describe("tool-set capability", () => {
  it.each(TOOL_SETS)("a %s connection advertises both sets beside its tools", async (set) => {
    const { client } = await boot(set);
    const caps = client.getServerCapabilities();
    expect(TOOL_SETS_CAPABILITY).toBe("dopl/toolSets");
    expect(caps?.experimental?.[TOOL_SETS_CAPABILITY]).toEqual({ sets: ["legacy", "granular"] });
    expect(caps?.tools).toBeDefined();
    await client.close();
  });
});
