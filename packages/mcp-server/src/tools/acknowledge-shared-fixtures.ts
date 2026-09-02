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

export const ME = "user-1";

/** A workspace directory answer, as `resolveConfirmTarget` reads it. */
export function workspaceStub(kind: "standard" | "link", memberCount: number) {
  return {
    getWorkspaceId: vi.fn(() => "ws-1"),
    listWorkspaces: vi.fn(async () => ({
      workspaces: [
        { id: "ws-1", slug: "acme", name: "Acme", kind, role: "owner", memberCount },
      ],
    })),
  };
}

/** A `kind='link'` container with a PEER in it — the only room the class fires in. */
export const sharedContainer = () => workspaceStub("link", 2);

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
