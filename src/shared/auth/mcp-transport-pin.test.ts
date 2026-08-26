/**
 * 🔒 THE MCP TRANSPORT'S WORKSPACE PRECEDENCE — a one-line fence, driven for
 * real, because the line was BACKWARDS for as long as the field it reads had no
 * producer.
 *
 * `src/app/api/mcp/route.ts` read `headerPin ?? apiKeyWorkspaceId`. Correct
 * while `apiKeyWorkspaceId` was dead scaffolding; a hole the moment layer B1
 * gave it one, because it let a client-supplied `X-Workspace-Id` outrank the
 * credential's own container lock — deciding both the workspace directory and
 * B3's `lockedTo`.
 *
 * ⚠ MUTATION-VERIFIED: swapping the two operands back in
 * `resolveTransportWorkspaceId` turns the first two assertions red. Count in
 * this milestone's report.
 */

import { describe, it, expect } from "vitest";
import { resolveTransportWorkspaceId } from "./mcp-transport-pin";

const LOCK = "11111111-1111-4111-8111-111111111111";
const HEADER = "22222222-2222-4222-8222-222222222222";

describe("resolveTransportWorkspaceId", () => {
  it("🔒 the CREDENTIAL LOCK wins over a contradicting header", () => {
    expect(resolveTransportWorkspaceId(LOCK, HEADER)).toBe(LOCK);
  });

  it("🔒 …and wins over an AGREEING header too, so the answer never depends on the header", () => {
    expect(resolveTransportWorkspaceId(LOCK, LOCK)).toBe(LOCK);
    expect(resolveTransportWorkspaceId(LOCK, null)).toBe(LOCK);
  });

  it("the header is used when there is NO lock — the unlocked path is unchanged", () => {
    expect(resolveTransportWorkspaceId(null, HEADER)).toBe(HEADER);
    expect(resolveTransportWorkspaceId(undefined, HEADER)).toBe(HEADER);
  });

  it("no lock and no header ⇒ undefined, so boot resolves via the membership directory", () => {
    expect(resolveTransportWorkspaceId(null, null)).toBeUndefined();
    expect(resolveTransportWorkspaceId(undefined, undefined)).toBeUndefined();
  });

  it("BLANK is not a pin, on either input", () => {
    // A present-but-empty header must not be forwarded — it 400s every loopback.
    expect(resolveTransportWorkspaceId(null, "   ")).toBeUndefined();
    // A blank lock falls through to the header rather than pinning on "".
    expect(resolveTransportWorkspaceId("  ", HEADER)).toBe(HEADER);
  });

  it("both inputs are TRIMMED, matching with-workspace-auth's own compare", () => {
    expect(resolveTransportWorkspaceId(` ${LOCK} `, null)).toBe(LOCK);
    expect(resolveTransportWorkspaceId(null, ` ${HEADER} `)).toBe(HEADER);
  });
});
