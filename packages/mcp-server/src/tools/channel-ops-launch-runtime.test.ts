/**
 * `op="manage" action="launch"` — **THE RUNTIME FIELD, END TO END ACROSS THIS PROCESS** (U9,
 * 2026-09-21).
 *
 * 🔒 **THE DEFECT, VERBATIM FROM `docs/plans/2026-09-21-001-fix-codex-runtime-parity-plan.md`**:
 * *a live MCP launch carrying `model: "codex"` was accepted but started a Claude Sonnet agent,
 * because the MCP contract has no runtime field and an unknown model falls through to the default
 * adapter.*
 *
 * ⚠ **THIS SUITE'S HALF OF THAT IS THE CONTRACT, NOT THE LAUNCH.** No agent starts here: this
 * process files a row and renders what came back. So what is asserted is exactly (a) that the
 * shape PUBLISHES a runtime separately from a model, (b) that the field reaches the create body
 * untouched, and (c) that the RESULT names the runtime that actually ran — which is the half the
 * original reproduction lacked, since a result that never mentioned a vendor could not have
 * revealed the wrong one.
 *
 * ⚠ **THE THIRD SUITE ON THIS OP AND THE SEAM IS THE EXISTING ONE.**
 * `channel-ops-launch.test.ts` asserts what a RESULT TEACHES, `channel-ops-launch-body.test.ts`
 * what the CREATE BODY CONTAINS; this one is about one field crossing both, and it fails for a
 * reason neither of those does.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, LaunchDirective } from "@dopl/client";
import { opLaunchAgent } from "./channel-ops-launch";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
import { DOCTRINE_SECTIONS } from "./channel-doctrine";

const CHANNEL = { id: "chan-1", slug: "general", name: "General", visibility: "private" };

function directive(over: Partial<LaunchDirective> = {}): LaunchDirective {
  return {
    id: "55555555-5555-5555-5555-555555555555",
    channelId: "chan-1",
    threadId: null,
    goal: "ship the parser",
    model: null,
    status: "pending",
    identityId: null,
    identityName: null,
    refusalReason: null,
    agentId: null,
    claimedAt: null,
    decidedAt: null,
    expiresAt: "2026-08-22T12:02:00.000Z",
    createdAt: "2026-08-22T12:00:00.000Z",
    ...over,
  };
}

function client(over: Record<string, unknown> = {}): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    createLaunchDirective: vi.fn(async () => ({ offline: false, directive: directive() })),
    getLaunchDirective: vi.fn(async () => directive()),
    ...over,
  } as unknown as DoplClient;
}

/** A client whose CREATE already answers with this directive (no poll needed). */
const created = (over: Partial<LaunchDirective>) =>
  client({
    createLaunchDirective: vi.fn(async () => ({ offline: false, directive: directive(over) })),
  });

const text = async (c: DoplClient, opts = {}) =>
  (await opLaunchAgent(c, "general", { name: "Scout", ...opts })).content[0].text as string;

const launched = (over: Partial<LaunchDirective> = {}) =>
  directive({ status: "launched", agentId: "abcd1234", ...over });

describe("the published shape", () => {
  it("publishes `runtime` SEPARATELY from `model` — neither describes the other", () => {
    const shape = CHANNEL_INPUT_SHAPE as Record<string, { description?: string }>;
    expect(shape.runtime, "the field must exist or U9 ships as a no-op").toBeDefined();
    const runtime = shape.runtime.description ?? "";
    const model = shape.model.description ?? "";
    // ⚠ THE ONE THING A CALLER MUST NOT GUESS: that these are two fields. The describe says so in
    // the caller's own words rather than relying on the reader noticing two params.
    expect(runtime).toContain("`model`");
    expect(runtime.toLowerCase()).toContain("refused");
    // ⚠ AND `model`'s OWN DESCRIBE MUST NOT START NAMING RUNTIMES. The moment it does, a caller
    // has two places to learn one rule and the surface has re-created the overload.
    expect(model.toLowerCase()).not.toContain("runtime");
    expect(model.toLowerCase()).not.toContain("codex");
  });

  it("is NOT a closed enum — the roster lives on the operator's desktop", () => {
    // ⚠ `color` beside it IS an enum, and the contrast is the decision: the sixteen colour keys
    // are OURS, the runtime roster is `main/runtime/index.js`'s REGISTRY and moves with a DESKTOP
    // release. An enum here would refuse a runtime a newer machine already ships.
    const json = JSON.stringify(
      (CHANNEL_INPUT_SHAPE as Record<string, unknown>).runtime,
    );
    expect(json).not.toContain("claude");
    expect(json).not.toContain("codex");
  });

  it("states the REFUSE-not-swap asymmetry in the pulled doctrine, where the rule belongs", () => {
    const manage = DOCTRINE_SECTIONS.manage;
    expect(manage).toContain("no-sdk");
    // ⚠ BOTH HALVES IN ONE PLACE. Since 2026-09-22 there is no asymmetry left to warn about: an
    // unknown MODEL is refused (`no-model`, the Claude roster went live) exactly as an unknown
    // RUNTIME is (`no-sdk`) — and neither is ever swapped for another.
    expect(manage).toContain("NOTHING IS SWAPPED");
    expect(manage).toContain("`no-model`");
    expect(manage.toLowerCase()).toContain("rather than launching another vendor");
  });
});

