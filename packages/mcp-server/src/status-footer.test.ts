/**
 * 🔒 **`concise` DROPS THE `_dopl_status` FOOTER** (S37/S54, 2026-09-18).
 *
 * `response-size.ts › RESPONSE_FORMAT_FIELD` publishes one promise to every
 * tool that takes the knob — *"drops METADATA — timestamps, ids, scope notes,
 * legends — never a body or a count"* — and this footer was the one part of a
 * response the knob could not reach, because it is appended AFTER the renderers
 * that apply it. The whole value of the knob is that an agent trusts it; a
 * surface that visibly keeps metadata a caller asked it to drop teaches the
 * opposite.
 *
 * ⚠ **AND THE `note` IS NOT METADATA.** A dropped `workspace=` argument and an
 * unmetered call are facts about THIS call that nothing else reports
 * (`workspace-arg.ts › deprecatedAliasNote`, `credits-unmetered.ts`), so they
 * survive the knob. Everything else on the footer does not.
 */

import { describe, it, expect } from "vitest";
import { appendDoplStatus, requestedFormat } from "./status-footer.js";
import type { CallerIdentity } from "./tools/identity.js";
import type { EffectiveWorkspace } from "./workspace-directory.js";
import type { ToolResponse } from "./tools/respond.js";

const CALLER: CallerIdentity = { userId: "user-1" };

const EFFECTIVE: EffectiveWorkspace = {
  id: "ws-1",
  slug: "acme",
  name: "Acme",
  role: "owner",
  source: "per-call arg",
  kind: "standard",
};

function body(text: string): ToolResponse {
  return { content: [{ type: "text", text }] };
}

function textOf(res: ToolResponse): string {
  return res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
}

describe("requestedFormat", () => {
  it("reads the knob a call actually sent", () => {
    expect(requestedFormat({ response_format: "concise" })).toBe("concise");
    expect(requestedFormat({ response_format: "detailed" })).toBe("detailed");
  });

  // ⚠ Arguments arrive off an MCP wire as unvalidated JSON — anything that is
  // not one of the two literals reads as the default rather than throwing.
  it("ignores anything that is not one of the two literals", () => {
    expect(requestedFormat({})).toBeUndefined();
    expect(requestedFormat(null)).toBeUndefined();
    expect(requestedFormat(undefined)).toBeUndefined();
    expect(requestedFormat("concise")).toBeUndefined();
    expect(requestedFormat({ response_format: "CONCISE" })).toBeUndefined();
    expect(requestedFormat({ response_format: 1 })).toBeUndefined();
  });
});

describe("appendDoplStatus", () => {
  it("renders the whole footer by default", async () => {
    const out = textOf(await appendDoplStatus(body("rows"), EFFECTIVE, CALLER));
    expect(out).toContain("_dopl_status:");
    expect(out).toContain("user-1");
    expect(out).toContain("active_workspace:");
    expect(out).toContain("workspace_source: per-call arg");
  });

  it("renders it for detailed, which is the default spelled out", async () => {
    const out = textOf(
      await appendDoplStatus(body("rows"), EFFECTIVE, CALLER, null, "detailed"),
    );
    expect(out).toContain("_dopl_status:");
  });

  it("concise drops the footer entirely, body untouched", async () => {
    const out = textOf(
      await appendDoplStatus(body("rows"), EFFECTIVE, CALLER, null, "concise"),
    );
    expect(out).toBe("rows");
  });

  // ⚠ THE ONE THING `concise` MAY NOT SWALLOW. `workspace-arg.ts` states the
  // rule the other way round — *the ignore is REPORTED, not swallowed* — and a
  // knob that deleted it would make a one-release deprecation window silent.
  it("concise KEEPS a per-call note", async () => {
    const out = textOf(
      await appendDoplStatus(
        body("rows"),
        EFFECTIVE,
        CALLER,
        "workspace= was ignored on this op",
        "concise",
      ),
    );
    expect(out).toContain("workspace= was ignored on this op");
    expect(out).not.toContain("_dopl_status:");
    expect(out).not.toContain("active_workspace:");
  });

  it("an error response carries no footer at either format", async () => {
    const failed: ToolResponse = { isError: true, content: [{ type: "text", text: "no" }] };
    expect(textOf(await appendDoplStatus(failed, EFFECTIVE, CALLER))).toBe("no");
    expect(
      textOf(await appendDoplStatus(failed, EFFECTIVE, CALLER, "note", "concise")),
    ).toBe("no");
  });

  it("concise on a response with no text content adds nothing", async () => {
    const empty: ToolResponse = { content: [] };
    const out = await appendDoplStatus(empty, EFFECTIVE, CALLER, null, "concise");
    expect(out.content).toEqual([]);
  });
});

/**
 * 🔒 **S29b — `container=` ROUTES ONE CALL, NOT THE CONNECTION.** The override
 * runs inside an AsyncLocalStorage scope that reverts on exit, so
 * `active_workspace` legitimately differs between two consecutive calls; the
 * footer now says which of the two kinds of difference it is.
 */
describe("the footer says whether the connection binding moved", () => {
  const PINNED: EffectiveWorkspace = {
    id: "ws-home",
    slug: "home",
    name: "Home",
    role: "owner",
    source: "header pin",
    kind: "home",
  };

  it("a per-call override is marked THIS CALL ONLY and names the connection", async () => {
    const out = textOf(
      await appendDoplStatus(body("rows"), EFFECTIVE, CALLER, null, undefined, PINNED),
    );
    expect(out).toContain("workspace_source: per-call arg — THIS CALL ONLY");
    expect(out).toContain("the connection is still on `home` (id=`ws-home`)");
  });

  // ⚠ B13 made an unbound connection ORDINARY, so it is named rather than left
  // blank — an agent that reads nothing there assumes the override stuck.
  it("an UNBOUND connection is named as unbound", async () => {
    const out = textOf(
      await appendDoplStatus(body("rows"), EFFECTIVE, CALLER, null, undefined, null),
    );
    expect(out).toContain("the connection is still on no container");
  });

  it("a header pin IS the binding and gains no clause", async () => {
    const out = textOf(
      await appendDoplStatus(body("rows"), PINNED, CALLER, null, undefined, PINNED),
    );
    expect(out).toContain("workspace_source: header pin");
    expect(out).not.toContain("THIS CALL ONLY");
  });

  it("an override naming the container the connection was already on moved nothing", async () => {
    const same: EffectiveWorkspace = { ...PINNED, source: "per-call arg" };
    const out = textOf(
      await appendDoplStatus(body("rows"), same, CALLER, null, undefined, PINNED),
    );
    expect(out).toContain("workspace_source: per-call arg");
    expect(out).not.toContain("THIS CALL ONLY");
  });

  // ⚠ Every caller that cannot be addressed away (the meta path) omits it, and
  // omitted must stay byte-identical to what that path rendered before.
  it("an omitted binding renders exactly what it always did", async () => {
    const out = textOf(await appendDoplStatus(body("rows"), EFFECTIVE, CALLER));
    expect(out).toContain("workspace_source: per-call arg");
    expect(out).not.toContain("THIS CALL ONLY");
  });
});
