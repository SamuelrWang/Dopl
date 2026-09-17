/**
 * 🔒 **G16 / A11 — THE SPENT TOKEN BECOMES THE SERVER'S PRECONDITION.**
 *
 * `shelf-confirm.test.ts` pins the confirm class as a TRIPWIRE: what the preview
 * says, and that nothing is written until a token comes back. This file pins the
 * one thing that made a fence out of it — the write body that follows a spent
 * token carries `acknowledgeShared: true`, and the body that follows any OTHER
 * proceed does not.
 *
 * ⚠ **THE NEGATIVE ARMS ARE THE POINT.** A flag set on every publish would pass
 * the server and buy nothing: it would be the client-side confirm again, wearing
 * a boolean. So each proceed that showed NOBODY anything — a private create, a
 * standard workspace, a solo container — is asserted to send no flag at all.
 *
 * ⚠ AND `undefined`, NEVER `false`. The server examines only an explicit `true`
 * (`src/features/workspaces/server/shared-publish.ts`); a `false` on the wire
 * would tell the next reader that the other value is examined too.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { DoplClient } from "@dopl/client";

import { opCreate, opUpdate } from "./agent-ops-write";
import { opCreateBase, opSetVisibility } from "./knowledge-ops-write";
import { stub } from "./narration-fixtures";
import { __resetConfirmTokensForTest } from "./confirm-token";
import { registerKnowledgeTools } from "./knowledge";
import { UNKNOWN_CALLER, type CallerIdentity } from "./identity";
import type { RegisterTool, ToolResponse } from "./respond";
import type { WorkspaceDirectory } from "../workspace-directory";
import {
  ME, apiError, base, sharedContainer, TEMPLATE, textOf, tokenIn, workspaceStub,
} from "./acknowledge-shared-fixtures";

/** ⚠ Both rows live in `acknowledge-shared-fixtures.ts` — one definition each. */
const BASE = base("public");

afterEach(() => {
  __resetConfirmTokensForTest();
});

// ── The token → the flag ─────────────────────────────────────────────

describe("dopl_agent — a spent token acknowledges the audience", () => {
  it("op=create sends acknowledgeShared on the confirmed write, and nothing before it", async () => {
    const create = vi.fn(async () => TEMPLATE);
    const client = stub({
      ...sharedContainer(),
      createAgentTemplate: create,
    }) as DoplClient;
    const input = { name: "Researcher", visibility: "workspace" as const };

    const preview = await opCreate(client, ME, input);
    expect(create).not.toHaveBeenCalled();

    await opCreate(client, ME, {
      ...input,
      confirm_token: tokenIn(textOf(preview)),
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "workspace", acknowledgeShared: true })
    );
  });

  it("op=update carries it on the PATCH, beside the field that actually moves", async () => {
    const update = vi.fn(async () => TEMPLATE);
    const client = stub({
      ...sharedContainer(),
      listAgentTemplates: vi.fn(async () => [TEMPLATE]),
      updateAgentTemplate: update,
    }) as DoplClient;
    const input = { visibility: "workspace" as const };

    const preview = await opUpdate(client, ME, TEMPLATE.id, input);
    expect(update).not.toHaveBeenCalled();

    await opUpdate(client, ME, TEMPLATE.id, {
      ...input,
      confirm_token: tokenIn(textOf(preview)),
    });
    expect(update).toHaveBeenCalledWith(
      TEMPLATE.id,
      expect.objectContaining({ visibility: "workspace", acknowledgeShared: true })
    );
  });
});

