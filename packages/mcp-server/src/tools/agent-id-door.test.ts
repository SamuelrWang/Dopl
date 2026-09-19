/**
 * 🔒 **THE ID DOOR ON `dopl_agent` — THE PORT OF F-470 (2026-09-18).**
 *
 * `listAgentTemplates` answers for the container this call is in PLUS the
 * caller's own personal one, so matching a ref against that list made `get` and
 * `update` CONTAINER-KEYED — the two ops whose entire argument is an id. A
 * template in another home channel the caller belongs to answered "no such
 * template" for an id `GET /api/agent-templates/{id}` resolves, which is the
 * wave's headline claim ("an id resolves its own container") being untrue here.
 *
 * ⚠ **ITS OWN FILE BECAUSE `agent-ops.test.ts` IS AT §1's 500-LINE CAP**, and the
 * split is by QUESTION, the same seam that seeded `agent-fences.test.ts`: the
 * happy paths and the three-answer rule are there, the SECOND lookup is here.
 *
 * ⚠ The door is the SERVER's, so it adds no reach — `canSeeTemplate` runs in the
 * container the id names — and only a 404 is swallowed.
 */

import { describe, it, expect, vi } from "vitest";
import type { AgentTemplate, DoplClient } from "@dopl/client";

import { opGet } from "./agent-ops-read";
import { stub } from "./narration-fixtures";

const ME = "user-1";

function template(over: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    workspaceId: "ws-1",
    name: "Researcher",
    description: null,
    instructions: "You research.",
    model: null,
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [],
    createdBy: ME,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const textOf = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("\n");

describe("resolveTemplateRef — the id door", () => {
  it("🔒 THE ID DOOR — an id the visible list does not carry still resolves (F-470's port)", async () => {
    // ⚠ **THIS IS THE WHOLE BUG.** `listAgentTemplates` answers for the container
    // this call is in plus the caller's own personal one, so `get`/`update` were
    // container-keyed — for the two ops whose entire argument is an id. A
    // template in another home channel the caller belongs to answered "no such
    // template" for an id `GET /api/agent-templates/{id}` resolves.
    const elsewhere = template({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Auditor" });
    const text = textOf(
      await opGet(
        stub({
          listAgentTemplates: vi.fn(async () => []),
          getAgentTemplate: vi.fn(async () => elsewhere),
        }) as DoplClient,
        elsewhere.id,
        ME,
      ),
    );
    expect(text).toContain("# `Auditor`");
  });

  it("🔒 THE ID DOOR SWALLOWS ONLY A 404 — an outage is not a deletion", async () => {
    // ⚠ A transport failure read as "no such template" is how an outage becomes
    // a deletion in an agent's notes (`knowledge-shared.ts › resolveBaseRef`'s
    // own rule, ported with the door).
    await expect(
      opGet(
        stub({
          listAgentTemplates: vi.fn(async () => []),
          getAgentTemplate: vi.fn(async () => {
            throw Object.assign(new Error("HTTP 503"), { status: 503 });
          }),
        }) as DoplClient,
        "99999999-9999-4999-8999-999999999999",
        ME,
      ),
    ).rejects.toThrow("HTTP 503");
  });
});
