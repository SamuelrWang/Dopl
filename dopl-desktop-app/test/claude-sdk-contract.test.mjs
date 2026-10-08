// THE CLAUDE SDK CONTRACT (2026-10-08, SDK resilience #4) on the shared harness (`helpers/shape-contract.mjs`):
// static (every declared item is read by Dopl's code), tier 1 (the MEASURED fixture covers every declared
// item), tier 2 (opt-in `CLAUDE_SDK_LIVE=1`: the installed pairing's own description covers safety + core).
// Re-capture the fixture from a real build when the bundle moves; never edit it by hand.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { runShapeContract } from "./helpers/shape-contract.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const claude = require("../main/runtime/claude/index.js");
const roster = require("../main/runtime/claude/roster.js");

runShapeContract({
  runtimeId: "claude",
  required: claude.descriptor.requiredShape,
  fixture: JSON.parse(readFileSync(join(HERE, "fixtures", "claude-shape.json"), "utf8")),
  liveEnv: "CLAUDE_SDK_LIVE",
  liveProbe: async () => {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    const bin = require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`).replace(/package\.json$/, "claude");
    return roster.observeShape({ sdk, options: { pathToClaudeCodeExecutable: bin, env: { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: "0" } } });
  },
  // Where Dopl READS each declared item: the adapter, plus core's Stop (`interrupt`) and live switch (`setModel`).
  sources: [
    ...["index.js", "models.js", "roster.js", "launch-spec.js", "axis-b.js", "normalize.js"].map((f) => join(MAIN, "runtime", "claude", f)),
    join(MAIN, "session-engine.js"),
    join(MAIN, "session-reopen.js"),
  ],
});