describe("dopl_kb — a spent token acknowledges the audience", () => {
  it("op=create_base sends acknowledgeShared on the confirmed write", async () => {
    const create = vi.fn(async () => BASE);
    const client = stub({
      ...sharedContainer(),
      // ⚠ THE DOUBLE MOVED, THE ASSERTION DID NOT (2026-09-06). `create_base`
      // now asks the SERVER whether the create would be refused before minting
      // a token, so the stub must be able to answer. An ALLOWING answer is the
      // world this case was written in — G16's flag is the subject here, not the
      // create gate — so nothing below changes.
      dryRunKbBase: vi.fn(async () => undefined),
      createKbBase: create,
    }) as DoplClient;
    const input = { name: "Notes", visibility: "public" as const };

    const preview = await opCreateBase(client, ME, input);
    expect(create).not.toHaveBeenCalled();

    await opCreateBase(client, ME, {
      ...input,
      confirm_token: tokenIn(textOf(preview)),
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "public", acknowledgeShared: true })
    );
  });

  // 🔒 F-441, closed at integration (A3 × A11): this op used to be handed
  // neither the caller id nor the token, so it could not preview and answered a
  // shared-container publish with a refusal. It now behaves exactly as
  // `create_base` does — one mechanism for one act.
  it("op=set_visibility previews first, then sends the flag on the confirmed write", async () => {
    const update = vi.fn(async () => BASE);
    const client = stub({
      ...sharedContainer(),
      listKbBases: vi.fn(async () => [{ ...BASE, visibility: "private" as const }]),
      updateKbBase: update,
    }) as DoplClient;

    const preview = await opSetVisibility(client, ME, BASE.id, "public");
    expect(update).not.toHaveBeenCalled();

    await opSetVisibility(
      client,
      ME,
      BASE.id,
      "public",
      tokenIn(textOf(preview)),
    );
    expect(update).toHaveBeenCalledWith(
      BASE.id,
      expect.objectContaining({ visibility: "public", acknowledgeShared: true })
    );
  });

  it("op=set_visibility in a SOLO room publishes with NO flag and no preview", async () => {
    const update = vi.fn(async () => BASE);
    const client = stub({
      ...workspaceStub("standard", 1),
      listKbBases: vi.fn(async () => [{ ...BASE, visibility: "private" as const }]),
      updateKbBase: update,
    }) as DoplClient;

    await opSetVisibility(client, ME, BASE.id, "public");
    expect(update.mock.calls[0][1].acknowledgeShared).toBeUndefined();
  });

  it("🔒 op=set_visibility in a MULTI-MEMBER STANDARD workspace now previews (R-08)", async () => {
    // ⚠ **THE ROOM THIS ARM DESCRIBES USED TO BE OUT OF THE CLASS.** R-08
    // (2026-09-17) took the kind term out of "shared", so nine colleagues in a
    // standard workspace are nine people who get told before a private base
    // becomes a public one.
    const update = vi.fn(async () => BASE);
    const client = stub({
      ...workspaceStub("standard", 9),
      listKbBases: vi.fn(async () => [{ ...BASE, visibility: "private" as const }]),
      updateKbBase: update,
    }) as DoplClient;

    const preview = await opSetVisibility(client, ME, BASE.id, "public");
    expect(update).not.toHaveBeenCalled();
    await opSetVisibility(client, ME, BASE.id, "public", tokenIn(textOf(preview)));
    expect(update).toHaveBeenCalledWith(
      BASE.id,
      expect.objectContaining({ visibility: "public", acknowledgeShared: true })
    );
  });
});

// ── Every OTHER proceed sends nothing ────────────────────────────────

describe("a proceed that showed nobody anything sends NO flag", () => {
  it("a PRIVATE template — the class never fired", async () => {
    const create = vi.fn(async () => ({ ...TEMPLATE, visibility: "private" as const }));
    await opCreate(
      stub({ ...sharedContainer(), createAgentTemplate: create }) as DoplClient,
      ME,
      { name: "Researcher", visibility: "private" }
    );
    expect(create.mock.calls[0][0]).toMatchObject({ acknowledgeShared: undefined });
  });

  it("a SOLO STANDARD workspace — one member is one audience", async () => {
    // ⚠ **THIS ARM READ "a STANDARD workspace — publishing to colleagues is not
    // this class" UNTIL 2026-09-17.** R-08 deleted the kind from the question,
    // so what carries it now is the member count and nothing else; the
    // multi-member half of the old arm moved to `confirm-class.test.ts`, where
    // it asserts a preview rather than the absence of one.
    const create = vi.fn(async () => TEMPLATE);
    await opCreate(
      stub({ ...workspaceStub("standard", 1), createAgentTemplate: create }) as DoplClient,
      ME,
      { name: "Researcher", visibility: "workspace" }
    );
    expect(create.mock.calls[0][0]).toMatchObject({ acknowledgeShared: undefined });
  });

  it("a SOLO container — there is no second audience to acknowledge", async () => {
    const create = vi.fn(async () => TEMPLATE);
    await opCreate(
      stub({ ...workspaceStub("link", 1), createAgentTemplate: create }) as DoplClient,
      ME,
      { name: "Researcher", visibility: "workspace" }
    );
    // 🔒 `undefined`, NOT `false`. The server reads only an explicit `true`, and
    // the negative spelling on the wire is a claim nobody needs to interpret.
    expect(create.mock.calls[0][0].acknowledgeShared).toBeUndefined();
  });
});

