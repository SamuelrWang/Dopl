/**
 * 🔒 **THE FOLLOW, ON ITS OWN** — what a read does with the address
 * `resolve-resource.ts` hands it.
 *
 * ⚠ **THE RESOLVER IS MOCKED HERE, AND ONLY HERE IS THAT RIGHT.** Its four
 * clauses are driven un-mocked against the query builder in
 * `resolve-resource.test.ts`; this file owns the COMPOSITION — how many times
 * the caller's own read runs, and with WHAT — which is the half four features
 * would otherwise each restate.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./resolve-resource", () => ({ resolveResource: vi.fn() }));

import { resolveResource, type ResolvedResource } from "./resolve-resource";
import {
  readResourceById,
  type ContainerScopedCaller,
} from "./read-resource";

const ME = "22222222-3333-4444-5555-666666666666";
const WS_A = "11111111-2222-3333-4444-555555555555";
const WS_B = "99999999-8888-7777-6666-555555555555";
const ID = "44444444-4444-4444-4444-444444444444";

interface Ctx extends ContainerScopedCaller {
  source: "user" | "agent";
}

const ctx: Ctx = { userId: ME, workspaceId: WS_A, role: "member", source: "user" };

/** A row that exists in `WS_B` and nowhere else. */
function elsewhere(over: Partial<ResolvedResource> = {}): ResolvedResource {
  return {
    type: "knowledge_base",
    id: ID,
    name: "Runbooks",
    containerId: WS_B,
    containerName: "Acme",
    containerKind: "standard",
    homeScoped: false,
    containerRole: "admin",
    ...over,
  };
}

/** A read that answers in exactly the containers named, and records every
 *  context it was handed. */
function loaderFor(...containers: string[]) {
  const seen: Ctx[] = [];
  const load = vi.fn(async (c: Ctx) => {
    seen.push(c);
    return containers.includes(c.workspaceId) ? `row@${c.workspaceId}` : null;
  });
  return { load, seen };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a row where it was asked for costs nothing", () => {
  it("answers from this container and never asks the resolver", async () => {
    const { load, seen } = loaderFor(WS_A);
    const hit = await readResourceById(ctx, "knowledge_base", ID, load);
    expect(hit).toEqual({ ctx, value: `row@${WS_A}` });
    // ⚠ MUTATION CHECK. Resolving FIRST would put two extra queries on the hit
    // path — every read in the product, to serve the miss.
    expect(resolveResource).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
  });
});

describe("🔒 an id names its own container, and the read follows it", () => {
  it("re-runs THE SAME read there, with the caller's REAL role", async () => {
    vi.mocked(resolveResource).mockResolvedValue(elsewhere());
    const { load, seen } = loaderFor(WS_B);
    const hit = await readResourceById(ctx, "knowledge_base", ID, load);
    expect(hit?.value).toBe(`row@${WS_B}`);
    // 🔒 MUTATION CHECK. Drop `role` from the re-based context and the same row
    // answers two ways depending on which door the caller came through: a
    // team-scoped attachment an admin can see vanishes on the id lane alone.
    expect(seen[1]).toEqual({
      ...ctx,
      workspaceId: WS_B,
      role: "admin",
    });
    // ⚠ And the caller is handed THAT context, because the row's contents —
    // entries, messages, a skill body — are workspace-keyed reads of their own.
    expect(hit?.ctx.workspaceId).toBe(WS_B);
  });

  it("🔒 RESOLUTION IS NOT AUTHORISATION — the matrix still runs, and still refuses", async () => {
    // The resolver is strictly narrower than a feature's matrix but not equal
    // to it: a row it can NAME (own, or container-visible) may still fail the
    // read's own gates — an agent audience ceiling, a teams grant, a retention
    // window. The answer is the same single miss.
    vi.mocked(resolveResource).mockResolvedValue(elsewhere());
    const { load } = loaderFor();
    expect(await readResourceById(ctx, "knowledge_base", ID, load)).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not re-read the tenancy that just missed", async () => {
    // ⚠ MUTATION CHECK. Resolving back into the container the read already
    // refused means the MATRIX said no; asking again spends a query to hear it
    // twice.
    vi.mocked(resolveResource).mockResolvedValue(elsewhere({ containerId: WS_A }));
    const { load } = loaderFor();
    expect(await readResourceById(ctx, "knowledge_base", ID, load)).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("answers NULL for an id that is nameable nowhere", async () => {
    vi.mocked(resolveResource).mockResolvedValue(null);
    const { load } = loaderFor();
    expect(await readResourceById(ctx, "knowledge_base", ID, load)).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
