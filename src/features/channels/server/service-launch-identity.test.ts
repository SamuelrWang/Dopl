/**
 * THE IDENTITY REF ON A LAUNCH DIRECTIVE — the CREATE fence (2026-08-23).
 *
 * ⚠ SPLIT OUT OF `service-launch.test.ts` AT THE 500-LINE CAP, and the seam is
 * the subject rather than the size: that file drives the DIRECTIVE LIFECYCLE
 * (create gates, the claim CAS and its races, decide, lazy expiry, operator
 * scoping) and this one drives WHAT NAMING AN IDENTITY DOES. They move on
 * different clocks — the lifecycle when the mailbox does, this when agent
 * identities do.
 *
 * ⚠ THE SETUP IS RESTATED RATHER THAN SHARED, and that is vitest's shape, not a
 * choice: `vi.mock` is FILE-SCOPED, so a suite that mocks a module has to declare
 * it. What is duplicated is four mock declarations and a row fixture; what is not
 * duplicated is a single assertion.
 *
 * ── ⚠ THIS IS ONE OF TWO FENCES AND THEY BELONG TO DIFFERENT PEOPLE ────────
 *
 * Here the ORCHESTRATOR proves it can SEE the identity it names, under its own
 * credential, before any row is written. On the desktop, at spawn, the OPERATOR
 * proves the same thing under theirs (`main/launch-directives.js › spawn`, and
 * `dopl-desktop-app/test/launch-directive-identity.test.mjs`). A `team` identity
 * the first is in and the second is not passes here and is refused there, as
 * `no-identity` — fail-closed, and the designed outcome rather than a bug.
 * Neither fence substitutes for the other.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = await vi.hoisted(() => import("./service-launch-fixtures"));
vi.mock("./repository-launch", () => fx.mocks.launchRepo);
vi.mock("./repository-collab", () => fx.mocks.collab);
vi.mock("./repository-tasks", () => fx.mocks.tasks);
vi.mock("./repository-session-colors", () => fx.mocks.sessionColors);
vi.mock("./service-shared", (importOriginal) => fx.serviceSharedMock(importOriginal));
// ⚠ THE CROSS-FEATURE RESOLVER IS MOCKED AT ITS BARREL, not re-implemented. What
// this suite drives is the WIRING — that the ref goes through it under this
// caller's context, that its three answers become the three right outcomes, and
// that the PAIR of columns is written. The MATRIX itself is
// `agent-identities/server/service-resolve-ref.test.ts`'s subject, and restating
// it here would be a third copy of a predicate that is already written twice.
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
    // ⚠ BOTH COLUMNS OR THE FEATURE DOES NOT WORK. `identity_id` is ON DELETE SET
    // NULL, so without the snapshot a deleted identity is indistinguishable from
    // no identity at all and the desktop launches a blank agent wearing an
    // identity nobody notices is missing (E-4).
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
    // ⚠ The caller may name it by ID or in the wrong case; the snapshot has to be
    // the row's own name, because it is what a later deletion is read against and
    // what an operator sees on the session card.
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
    // ⚠ A launch with no identity must be byte-identical to what this lane did
    // before identities existed — no read, no round trip, no columns.
    await createLaunchDirective(ctx, { channel: "general" });
    expect(resolveIdentityRef).not.toHaveBeenCalled();
    const insert = vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0][1];
    expect(insert.identity_id).toBeNull();
    expect(insert.identity_name).toBeNull();
  });

  it("hands the resolver THIS caller's context, `apiKeyWorkspaceId` included", async () => {
    // ⚠ ARM 2 OF THE MATRIX RIDES ON THAT ONE FIELD. A credential that may be
    // shared between humans inherits nobody's personal reach — passing `null`
    // here would let such a credential resolve its owner's PRIVATE identities by
    // name. `ChannelContext` started carrying the field for this.
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

  // 🔒 F-333's OTHER HALF. The lock alone is not the answer — the resolver needs
  // the lock's KIND too, or `canSeeIdentity`'s arm 2 reads a container session
  // as a shared credential and `POST /api/channels/launch-directives` answers
  // AGENT_IDENTITY_NOT_FOUND for the operator's own private identity, which is
  // every "Use in this channel" copy.
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
    // 🔒 The mutation: forwarding `ctx.userId` instead of the subject axis would
    // hand `canSeeIdentity` a person that is not there and let a shared
    // credential name the key owner's private identities.
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
    // ⚠ THE FOURTH ANSWER, WIRED LIKE THE OTHER THREE. The classification is the
    // identity feature's — this service adds no rule of its own to it, it only
    // carries it — and the OUTCOME does not move: still a refusal, still a 404,
    // still nothing filed. What changes is that the sentence can name the place.
    vi.mocked(resolveIdentityRef).mockResolvedValue({
      kind: "elsewhere",
      identity: { name: "Code Auditor", label: "your personal shelf" },
    });
    const err = await createLaunchDirective(ctx, {
      channel: "general",
      identity: "Code Auditor",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(LaunchIdentityNotFoundError);
    expect((err as LaunchIdentityNotFoundError).elsewhere).toEqual({
      name: "Code Auditor",
      label: "your personal shelf",
    });
    expect(launchRepo.insertLaunchDirective).not.toHaveBeenCalled();
  });

  it("a plain NOT-FOUND carries NO tenancy — the two must stay one answer", async () => {
    // 🔒 `null`, not an empty object: "no such identity" and "somebody else's,
    // not yours to see" are the pair this surface refuses to distinguish, and a
    // detail key present on one and absent on the other IS the distinction.
    vi.mocked(resolveIdentityRef).mockResolvedValue({ kind: "not-found" });
    const err = await createLaunchDirective(ctx, {
      channel: "general",
      identity: "Ghost",
    }).catch((e) => e);
    expect((err as LaunchIdentityNotFoundError).elsewhere).toBeNull();
  });

  it("an AMBIGUOUS name refuses, files nothing, and carries every match", async () => {
    // ⚠ REFUSES AND LISTS, NEVER PICKS. Names are deliberately not unique, and
    // the list is what makes the refusal actionable — the caller re-issues with
    // an id it is already holding.
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
    // ⚠ THE GATE ORDER, ASSERTED. `offline` is a 200 saying "nothing was asked"
    // and is the ordinary answer for a closed laptop. Checking presence first
    // would answer a misspelt identity with "your machine is asleep": the caller
    // fixes the wrong thing, waits, and meets the real refusal a minute later.
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
    // ⚠ `toDirective` is where the signal would be lost one layer above the wire
    // narrowing that gets blamed for it: the desktop re-narrows from the CLAIM's
    // answer (the server DTO), not from the realtime frame.
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

// ── T35 — AND THE FACT REACHES THE WIRE, OR IS ABSENT FROM IT ────────────
//
// ⚠ ABSENT, NOT NULL. `HttpError.toResponseBody` omits `details` when it is
// `undefined`, and that is the shape this arm depends on: a `details` key
// present on one 404 and absent on the other must correspond to "there was
// something non-leaky to say" and nothing else. A `details: { elsewhere: null }`
// on every miss would make the KEY the signal instead of its content.
describe("the 404 body", () => {
  it("carries `details.elsewhere` when the refusal named a tenancy", async () => {
    const res = toChannelErrorResponse(
      new LaunchIdentityNotFoundError("Code Auditor", {
        name: "Code Auditor",
        label: "your personal shelf",
      })
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: {
        code: "AGENT_IDENTITY_NOT_FOUND",
        message: "Agent identity not found: Code Auditor",
        details: { elsewhere: { name: "Code Auditor", label: "your personal shelf" } },
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