// ── The create lanes never leave the landing value to the server ─────

/**
 * 🔒 **AN OMITTED `visibility` WAS AN UNESCAPABLE LOOP** (closed 2026-09-02).
 * The server's create default is CREDENTIAL-DEPENDENT — `createTemplate` /
 * `createBase` give a SHARED credential `workspace`/`public` and everyone else
 * `private` — and this process cannot see which credential it holds. So the gate
 * computed `publishes: false`, minted no token, the server resolved a SHARED
 * visibility, tripped its own G16 precondition and answered 400 — whose remedy is
 * "re-issue WITHOUT `confirm_token` to get a fresh preview", which is exactly what
 * the caller had just done. Nothing the agent could change would break the cycle.
 *
 * ⚠ THE FIX IS THE WIRE, NOT THE REMEDY STRING. Both lanes now send the default
 * their own tool description promises, so the gate's prediction and the server's
 * resolution cannot disagree at all.
 */
describe("an omitted visibility is SENT as the documented default", () => {
  it("dopl_agent op=create sends `private` rather than leaving it open", async () => {
    const create = vi.fn(async () => ({ ...TEMPLATE, visibility: "private" as const }));
    await opCreate(
      stub({ ...sharedContainer(), createAgentTemplate: create }) as DoplClient,
      ME,
      { name: "Researcher" }
    );
    expect(create.mock.calls[0][0]).toMatchObject({ visibility: "private" });
    // …and therefore no preview and no flag: the row lands where the gate said.
    expect(create.mock.calls[0][0].acknowledgeShared).toBeUndefined();
  });

  it("dopl_kb op=create_base sends `private` rather than leaving it open", async () => {
    const create = vi.fn(async () => ({ ...BASE, visibility: "private" as const }));
    await opCreateBase(
      stub({ ...sharedContainer(), createKbBase: create }) as DoplClient,
      ME,
      { name: "Notes" }
    );
    expect(create.mock.calls[0][0]).toMatchObject({ visibility: "private" });
    expect(create.mock.calls[0][0].acknowledgeShared).toBeUndefined();
  });

  it("an EXPLICIT visibility is still the caller's, on both lanes", async () => {
    const create = vi.fn(async () => TEMPLATE);
    const client = stub({
      ...workspaceStub("standard", 1),
      createAgentTemplate: create,
    }) as DoplClient;
    await opCreate(client, ME, { name: "Researcher", visibility: "workspace" });
    expect(create.mock.calls[0][0]).toMatchObject({ visibility: "workspace" });
  });
});

// ── The server's own refusal, made legible ───────────────────────────

