/**
 * `dopl_agent op="update"` — THE OPTIMISTIC-CONCURRENCY CONTRACT (F-739,
 * 2026-09-18).
 *
 * ⚠ **THE SURFACE'S HALF IS THE VOCABULARY, NOT THE ATOMICITY.** Postgres does
 * the compare-and-swap (`src/features/agent-templates/server/repository.ts`);
 * what these cases pin is that an agent can LEARN the contract from what comes
 * back — a Version on the read, the same Version on the success, and ONE
 * `reason=version_conflict` refusal naming `op="get"` whichever of the two 412s
 * it was.
 *
 * ⚠ A SEPARATE FILE FROM `agent-ops.test.ts`, which is at the 500-line cap and
 * is about happy paths and ref resolution — the split this tree has used for
 * this family since `agent-fences.test.ts` (2026-08-28).
 */

import { describe, it, expect, vi } from "vitest";
import type { AgentTemplate, DoplClient } from "@dopl/client";

import { opGet } from "./agent-ops-read";
import { opUpdate } from "./agent-ops-write";
import { stub } from "./narration-fixtures";
import { __resetConfirmTokensForTest } from "./confirm-token";

const ME = "user-1";
const ID = "11111111-1111-4111-8111-111111111111";
const VERSION = "2026-01-01T00:00:00Z";

function template(over: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: ID,
    workspaceId: "ws-1",
    name: "Researcher",
    description: "Digs things up.",
    instructions: "You research.",
    model: null,
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [],
    createdBy: ME,
    createdAt: VERSION,
    updatedAt: VERSION,
    ...over,
  };
}

const textOf = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("\n");

/** A solo standard workspace — nothing here is in the confirm class. */
function solo(over: Record<string, unknown> = {}) {
  return {
    getWorkspaceId: vi.fn(() => "ws-1"),
    listWorkspaces: vi.fn(async () => ({
      workspaces: [
        { id: "ws-1", slug: "acme", name: "Acme", kind: "standard", role: "owner", memberCount: 1 },
      ],
    })),
    ...over,
  };
}

/** The shape `DoplApiError` presents to `respond.ts`'s duck-typed helpers. */
function apiError(status: number, code: string) {
  return Object.assign(new Error(code), { status, code });
}

describe("the Version an agent needs is handed over, never hunted for", () => {
  it('op="get" prints it, ABOVE the instructions block that can be clipped', async () => {
    const text = textOf(
      await opGet(
        stub({ listAgentTemplates: vi.fn(async () => [template()]) }) as DoplClient,
        "Researcher",
        ME,
      ),
    );
    expect(text).toContain(`Version: \`${VERSION}\``);
    expect(text).toContain('pass as expected_version to op="update"');
    // ⚠ ABOVE `## Instructions`: `max_chars` clips the body, and a token printed
    // after a clipped system prompt is a token the caller may never see.
    expect(text.indexOf("Version:")).toBeLessThan(text.indexOf("## Instructions"));
  });

  it('op="update" answers with the NEW version, so a second edit needs no round trip', async () => {
    __resetConfirmTokensForTest();
    const next = "2026-01-02T00:00:00Z";
    const client = stub({
      ...solo(),
      listAgentTemplates: vi.fn(async () => [template()]),
      updateAgentTemplate: vi.fn(async () => template({ updatedAt: next })),
    }) as DoplClient;

    const text = textOf(
      await opUpdate(client, ME, "Researcher", { name: "Renamed", expected_version: VERSION }),
    );
    expect(text).toContain(`Version: \`${next}\``);
  });
});

describe("the refusal is ONE string for BOTH 412s", () => {
  /** Every arm asserts the same three things, so they are said once. */
  async function refusalFor(thrown: unknown, input: Record<string, unknown>) {
    __resetConfirmTokensForTest();
    const client = stub({
      ...solo(),
      listAgentTemplates: vi.fn(async () => [template()]),
      updateAgentTemplate: vi.fn(async () => {
        throw thrown;
      }),
    }) as DoplClient;
    const res = await opUpdate(client, ME, "Researcher", { name: "Renamed", ...input });
    return { isError: res.isError, text: textOf(res) };
  }

  it("the SERVER's stale-version 412 becomes reason=version_conflict, retry=op=\"get\"", async () => {
    const { isError, text } = await refusalFor(
      apiError(412, "AGENT_TEMPLATE_STALE_VERSION"),
      { expected_version: VERSION },
    );
    expect(isError).toBe(true);
    expect(text).toContain("reason=version_conflict");
    expect(text).toContain('retry=op="get"');
    expect(text).toContain("Nothing was written");
    expect(text).toContain("force=true");
  });

  it("the SDK's omitted-version 412 becomes the SAME refusal, not a second vocabulary", async () => {
    const { isError, text } = await refusalFor(
      apiError(412, "EXPECTED_VERSION_REQUIRED"),
      {},
    );
    expect(isError).toBe(true);
    expect(text).toContain("reason=version_conflict");
    expect(text).toContain('retry=op="get"');
  });

  it("names the template it did NOT write, so the agent knows which call died", async () => {
    const { text } = await refusalFor(apiError(412, "AGENT_TEMPLATE_STALE_VERSION"), {
      expected_version: VERSION,
    });
    expect(text).toContain("Researcher");
    expect(text).toContain(ID);
  });
});

describe("`force` is the escape, and it is the client's `null` arm", () => {
  it("sends null rather than the version, so no precondition rides the write", async () => {
    __resetConfirmTokensForTest();
    const update = vi.fn(async () => template());
    const client = stub({
      ...solo(),
      listAgentTemplates: vi.fn(async () => [template()]),
      updateAgentTemplate: update,
    }) as DoplClient;

    await opUpdate(client, ME, "Researcher", {
      name: "Renamed",
      expected_version: VERSION,
      force: true,
    });
    // ⚠ `null`, NOT the version it was also given: `force` WINS, exactly as
    // `knowledge-ops-write.ts › opWriteFile` resolves the same pair.
    expect(update).toHaveBeenCalledWith(ID, expect.anything(), null);
  });

  it("STALE PAYLOAD: neither argument passed sends `undefined` — the arm the SDK refuses", async () => {
    __resetConfirmTokensForTest();
    const update = vi.fn(async () => template());
    const client = stub({
      ...solo(),
      listAgentTemplates: vi.fn(async () => [template()]),
      updateAgentTemplate: update,
    }) as DoplClient;

    await opUpdate(client, ME, "Researcher", { name: "Renamed" });
    expect(update).toHaveBeenCalledWith(ID, expect.anything(), undefined);
  });
});
