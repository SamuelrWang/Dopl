/**
 * THE TEMPLATE REF ON A LAUNCH DIRECTIVE — the CREATE fence (2026-08-23).
 *
 * ⚠ SPLIT OUT OF `service-launch.test.ts` AT THE 500-LINE CAP, and the seam is
 * the subject rather than the size: that file drives the DIRECTIVE LIFECYCLE
 * (create gates, the claim CAS and its races, decide, lazy expiry, operator
 * scoping) and this one drives WHAT NAMING A TEMPLATE DOES. They move on
 * different clocks — the lifecycle when the mailbox does, this when agent
 * templates do.
 *
 * ⚠ THE SETUP IS RESTATED RATHER THAN SHARED, and that is vitest's shape, not a
 * choice: `vi.mock` is FILE-SCOPED, so a suite that mocks a module has to declare
 * it. What is duplicated is four mock declarations and a row fixture; what is not
 * duplicated is a single assertion.
 *
 * ── ⚠ THIS IS ONE OF TWO FENCES AND THEY BELONG TO DIFFERENT PEOPLE ────────
 *
 * Here the ORCHESTRATOR proves it can SEE the template it names, under its own
 * credential, before any row is written. On the desktop, at spawn, the OPERATOR
 * proves the same thing under theirs (`main/launch-directives.js › spawn`, and
 * `dopl-desktop-app/test/launch-directive-template.test.mjs`). A `team` template
 * the first is in and the second is not passes here and is refused there, as
 * `no-template` — fail-closed, and the designed outcome rather than a bug.
 * Neither fence substitutes for the other.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository-launch", () => ({
  insertLaunchDirective: vi.fn(),
  findLaunchDirective: vi.fn(),
  claimLaunchDirective: vi.fn(),
  decideLaunchDirective: vi.fn(),
}));
vi.mock("./repository-collab", () => ({ presenceForWorkspace: vi.fn() }));
vi.mock("./repository-tasks", () => ({ findTaskByChannelAndId: vi.fn() }));
vi.mock("./service-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service-shared")>();
  return { ...actual, loadVisibleChannel: vi.fn() };
});
// ⚠ THE CROSS-FEATURE RESOLVER IS MOCKED AT ITS BARREL, not re-implemented. What
// this suite drives is the WIRING — that the ref goes through it under this
// caller's context, that its three answers become the three right outcomes, and
// that the PAIR of columns is written. The MATRIX itself is
// `agent-templates/server/service-resolve-ref.test.ts`'s subject, and restating
// it here would be a third copy of a predicate that is already written twice.
vi.mock("@/features/agent-templates/server/service", () => ({
  resolveTemplateRef: vi.fn(),
}));

import * as launchRepo from "./repository-launch";
import * as collab from "./repository-collab";
import { resolveTemplateRef } from "@/features/agent-templates/server/service";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";
import {
  LaunchDirectiveNotFoundError,
  LaunchTemplateAmbiguousError,
  LaunchTemplateNotFoundError,
} from "./errors";
import { createLaunchDirective, getLaunchDirective } from "./service-launch";
import { LAUNCH_DIRECTIVE_TTL_MS } from "../constants";

const WS = "22222222-2222-2222-2222-222222222222";
const ME = "33333333-3333-3333-3333-333333333333";
const CHAN = "11111111-1111-1111-1111-111111111111";
const DIR = "55555555-5555-5555-5555-555555555555";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: ME,
  source: "agent",
  role: "member",
};

const CHANNEL_ROW = { id: CHAN, slug: "general", name: "General", visibility: "private" };
const MEMBERSHIP = { channel_id: CHAN, user_id: ME, role: "member" };

function row(over: Record<string, unknown> = {}) {
  return {
    id: DIR,
    workspace_id: WS,
    channel_id: CHAN,
    task_id: null,
    operator_user_id: ME,
    goal: "ship the parser",
    model: null,
    template_id: null,
    template_name: null,
    status: "pending",
    refusal_reason: null,
    agent_id: null,
    claimed_at: null,
    decided_at: null,
    expires_at: new Date(Date.now() + LAUNCH_DIRECTIVE_TTL_MS).toISOString(),
    created_at: new Date().toISOString(),
    ...over,
  } as never;
}

function online() {
  vi.mocked(collab.presenceForWorkspace).mockResolvedValue(
    new Map([[ME, { online: true, lastSeenAt: new Date().toISOString() }]]) as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadVisibleChannel).mockResolvedValue({
    channel: CHANNEL_ROW,
    membership: MEMBERSHIP,
  } as never);
  vi.mocked(launchRepo.insertLaunchDirective).mockResolvedValue(row());
});

describe("the template ref — resolved under the CALLER's visibility, before any row", () => {
  const T1 = "77777777-7777-7777-7777-777777777777";
  const T2 = "88888888-8888-8888-8888-888888888888";

  it("stores the RESOLVED id and a NAME SNAPSHOT — the pair, never one", async () => {
    // ⚠ BOTH COLUMNS OR THE FEATURE DOES NOT WORK. `template_id` is ON DELETE SET
    // NULL, so without the snapshot a deleted template is indistinguishable from
    // no template at all and the desktop launches a blank agent wearing an
    // identity nobody notices is missing (E-4).
    online();
    vi.mocked(resolveTemplateRef).mockResolvedValue({
      kind: "found",
      id: T1,
      name: "Code Auditor",
    });
    await createLaunchDirective(ctx, { channel: "general", template: "Code Auditor" });
    const insert = vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0][1];
    expect(insert.template_id).toBe(T1);
    expect(insert.template_name).toBe("Code Auditor");
  });

  it("stores the resolved NAME, not the ref the caller typed", async () => {
    // ⚠ The caller may name it by ID or in the wrong case; the snapshot has to be
    // the row's own name, because it is what a later deletion is read against and
    // what an operator sees on the session card.
    online();
    vi.mocked(resolveTemplateRef).mockResolvedValue({
      kind: "found",
      id: T1,
      name: "Code Auditor",
    });
    await createLaunchDirective(ctx, { channel: "general", template: "code auditor" });
    expect(
      vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0][1].template_name
    ).toBe("Code Auditor");
  });

  it("NO template named → both columns are NULL, and the resolver is never called", async () => {
    // ⚠ A launch with no template must be byte-identical to what this lane did
    // before templates existed — no read, no round trip, no columns.
    online();
    await createLaunchDirective(ctx, { channel: "general" });
    expect(resolveTemplateRef).not.toHaveBeenCalled();
    const insert = vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0][1];
    expect(insert.template_id).toBeNull();
    expect(insert.template_name).toBeNull();
  });

  it("hands the resolver THIS caller's context, `apiKeyWorkspaceId` included (M-10)", async () => {
    // ⚠ ARM 2 OF THE MATRIX RIDES ON THAT ONE FIELD. A workspace-scoped API key
    // may be shared between humans, so it inherits nobody's personal reach —
    // passing `null` here would let such a key resolve the key owner's PRIVATE
    // templates by name. `ChannelContext` started carrying the field for this.
    online();
    vi.mocked(resolveTemplateRef).mockResolvedValue({ kind: "found", id: T1, name: "X" });
    await createLaunchDirective(
      { ...ctx, apiKeyWorkspaceId: WS },
      { channel: "general", template: "X" }
    );
    const [templateCtx, ref] = vi.mocked(resolveTemplateRef).mock.calls[0];
    expect(templateCtx).toMatchObject({
      workspaceId: WS,
      userId: ME,
      apiKeyWorkspaceId: WS,
    });
    expect(ref).toBe("X");
  });

  it("an UNRESOLVABLE ref refuses and files NOTHING", async () => {
    online();
    vi.mocked(resolveTemplateRef).mockResolvedValue({ kind: "not-found" });
    await expect(
      createLaunchDirective(ctx, { channel: "general", template: "Ghost" })
    ).rejects.toBeInstanceOf(LaunchTemplateNotFoundError);
    expect(launchRepo.insertLaunchDirective).not.toHaveBeenCalled();
  });

  it("an AMBIGUOUS name refuses, files nothing, and carries every match", async () => {
    // ⚠ REFUSES AND LISTS, NEVER PICKS. Names are deliberately not unique, and
    // the list is what makes the refusal actionable — the caller re-issues with
    // an id it is already holding.
    online();
    vi.mocked(resolveTemplateRef).mockResolvedValue({
      kind: "ambiguous",
      matches: [
        { id: T1, name: "Researcher", visibility: "private" },
        { id: T2, name: "Researcher", visibility: "workspace" },
      ],
    });
    const err = await createLaunchDirective(ctx, {
      channel: "general",
      template: "Researcher",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(LaunchTemplateAmbiguousError);
    expect((err as LaunchTemplateAmbiguousError).matches).toEqual([
      { id: T1, name: "Researcher", visibility: "private" },
      { id: T2, name: "Researcher", visibility: "workspace" },
    ]);
    expect(launchRepo.insertLaunchDirective).not.toHaveBeenCalled();
  });

  it("a BAD TEMPLATE REF beats PRESENCE — an offline machine does not hide the caller's own error", async () => {
    // ⚠ THE GATE ORDER, ASSERTED. `offline` is a 200 saying "nothing was asked"
    // and is the ordinary answer for a closed laptop. Checking presence first
    // would answer a misspelt template with "your machine is asleep": the caller
    // fixes the wrong thing, waits, and meets the real refusal a minute later.
    vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map() as never);
    vi.mocked(resolveTemplateRef).mockResolvedValue({ kind: "not-found" });
    await expect(
      createLaunchDirective(ctx, { channel: "general", template: "Ghost" })
    ).rejects.toBeInstanceOf(LaunchTemplateNotFoundError);
  });

  it("the CHANNEL and THREAD gates still come first — a bad channel is never a template error", async () => {
    online();
    vi.mocked(loadVisibleChannel).mockResolvedValue({
      channel: { ...CHANNEL_ROW, visibility: "public" },
      membership: null,
    } as never);
    await expect(
      createLaunchDirective(ctx, { channel: "general", template: "Code Auditor" })
    ).rejects.toBeInstanceOf(LaunchDirectiveNotFoundError);
    expect(resolveTemplateRef).not.toHaveBeenCalled();
  });

  it("the DTO carries both halves out again — the desktop reads them from the CLAIM", async () => {
    // ⚠ `toDirective` is where the signal would be lost one layer above the wire
    // narrowing that gets blamed for it: the desktop re-narrows from the CLAIM's
    // answer (the server DTO), not from the realtime frame.
    vi.mocked(launchRepo.findLaunchDirective).mockResolvedValue(
      row({ template_id: T1, template_name: "Code Auditor" })
    );
    const out = await getLaunchDirective(ctx, DIR);
    expect(out.templateId).toBe(T1);
    expect(out.templateName).toBe("Code Auditor");
  });

  it("E-4 on the DTO: a NULLED id beside a live name survives the mapping", async () => {
    vi.mocked(launchRepo.findLaunchDirective).mockResolvedValue(
      row({ template_id: null, template_name: "Code Auditor" })
    );
    const out = await getLaunchDirective(ctx, DIR);
    expect(out.templateId).toBeNull();
    expect(out.templateName).toBe("Code Auditor");
  });
});