describe("400 CONTAINER_PUBLISH_UNACKNOWLEDGED reaches the agent as a next action", () => {
  it("on a previewed op it says to preview again — this can only be a race", async () => {
    const client = stub({
      ...workspaceStub("standard", 1),
      createAgentTemplate: vi.fn(async () => {
        throw apiError(400, "CONTAINER_PUBLISH_UNACKNOWLEDGED");
      }),
    }) as DoplClient;
    const res = await opCreate(client, ME, {
      name: "Researcher",
      visibility: "workspace",
    });
    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain("Nothing was written");
    expect(text).toContain("somebody ELSE is standing in");
    expect(text).toContain("WITHOUT `confirm_token`");
  });

  it("on set_visibility it still lands legibly — a 400 AFTER a spent token is a race", async () => {
    // ⚠ **THIS ARM IS NOT DEAD CODE NOW THAT THE OP PREVIEWS (F-441).**
    // `confirmGate` fires on the shape THIS PROCESS can see — a container with
    // a peer, of any kind since R-08 — and the server's predicate is the authority over
    // facts this process cannot check. So a spent token can still meet a 400,
    // and the mapper is what keeps that answer legible rather than a raw
    // transport error. Driven through a REAL token so the gate is genuinely
    // passed and it is the server's refusal being rendered.
    const client = stub({
      ...sharedContainer(),
      listKbBases: vi.fn(async () => [{ ...BASE, visibility: "private" as const }]),
      updateKbBase: vi.fn(async () => {
        throw apiError(400, "CONTAINER_PUBLISH_UNACKNOWLEDGED");
      }),
    }) as DoplClient;
    const preview = await opSetVisibility(client, ME, BASE.id, "public");
    const res = await opSetVisibility(
      client,
      ME,
      BASE.id,
      "public",
      tokenIn(textOf(preview)),
    );
    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain("Nothing was written");
    expect(text).toContain("Ask your operator");
    expect(text).toContain("already previewed and confirmed");
  });

  it("leaves every OTHER 400 alone — the mapper is keyed on the code", async () => {
    const client = stub({
      ...workspaceStub("standard", 1),
      createAgentTemplate: vi.fn(async () => {
        throw apiError(400, "VALIDATION_FAILED");
      }),
    }) as DoplClient;
    await expect(
      opCreate(client, ME, { name: "Researcher", visibility: "workspace" })
    ).rejects.toThrow("HTTP 400");
  });
});

// ── The registrar arm, driven for real (F-441) ───────────────────────

/**
 * ⚠ **THE OP FUNCTION IS NOT THE FENCE — THE `case` IS**, and F-441 was a
 * defect of the `case` alone: `opSetVisibility` was correct and the arm handed
 * it neither the caller id nor `confirm_token`, so the preview could not fire.
 * Every assertion above calls the op DIRECTLY and would have stayed green
 * through exactly that bug, which is why this block drives the real `dopl_kb`
 * handler off the real registrar instead.
 */
function doplKb(client: DoplClient, caller: CallerIdentity): (
  args: Record<string, unknown>,
) => Promise<ToolResponse> {
  const handlers = new Map<string, unknown>();
  const capture: RegisterTool = (name, _d, _s, handler) => {
    handlers.set(name, handler);
  };
  const directory: WorkspaceDirectory = {
    getWorkspaceList: async () => [],
    resolveWorkspaceRef: async () => null,
    noWorkspaceError: async () => ({ content: [], isError: true }),
    lockedWorkspaceId: () => null,
  };
  registerKnowledgeTools(capture, client, caller, directory);
  const tool = handlers.get("dopl_kb");
  if (!tool) throw new Error("dopl_kb was not registered");
  return tool as (a: Record<string, unknown>) => Promise<ToolResponse>;
}