describe("the create body", () => {
  it("passes an explicit runtime through untouched", async () => {
    const createLaunchDirective = vi.fn(async () => ({
      offline: false,
      directive: launched(),
    }));
    await opLaunchAgent(client({ createLaunchDirective }), "general", {
      name: "Scout",
      runtime: "codex",
    });
    expect(createLaunchDirective.mock.calls[0][0]).toMatchObject({ runtime: "codex" });
  });

  // ⚠ OMITTED MUST STAY OMITTED ALL THE WAY DOWN. A default substituted here would turn "the
  // operator's own chain decides" into "this process decided", on a machine it cannot see.
  it("sends NO runtime when none was asked for — never a default", async () => {
    const createLaunchDirective = vi.fn(async () => ({
      offline: false,
      directive: launched(),
    }));
    await opLaunchAgent(client({ createLaunchDirective }), "general", { name: "Scout" });
    expect(createLaunchDirective.mock.calls[0][0]).toMatchObject({ runtime: undefined });
  });

  // 🔒 THE ORIGINAL REPRODUCTION, AS A TEST. `model: "codex"` must reach the model slot and
  // NOTHING else — it is not a runtime request, and the result below proves it cannot masquerade
  // as one.
  it("`model: \"codex\"` asks for no runtime at all", async () => {
    const createLaunchDirective = vi.fn(async () => ({
      offline: false,
      directive: launched(),
    }));
    await opLaunchAgent(client({ createLaunchDirective }), "general", {
      name: "Scout",
      model: "codex",
    });
    const body = createLaunchDirective.mock.calls[0][0] as Record<string, unknown>;
    expect(body.model).toBe("codex");
    expect(body.runtime).toBeUndefined();
  });
});

describe("the result names what actually ran", () => {
  it("prints the APPLIED runtime on every launch, asked for or not", async () => {
    const out = await text(created(launched({ appliedRuntime: "claude" })));
    expect(out).toContain("runtime=claude");
    // ⚠ AND NOT A SECOND FIELD SAYING THE SAME THING. On the ordinary launch the request is null
    // and the applied value is real; a `runtimeAsked=-` on every line is noise the write-result
    // budget cannot carry.
    expect(out).not.toContain("runtimeAsked");
  });

  // 🔒 THE REPRODUCTION'S RESULT. The row says `model=codex` and `runtime=claude` — the two facts
  // side by side, which is exactly what the original launch could not say.
  it("cannot let `model: codex` masquerade as a successful Codex selection", async () => {
    const out = await text(
      created(launched({ model: "codex", runtime: null, appliedRuntime: "claude" })),
      { model: "codex" },
    );
    expect(out).toContain("model=codex");
    expect(out).toContain("runtime=claude");
  });

  it("names the REQUEST too, but only when the machine reports something else", async () => {
    const out = await text(
      created(launched({ runtime: "codex", appliedRuntime: "cursor" })),
      { runtime: "codex" },
    );
    expect(out).toContain("runtime=cursor");
    expect(out).toContain("runtimeAsked=codex");
  });

  it("an honoured explicit request prints ONE field, not two", async () => {
    const out = await text(
      created(launched({ runtime: "codex", appliedRuntime: "codex" })),
      { runtime: "codex" },
    );
    expect(out).toContain("runtime=codex");
    expect(out).not.toContain("runtimeAsked");
  });

  // ⚠ §13 — AN OLDER DESKTOP REPORTS NOTHING, AND THE WORD FOR THAT IS NOT A VENDOR. `postureFacts`
  // already refuses to guess for the same reason; guessing `claude` here would tell an
  // orchestrator which vendor ran on the strength of a column nobody filled in.
  it("says `not reported` for an older desktop — never the default runtime", async () => {
    const out = await text(created(launched({ appliedRuntime: null })));
    expect(out).toContain('runtime="not reported"');
    expect(out).not.toContain("runtime=claude");
  });

  it("names the applied MODEL only when it differs from the one asked for", async () => {
    const same = await text(
      created(launched({ model: "gpt-6-astra", appliedModel: "gpt-6-astra" })),
    );
    expect(same).not.toContain("appliedModel");
    // ⚠ THE CASE THAT MATTERS: a cross-vendor model was DROPPED, so the machine ran something
    // else. Without this the caller reads `model=claude-opus-5` on a Codex session.
    const differs = await text(
      created(launched({ model: "claude-opus-5", appliedModel: "gpt-6-astra" })),
    );
    expect(differs).toContain("appliedModel=gpt-6-astra");
  });

  // ⚠ A REFUSAL IS THE OTHER HALF OF THE CONTRACT AND IT MUST NOT GROW A RUNTIME FIELD: nothing
  // ran, so there is nothing to name, and `retry=no` is the whole of what to do next.
  it("a refused launch names the word and reports no runtime", async () => {
    const out = await text(
      created(directive({ status: "refused", refusalReason: "no-sdk" })),
    );
    expect(out).toContain("reason=no-sdk");
    expect(out).toContain("retry=no");
    expect(out).not.toContain("runtime=");
  });
});
