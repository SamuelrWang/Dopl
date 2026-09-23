// `manage action="launch"` runtime field: published apart from `model`, carried to the create body
// untouched, and named on the RESULT as the runtime that actually ran.

import { describe, it, expect, vi } from "vitest";
import { opLaunchAgent } from "./channel-ops-launch";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
import { DOCTRINE_SECTIONS } from "./channel-doctrine";
import {
  created,
  launchClient as client,
  launchText as text,
  launched,
} from "./launch-fixtures";

describe("the published shape", () => {
  it("publishes `runtime` SEPARATELY from `model` — neither describes the other", () => {
    const shape = CHANNEL_INPUT_SHAPE as Record<string, { description?: string }>;
    expect(shape.runtime, "the field must exist or U9 ships as a no-op").toBeDefined();
    const runtime = shape.runtime.description ?? "";
    const model = shape.model.description ?? "";
    expect(runtime).toContain("`model`");
    expect(runtime.toLowerCase()).toContain("refused");
    // `model`'s describe must not name runtimes, or one rule has two homes.
    expect(model.toLowerCase()).not.toContain("runtime");
    expect(model.toLowerCase()).not.toContain("codex");
  });

  it("is NOT a closed enum — the roster lives on the operator's desktop", () => {
    // The runtime roster ships with the desktop, so an enum here would refuse a newer machine's runtime.
    const json = JSON.stringify(
      (CHANNEL_INPUT_SHAPE as Record<string, unknown>).runtime,
    );
    expect(json).not.toContain("claude");
    expect(json).not.toContain("codex");
  });

  it("states the REFUSE-not-swap asymmetry in the pulled doctrine, where the rule belongs", () => {
    const manage = DOCTRINE_SECTIONS.manage;
    expect(manage).toContain("no-sdk");
    // An unknown model (`no-model`) and an unknown runtime (`no-sdk`) are both refused, never swapped.
    expect(manage).toContain("NOTHING IS SWAPPED");
    expect(manage).toContain("`no-model`");
    expect(manage.toLowerCase()).toContain("rather than launching another vendor");
  });
});

describe("the create body", () => {
  it("passes an explicit runtime through untouched", async () => {
    const createLaunchDirective = vi.fn(async () => ({ offline: false, directive: launched() }));
    await opLaunchAgent(client({ createLaunchDirective }), "general", {
      name: "Scout",
      runtime: "codex",
    });
    expect(createLaunchDirective.mock.calls[0][0]).toMatchObject({ runtime: "codex" });
  });

  // Omitted stays omitted: the operator's own chain decides, not this process.
  it("sends NO runtime when none was asked for — never a default", async () => {
    const createLaunchDirective = vi.fn(async () => ({ offline: false, directive: launched() }));
    await opLaunchAgent(client({ createLaunchDirective }), "general", { name: "Scout" });
    expect(createLaunchDirective.mock.calls[0][0]).toMatchObject({ runtime: undefined });
  });

  // The reproduction: `model: "codex"` fills the model slot only and is not a runtime request.
  it("`model: \"codex\"` asks for no runtime at all", async () => {
    const createLaunchDirective = vi.fn(async () => ({ offline: false, directive: launched() }));
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
    // No `runtimeAsked=` when the request was null; the write-result budget cannot carry the noise.
    expect(out).not.toContain("runtimeAsked");
  });

  // `model=codex` beside `runtime=claude`: the two facts the reproduction could not show.
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

  // An older desktop reports nothing; guessing `claude` would name a vendor off an empty column
  // (INVARIANTS §13).
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
    // A dropped cross-vendor model: without this the caller reads a Claude model on a Codex session.
    const differs = await text(
      created(launched({ model: "claude-opus-5", appliedModel: "gpt-6-astra" })),
    );
    expect(differs).toContain("appliedModel=gpt-6-astra");
  });

  // Nothing ran, so a refusal names no runtime.
  it("a refused launch names the word and reports no runtime", async () => {
    const out = await text(
      created({ status: "refused", refusalReason: "no-sdk" }),
    );
    expect(out).toContain("reason=no-sdk");
    expect(out).toContain("retry=no");
    expect(out).not.toContain("runtime=");
  });
});

// A `runtime` validation failure names the field, not the generic body error (which sent agents
// to trim their goal).
describe("a refused FIELD is named", () => {
  it("a VALIDATION_FAILED names the first zod issue's field and message", async () => {
    const rejected = Object.assign(new Error("bad"), {
      status: 400,
      code: "VALIDATION_FAILED",
      apiMessage: "Request body failed validation",
      details: [{ path: ["runtime"], message: "A runtime id is 1-32 lowercase characters, e.g. claude or codex" }],
    });
    const out = await text(client({ createLaunchDirective: vi.fn(async () => { throw rejected; }) }),
      { runtime: "Codex" });
    expect(out).toContain("runtime: A runtime id is 1-32 lowercase characters");
    expect(out).not.toContain("Shorten");
  });
});

// Codex tool words are published, carried to the create untouched, and echoed.
describe("each runtime's own tool words", () => {
  it("publishes every runtime's Axis-A words and says which are whose", () => {
    const posture = (CHANNEL_INPUT_SHAPE as Record<string, unknown>).posture as {
      unwrap: () => { shape: { tools: { unwrap: () => { options: string[] }; description?: string } } };
    };
    const tools = posture.unwrap().shape.tools;
    expect(tools.unwrap().options).toEqual(expect.arrayContaining(["on-request", "never", "run-everything"]));
    expect(tools.description).toContain("codex untrusted..never");
  });

  it("files a Codex word as asked and renders the machine's Codex echo", async () => {
    const c = created(launched({ runtime: "codex", appliedRuntime: "codex", appliedToolMode: "on-request" }));
    const out = await text(c, { runtime: "codex", tools: "never" });
    expect((c.createLaunchDirective as ReturnType<typeof vi.fn>).mock.calls[0][0])
      .toMatchObject({ runtime: "codex", tools: "never" });
    expect(out).toContain("posture=on-request/-");
  });
});