describe("dopl_kb(op=\"set_visibility\") — the registrar arm carries both halves", () => {
  it("previews on the first call and spends the token on the second", async () => {
    const update = vi.fn(async () => BASE);
    const client = stub({
      ...sharedContainer(),
      listKbBases: vi.fn(async () => [{ ...BASE, visibility: "private" as const }]),
      updateKbBase: update,
    }) as DoplClient;
    const kb = doplKb(client, { ...UNKNOWN_CALLER, userId: ME });

    // 🔒 THE CALLER ID: without it `confirmGate` cannot bind the token to an
    // identity, so this call would publish instead of previewing.
    const preview = await kb({ op: "set_visibility", base: BASE.id, visibility: "public" });
    expect(update).not.toHaveBeenCalled();

    // 🔒 THE TOKEN: without it the arm re-previews forever and the op is
    // unreachable through the tool it is published on.
    await kb({
      op: "set_visibility",
      base: BASE.id,
      visibility: "public",
      confirm_token: tokenIn(textOf(preview)),
    });
    expect(update).toHaveBeenCalledWith(
      BASE.id,
      expect.objectContaining({ visibility: "public", acknowledgeShared: true }),
    );
  });

  // 🔒 THE CALLER ID IS LOAD-BEARING AND ONLY TWO CALLERS CAN SHOW IT. A single
  // caller's preview and spend agree on whatever id the arm passed — including
  // `null` — so dropping it stays green on the case above. What it actually buys
  // is that one caller's preview cannot be spent by ANOTHER (`confirm-token.ts`,
  // 2026-08-28), and that is only visible with a second identity.
  it("a token minted for one caller is refused to another", async () => {
    const update = vi.fn(async () => BASE);
    const client = stub({
      ...sharedContainer(),
      listKbBases: vi.fn(async () => [{ ...BASE, visibility: "private" as const }]),
      updateKbBase: update,
    }) as DoplClient;

    const mine = doplKb(client, { ...UNKNOWN_CALLER, userId: ME });
    const theirs = doplKb(client, { ...UNKNOWN_CALLER, userId: "user-2" });

    const preview = await mine({
      op: "set_visibility",
      base: BASE.id,
      visibility: "public",
    });
    const stolen = await theirs({
      op: "set_visibility",
      base: BASE.id,
      visibility: "public",
      confirm_token: tokenIn(textOf(preview)),
    });

    expect(stolen.isError).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });
});

/**
 * 🔒 **THE DIGEST IS DETERMINISTIC, BECAUSE A TOKEN IS BOUND TO IT** (2026-09-08).
 *
 * The preview an operator was shown and the payload the proceed re-hashes must be
 * byte-equal. `knowledge_bases` has been `[...].sort()`ed for exactly this reason
 * since it existed; `knowledge` is the same rule for a shape with three fields —
 * the key is the SHAPE plus its own id, so a base and a folder of that base sort
 * apart. Without it, an agent that happened to list its scopes in a different
 * order on the second call would spend no token and loop forever, with nothing it
 * could change.
 */
describe("dopl_agent — a scope SET is order-independent under the confirm token", () => {
  const BASE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const FOLDER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const ENTRY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  it("accepts the token when the same scopes arrive in a different order", async () => {
    const create = vi.fn(async () => TEMPLATE);
    const client = stub({
      ...sharedContainer(),
      createAgentTemplate: create,
    }) as DoplClient;
    const base = { name: "Researcher", visibility: "workspace" as const };

    const preview = await opCreate(client, ME, {
      ...base,
      knowledge: [
        { base: BASE, entry: ENTRY },
        { base: BASE },
        { base: BASE, folder: FOLDER },
      ],
    });
    expect(create).not.toHaveBeenCalled();

    await opCreate(client, ME, {
      ...base,
      // ⚠ THE SAME SET, REVERSED. A set is a set; the ORDER an agent happens to
      // type it in is not part of what the operator approved.
      knowledge: [
        { base: BASE, folder: FOLDER },
        { base: BASE },
        { base: BASE, entry: ENTRY },
      ],
      confirm_token: tokenIn(textOf(preview)),
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("REFUSES the token when the scope set actually changed", async () => {
    // ⚠ The other half: sorting must not make two DIFFERENT sets hash the same.
    // A folder added after the preview is an audience change the operator never
    // saw, and the remedy is a fresh preview.
    const create = vi.fn(async () => TEMPLATE);
    const client = stub({
      ...sharedContainer(),
      createAgentTemplate: create,
    }) as DoplClient;
    const base = { name: "Researcher", visibility: "workspace" as const };

    const preview = await opCreate(client, ME, {
      ...base,
      knowledge: [{ base: BASE }],
    });
    const second = await opCreate(client, ME, {
      ...base,
      knowledge: [{ base: BASE }, { base: BASE, folder: FOLDER }],
      confirm_token: tokenIn(textOf(preview)),
    });
    expect(create).not.toHaveBeenCalled();
    expect(textOf(second)).toContain("confirm_token");
  });
});
