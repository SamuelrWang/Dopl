/**
 * 🔒 **A TENANCY MISMATCH THAT REACHES A RESPONSE IS A SERVER BUG, AND SAYS SO**
 * (2026-09-03, F-664).
 *
 * ⚠ `KnowledgeBaseMismatchError` is TWO events wearing one name. On the id lane
 * it is control flow — `service-bases.ts › loadVisibleBase` catches it to mean
 * "not in this container, follow the id" — and never reaches a mapper. What is
 * left is a child row stranded on a tenancy its parent no longer has, which is
 * the state `20260924120000_personal_container_child_rows.sql` repairs. It used
 * to answer 400 with a sentence that named neither the row nor either
 * workspace, so the incident was undiagnosable from logs and sat in nobody's
 * error budget.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { KnowledgeBaseMismatchError } from "./errors";
import { mapKnowledgeError } from "./http-mapping";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("KNOWLEDGE_BASE_MISMATCH", () => {
  const err = () =>
    new KnowledgeBaseMismatchError(
      "entry belongs to a different workspace",
      "ws-old",
      "ws-personal",
      "entry e1"
    );

  it("is a 500 — the caller did nothing wrong", () => {
    // ⚠ MUTATION CHECK. At 400 an operator reads "malformed request" for a row
    // the server itself left in an impossible state.
    const mapped = mapKnowledgeError(err());
    expect(mapped?.status).toBe(500);
    expect(mapped?.code).toBe("KNOWLEDGE_BASE_MISMATCH");
  });

  it("🔒 logs BOTH tenancies and the subject, and puts neither in the body", () => {
    // ⚠ MUTATION CHECK, both directions. Without the log the class of defect is
    // invisible; with the ids in the body, a refusal names a workspace the
    // caller cannot see, which is an oracle.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mapped = mapKnowledgeError(err());
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("tenancy mismatch"),
      {
        subject: "entry e1",
        rowWorkspaceId: "ws-old",
        contextWorkspaceId: "ws-personal",
      }
    );
    const body = JSON.stringify(mapped?.toResponseBody());
    expect(body).not.toContain("ws-old");
    expect(body).not.toContain("ws-personal");
  });
});
