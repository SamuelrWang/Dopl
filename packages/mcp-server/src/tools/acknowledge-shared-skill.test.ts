/**
 * 🔒 **G16'S THIRD RESOURCE TYPE** (closed 2026-09-02, review D2).
 *
 * A11 shipped the acknowledge-shared precondition into knowledge bases and agent
 * templates and recorded the guardrail row as closed over "all three callers".
 * There were three resource types and the helper reached two:
 * `dopl_skill(op="set_visibility")` published into a `kind='link'` container a
 * peer is standing in with NO preview in front of it and NO precondition behind
 * it. A row closed on two of three types reads, from the ledger, as closed.
 *
 * ⚠ **IT DRIVES THE REAL `dopl_skill` REGISTRAR**, on `acknowledge-shared.test.ts`'s
 * own reasoning about F-441: the op function is not the fence, the `case` is —
 * that defect was an arm handing its op neither the caller id nor the token.
 *
 * ⚠ ITS OWN FILE at the §1 500-line cap; the fixtures both suites need live in
 * `acknowledge-shared-fixtures.ts` so "the only room this class fires in" has one
 * definition.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { DoplClient } from "@dopl/client";

import { stub } from "./narration-fixtures";
import { __resetConfirmTokensForTest } from "./confirm-token";
import { registerSkillTools } from "./skills";
import { UNKNOWN_CALLER, type CallerIdentity } from "./identity";
import type { RegisterTool, ToolResponse } from "./respond";
import {
  ME, apiError, sharedContainer, textOf, tokenIn, workspaceStub,
} from "./acknowledge-shared-fixtures";

afterEach(() => {
  __resetConfirmTokensForTest();
});

/**
 * 🔒 **SKILLS WERE THE ONE TYPE A11 DID NOT REACH**, and the ledger recorded G16
 * as closed anyway. `dopl_skill(op="set_visibility")` published into a peer's
 * container with no preview in front of it and no precondition behind it — so
 * this block drives the REAL `dopl_skill` handler, on `doplKb`'s reasoning: the
 * op function is not the fence, the `case` is.
 */
function doplSkill(client: DoplClient, caller: CallerIdentity): (
  args: Record<string, unknown>,
) => Promise<ToolResponse> {
  const handlers = new Map<string, unknown>();
  const capture: RegisterTool = (name, _d, _s, handler) => {
    handlers.set(name, handler);
  };
  registerSkillTools(capture, client, caller);
  const tool = handlers.get("dopl_skill");
  if (!tool) throw new Error("dopl_skill was not registered");
  return tool as (a: Record<string, unknown>) => Promise<ToolResponse>;
}

const SKILL = {
  id: "skill-1",
  slug: "ship-it",
  name: "Ship it",
  visibility: "public" as const,
};

describe("dopl_skill(op=\"set_visibility\") — previews, then acknowledges", () => {
  it("publishing previews first and writes NOTHING", async () => {
    const update = vi.fn(async () => SKILL);
    const client = stub({
      ...sharedContainer(),
      updateSkill: update,
    }) as DoplClient;
    const skill = doplSkill(client, { ...UNKNOWN_CALLER, userId: ME });

    const preview = await skill({
      op: "set_visibility",
      slug: "ship-it",
      visibility: "public",
    });

    expect(update).not.toHaveBeenCalled();
    expect(textOf(preview)).toContain("confirm_token=");
  });

  it("the spent token becomes acknowledgeShared on the write", async () => {
    const update = vi.fn(async () => SKILL);
    const client = stub({
      ...sharedContainer(),
      updateSkill: update,
    }) as DoplClient;
    const skill = doplSkill(client, { ...UNKNOWN_CALLER, userId: ME });

    const preview = await skill({
      op: "set_visibility",
      slug: "ship-it",
      visibility: "public",
    });
    await skill({
      op: "set_visibility",
      slug: "ship-it",
      visibility: "public",
      confirm_token: tokenIn(textOf(preview)),
    });

    expect(update).toHaveBeenCalledWith(
      "ship-it",
      expect.objectContaining({ visibility: "public", acknowledgeShared: true }),
    );
  });

  it("UN-publishing is not gated, and sends no flag", async () => {
    // ⚠ THE NEGATIVE ARM. `visibility="private"` only ever narrows; a preview
    // there would ask the operator to confirm the safe direction, which is how a
    // confirm step stops being read.
    const update = vi.fn(async () => ({ ...SKILL, visibility: "private" as const }));
    const client = stub({
      ...sharedContainer(),
      updateSkill: update,
    }) as DoplClient;
    const skill = doplSkill(client, { ...UNKNOWN_CALLER, userId: ME });

    await skill({ op: "set_visibility", slug: "ship-it", visibility: "private" });

    expect(update).toHaveBeenCalledWith("ship-it", {
      visibility: "private",
      acknowledgeShared: undefined,
    });
  });

  it("a SOLO container publishes with no preview and no flag", async () => {
    const update = vi.fn(async () => SKILL);
    const client = stub({
      ...workspaceStub("link", 1),
      updateSkill: update,
    }) as DoplClient;
    const skill = doplSkill(client, { ...UNKNOWN_CALLER, userId: ME });

    await skill({ op: "set_visibility", slug: "ship-it", visibility: "public" });

    expect(update).toHaveBeenCalledWith("ship-it", {
      visibility: "public",
      acknowledgeShared: undefined,
    });
  });

  it("the server's 400 reaches the agent as a next action, not a stack trace", async () => {
    const client = stub({
      ...sharedContainer(),
      updateSkill: vi.fn(async () => {
        throw apiError(400, "CONTAINER_PUBLISH_UNACKNOWLEDGED");
      }),
    }) as DoplClient;
    const skill = doplSkill(client, { ...UNKNOWN_CALLER, userId: ME });

    const preview = await skill({
      op: "set_visibility",
      slug: "ship-it",
      visibility: "public",
    });
    const res = await skill({
      op: "set_visibility",
      slug: "ship-it",
      visibility: "public",
      confirm_token: tokenIn(textOf(preview)),
    });

    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("Ask your operator");
  });
});
