/**
 * 🔒 THE M-10 PREDICATE, PINNED BOTH WAYS (v2 wave B slice B3, F-336/F-333).
 *
 * `isSharedCredential` used to be THREE ARMS over a PAIR of fields — one of
 * which was the container fence — and the whole defect it was written to repair
 * was a container fence read as an audience. It is now one null check on an axis
 * the row states, so what this file has to prove is small and total:
 *
 *   1. the subject axis decides, in both directions;
 *   2. the container axis decides NOTHING here, in either position;
 *   3. an unstated subject is SHARED — the fail-closed direction, and the one a
 *      future producer inherits by forgetting rather than by opting in.
 *
 * ⚠ (2) IS THE MUTATION TEST. Every case is stated at BOTH container values, so
 * a predicate that starts consulting the container fence again fails here rather
 * than in whichever feature suite happens to notice first.
 */

import { describe, it, expect } from "vitest";
import {
  isSharedCredential,
  type CredentialAxes,
} from "./credential-audience";

const OPERATOR = "u-operator";
const CONTAINER = "ws-container";

/** Both axes, stated. The only constructor this file uses. */
function axes(
  credentialSubjectUserId: string | null,
  apiKeyWorkspaceId: string | null,
): CredentialAxes & { apiKeyWorkspaceId: string | null } {
  return { credentialSubjectUserId, apiKeyWorkspaceId };
}

describe("isSharedCredential — the SUBJECT axis, and only it", () => {
  it("a credential with a subject is NOT shared, fenced or not", () => {
    expect(isSharedCredential(axes(OPERATOR, CONTAINER))).toBe(false);
    expect(isSharedCredential(axes(OPERATOR, null))).toBe(false);
  });

  it("a credential with NO subject IS shared, fenced or not", () => {
    expect(isSharedCredential(axes(null, CONTAINER))).toBe(true);
    expect(isSharedCredential(axes(null, null))).toBe(true);
  });

  it("🔒 the container axis moves nothing — the F-336 mutation, stated directly", () => {
    // The pre-2026-08-27 predicate was `if (apiKeyWorkspaceId) return false`
    // inverted into the gates; any return of it flips the first pair.
    expect(isSharedCredential(axes(OPERATOR, CONTAINER))).toBe(
      isSharedCredential(axes(OPERATOR, null)),
    );
    expect(isSharedCredential(axes(null, CONTAINER))).toBe(
      isSharedCredential(axes(null, null)),
    );
  });

  it("🔒 an ABSENT subject reads as shared — fail-closed at the untyped edge", () => {
    // The field is REQUIRED in TypeScript, so this can only arrive from a
    // hand-built fixture or an untyped boundary. Both must land on the
    // restrictive answer rather than on "there is a person here".
    expect(isSharedCredential({} as CredentialAxes)).toBe(true);
    expect(
      isSharedCredential({ credentialSubjectUserId: undefined } as unknown as CredentialAxes),
    ).toBe(true);
    expect(isSharedCredential({ credentialSubjectUserId: "" })).toBe(true);
  });
});
