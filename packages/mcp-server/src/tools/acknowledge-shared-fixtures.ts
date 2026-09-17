/**
 * SHARED FIXTURES for the G16 / A11 confirm-and-acknowledge suites.
 *
 * ⚠ **ITS OWN FILE BECAUSE THERE ARE TWO SUITES NOW** (2026-09-02) — the
 * knowledge/agent one and the skills one, split at the §1 500-line cap. A copy of
 * `sharedContainer` in each is two definitions of "the only room this class fires
 * in", and the day they drift one suite is measuring a predicate the server does
 * not run.
 */

import { expect, vi } from "vitest";
import type { KnowledgeBase } from "@dopl/client";

export const ME = "user-1";

/**
 * A workspace directory answer, as `resolveConfirmTarget` reads it.
 *
 * ⚠ **`memberCount` IS THE WHOLE ANSWER SINCE 2026-09-17** (Samuel's ruling
 * R-08; F-513) — `kind` is still spelled because the DIRECTORY renders it, not
 * because the confirm class asks it. `undefined` is admitted so a suite can
 * drive the fail-closed arm without hand-rolling a second stub.
 */
export function workspaceStub(
  kind: "standard" | "link",
  memberCount: number | undefined,
) {
  return {
    getWorkspaceId: vi.fn(() => "ws-1"),
    listWorkspaces: vi.fn(async () => ({
      workspaces: [
        { id: "ws-1", slug: "acme", name: "Acme", kind, role: "owner", memberCount },
      ],
    })),
  };
}

/** A container with a PEER in it. ⚠ A multi-member STANDARD workspace is just
 *  as shared since R-08 — the kind here is incidental. */
export const sharedContainer = () => workspaceStub("link", 2);

/** The one shape the class never fires in: a room with exactly one member. */
export const soloRoom = () => workspaceStub("standard", 1);

/**
 * The two rows the confirm suites write. ⚠ **ONE DEFINITION EACH, FOR THE
 * REASON `sharedContainer` HAS ONE** — `acknowledge-shared.test.ts` and
 * `confirm-class.test.ts` each carried a byte-identical copy of `TEMPLATE` and a
 * near-identical `BASE`, which is two definitions of the row whose AUDIENCE is
 * the subject of both files. Moved here 2026-09-17 when R-08's arms met the
 * §1 cap in both.
 */
export const TEMPLATE = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: "ws-1",
  name: "Researcher",
  description: null,
  instructions: null,
  model: null,
  fields: [],
  visibility: "workspace" as const,
  teamIds: [],
  knowledgeBases: [],
  createdBy: ME,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

/** ⚠ The VISIBILITY is the parameter: it is the axis both suites vary. */
export const base = (visibility: "public" | "private"): KnowledgeBase => ({
  id: "kb-1",
  workspaceId: "ws-1",
  name: "Notes",
  slug: "notes",
  publicId: "pub-1",
  description: null,
  agentWriteEnabled: true,
  visibility,
  accessMode: "workspace",
  createdBy: ME,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
});

export const textOf = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("\n");

/** A `DoplApiError`-shaped rejection, duck-typed the way the tools read it. */
export function apiError(status: number, code: string): Error {
  return Object.assign(new Error(`HTTP ${status}`), {
    name: "DoplApiError",
    status,
    code,
  });
}

/** The one-time token out of a preview, or a failed expectation naming the text. */
export function tokenIn(text: string): string {
  const m = /confirm_token="([^"]+)"/.exec(text);
  expect(m, `no confirm_token in:\n${text}`).not.toBeNull();
  return m![1];
}
