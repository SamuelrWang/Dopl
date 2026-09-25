/**
 * The identity ref on a launch directive — the create fence. The orchestrator proves here, under its
 * own credential, that it can see the identity; the operator proves it again at spawn
 * (`main/launch-directive-spawn.js › spawn`), so an identity only the first can see is refused
 * `no-identity` there. Neither fence substitutes for the other.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = await vi.hoisted(() => import("./service-launch-fixtures"));
vi.mock("./repository-launch", () => fx.mocks.launchRepo);
vi.mock("./repository-collab", () => fx.mocks.collab);
vi.mock("./repository-tasks", () => fx.mocks.tasks);
vi.mock("./repository-session-colors", () => fx.mocks.sessionColors);
vi.mock("./service-shared", (importOriginal) => fx.serviceSharedMock(importOriginal));
// The resolver is mocked at its barrel: this suite drives the wiring; the visibility matrix is
// `agent-identities/server/service-resolve-ref.test.ts`'s.
vi.mock("@/features/agent-identities/server/service", () => fx.mocks.identities);

import * as launchRepo from "./repository-launch";
import * as collab from "./repository-collab";
import { resolveIdentityRef } from "@/features/agent-identities/server/service";
import { loadVisibleChannel } from "./service-shared";
import {
  LaunchDirectiveNotFoundError,
  LaunchIdentityAmbiguousError,
  LaunchIdentityNotFoundError,
} from "./errors";
import { createLaunchDirective, getLaunchDirective } from "./service-launch";
import { toChannelErrorResponse } from "./http-mapping";
import { CHANNEL_ROW, DIR, ME, WS, ctx, row, wireLaunchDefaults } from "./service-launch-fixtures";

beforeEach(wireLaunchDefaults);

describe("the identity ref — resolved under the CALLER's visibility, before any row", () => {
  const T1 = "77777777-7777-7777-7777-777777777777";
  const T2 = "88888888-8888-8888-8888-888888888888";

  it("stores the RESOLVED id and a NAME SNAPSHOT — the pair, never one", async () => {
    // `identity_id` is ON DELETE SET NULL; without the name snapshot a deleted identity reads as none.
    vi.mocked(resolveIdentityRef).mockResolvedValue({
      kind: "found",
      id: T1,
      name: "Code Auditor",
    });
    await createLaunchDirective(ctx, { channel: "general", identity: "Code Auditor" });
    const insert = vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0][1];
    expect(insert.identity_id).toBe(T1);
    expect(insert.identity_name).toBe("Code Auditor");
  });

  it("stores the resolved NAME, not the ref the caller typed", async () => {
    // The snapshot is the row's own name — what a later deletion is read against and the card shows.
    vi.mocked(resolveIdentityRef).mockResolvedValue({
      kind: "found",
      id: T1,
      name: "Code Auditor",
    });
    await createLaunchDirective(ctx, { channel: "general", identity: "code auditor" });
    expect(
      vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0][1].identity_name
    ).toBe("Code Auditor");
  });

  it("NO identity named → both columns are NULL, and the resolver is never called", async () => {
    // No identity: no read, no round trip, no columns.
    await createLaunchDirective(ctx, { channel: "general" });
    expect(resolveIdentityRef).not.toHaveBeenCalled();
    const insert = vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0][1];
    expect(insert.identity_id).toBeNull();
    expect(insert.identity_name).toBeNull();
  });

  it("hands the resolver THIS caller's context, `apiKeyWorkspaceId` included", async () => {
    // Arm 2 of the matrix: a possibly shared credential must not resolve its owner's private identities.
    vi.mocked(resolveIdentityRef).mockResolvedValue({ kind: "found", id: T1, name: "X" });
    await createLaunchDirective(
      { ...ctx, apiKeyWorkspaceId: WS },
      { channel: "general", identity: "X" }
    );
    const [identityCtx, ref] = vi.mocked(resolveIdentityRef).mock.calls[0];
    expect(identityCtx).toMatchObject({
      workspaceId: WS,
      userId: ME,
      apiKeyWorkspaceId: WS,
    });
    expect(ref).toBe("X");
  });

  // Without the lock's kind, arm 2 reads a container session as a shared credential and 404s the
  // operator's own private identity (F-333).
  it("carries BOTH axes to the resolver, or a container session cannot name its own identity", async () => {
    vi.mocked(resolveIdentityRef).mockResolvedValue({ kind: "found", id: T1, name: "X" });
    await createLaunchDirective(
      { ...ctx, apiKeyWorkspaceId: WS, credentialSubjectUserId: ctx.userId },
      { channel: "general", identity: "X" }
    );
    const [identityCtx] = vi.mocked(resolveIdentityRef).mock.calls[0];
    expect(identityCtx).toMatchObject({
      apiKeyWorkspaceId: WS,
      credentialSubjectUserId: ctx.userId,
    });
  });

  it("carries a SHARED credential's absent subject through unchanged", async () => {
    // Forwarding `ctx.userId` instead would let a shared credential name the key owner's private identities.
    vi.mocked(resolveIdentityRef).mockResolvedValue({ kind: "found", id: T1, name: "X" });
    await createLaunchDirective(
      { ...ctx, apiKeyWorkspaceId: WS, credentialSubjectUserId: null },
      { channel: "general", identity: "X" }
    );
    const [identityCtx] = vi.mocked(resolveIdentityRef).mock.calls[0];
    expect(identityCtx).toMatchObject({ credentialSubjectUserId: null });
  });

  it("an UNRESOLVABLE ref refuses and files NOTHING", async () => {
    vi.mocked(resolveIdentityRef).mockResolvedValue({ kind: "not-found" });
    await expect(
      createLaunchDirective(ctx, { channel: "general", identity: "Ghost" })
    ).rejects.toBeInstanceOf(LaunchIdentityNotFoundError);
    expect(launchRepo.insertLaunchDirective).not.toHaveBeenCalled();
  });

  it("an `elsewhere` ref refuses with the TENANCY attached, and still files nothing", async () => {
    // The classification is the identity feature's; the outcome is unchanged (404, nothing filed).
    vi.mocked(resolveIdentityRef).mockResolvedValue({
      kind: "elsewhere",
      identity: { name: "Code Auditor", label: "your home shelf" },
    });
    const err = await createLaunchDirective(ctx, {
      channel: "general",
      identity: "Code Auditor",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(LaunchIdentityNotFoundError);
    expect((err as LaunchIdentityNotFoundError).elsewhere).toEqual({
      name: "Code Auditor",
      label: "your home shelf",
    });
    expect(launchRepo.insertLaunchDirective).not.toHaveBeenCalled();
  });

  it("a plain NOT-FOUND carries NO tenancy — the two must stay one answer", async () => {
    // `null`, not `{}`: "no such identity" and "not yours to see" must stay one answer.
    vi.mocked(resolveIdentityRef).mockResolvedValue({ kind: "not-found" });
    const err = await createLaunchDirective(ctx, {
      channel: "general",
      identity: "Ghost",
    }).catch((e) => e);
    expect((err as LaunchIdentityNotFoundError).elsewhere).toBeNull();
  });

  it("an AMBIGUOUS name refuses, files nothing, and carries every match", async () => {
    // Names are not unique; the list lets the caller re-issue by id.
    vi.mocked(resolveIdentityRef).mockResolvedValue({
      kind: "ambiguous",
      matches: [
        { id: T1, name: "Researcher", visibility: "private" },
        { id: T2, name: "Researcher", visibility: "workspace" },
      ],
    });
    const err = await createLaunchDirective(ctx, {
      channel: "general",
      identity: "Researcher",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(LaunchIdentityAmbiguousError);
    expect((err as LaunchIdentityAmbiguousError).matches).toEqual([
      { id: T1, name: "Researcher", visibility: "private" },
      { id: T2, name: "Researcher", visibility: "workspace" },
    ]);
    expect(launchRepo.insertLaunchDirective).not.toHaveBeenCalled();
  });

  it("a BAD IDENTITY REF beats PRESENCE — an offline machine does not hide the caller's own error", async () => {
    // Presence first would answer a misspelt identity with "your machine is asleep".
    vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map() as never);
    vi.mocked(resolveIdentityRef).mockResolvedValue({ kind: "not-found" });
    await expect(
      createLaunchDirective(ctx, { channel: "general", identity: "Ghost" })
    ).rejects.toBeInstanceOf(LaunchIdentityNotFoundError);
  });

  it("the CHANNEL and THREAD gates still come first — a bad channel is never an identity error", async () => {
    vi.mocked(loadVisibleChannel).mockResolvedValue({
      channel: { ...CHANNEL_ROW, visibility: "public" },
      membership: null,
    } as never);
    await expect(
      createLaunchDirective(ctx, { channel: "general", identity: "Code Auditor" })
    ).rejects.toBeInstanceOf(LaunchDirectiveNotFoundError);
    expect(resolveIdentityRef).not.toHaveBeenCalled();
  });

  it("the DTO carries both halves out again — the desktop reads them from the CLAIM", async () => {
    // The desktop reads the identity from the claim's DTO, not the realtime frame.
    vi.mocked(launchRepo.findLaunchDirective).mockResolvedValue(
      row({ identity_id: T1, identity_name: "Code Auditor" })
    );
    const out = await getLaunchDirective(ctx, DIR);
    expect(out.identityId).toBe(T1);
    expect(out.identityName).toBe("Code Auditor");
  });

  it("on the DTO: a NULLED id beside a live name survives the mapping", async () => {
    vi.mocked(launchRepo.findLaunchDirective).mockResolvedValue(
      row({ identity_id: null, identity_name: "Code Auditor" })
    );
    const out = await getLaunchDirective(ctx, DIR);
    expect(out.identityId).toBeNull();
    expect(out.identityName).toBe("Code Auditor");
  });
});

// `toResponseBody` omits an undefined `details`, so the key is present only when there is a tenancy to name.
describe("the 404 body", () => {
  it("carries `details.elsewhere` when the refusal named a tenancy", async () => {
    const res = toChannelErrorResponse(
      new LaunchIdentityNotFoundError("Code Auditor", {
        name: "Code Auditor",
        label: "your home shelf",
      })
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: {
        code: "AGENT_IDENTITY_NOT_FOUND",
        message: "Agent identity not found: Code Auditor",
        details: { elsewhere: { name: "Code Auditor", label: "your home shelf" } },
      },
    });
  });

  it("has NO `details` key at all for an ordinary miss", async () => {
    const res = toChannelErrorResponse(new LaunchIdentityNotFoundError("Ghost"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("AGENT_IDENTITY_NOT_FOUND");
    expect(body.error).not.toHaveProperty("details");
  });
});
