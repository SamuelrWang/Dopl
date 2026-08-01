/**
 * THE CLUSTER ROLLUP IS A WORKFLOW LISTING, AND IT HAD NO VISIBILITY FILTER.
 *
 * `dopl_workflow(op="list")` drops teams-mode workflows the caller holds no
 * grant on. The cluster rollup — `workflow_count`, `workflow_names`, and the
 * `workflows` array on `getCluster` — was computed over every workflow in the
 * cluster, so the same rows one tool hid the other disclosed by name, slug and
 * description. Both now go through ONE rule (`filterTeamVisibleWorkflows`), and
 * these tests drive it through the SERVICE, which is where the two tools' views
 * are supposed to agree.
 *
 * The COUNT is part of the disclosure, not a summary of it: a count taken over
 * rows the caller cannot open states how many team-scoped workflows exist and
 * lets a caller probe for one. So every case below asserts the count and the
 * names together.
 *
 * Supabase is stubbed and only `listEffectiveAccess` is mocked — `resolveLevel`
 * and the filter itself are the real ones, so removing the filter fails these.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/features/teams/server/access", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/teams/server/access")>();
  return { ...actual, listEffectiveAccess: vi.fn() };
});

import { supabaseAdmin } from "@/shared/supabase/admin";
import { listEffectiveAccess } from "@/features/teams/server/access";
import { listClusters, getCluster, type ClusterScope } from "./service";

const scope: ClusterScope = {
  workspaceId: "ws-1",
  userId: "user-1",
  role: "member",
  source: "user",
};

const CLUSTER = {
  id: "cl-1",
  slug: "ops",
  name: "OPS",
  description: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

/** A workflow row as the rollup queries select it. */
const wf = (
  id: string,
  name: string,
  access_mode: "workspace" | "teams",
  user_id: string | null
) => ({
  id,
  name,
  slug: name.toLowerCase(),
  description: `${name} does things`,
  cluster_id: CLUSTER.id,
  access_mode,
  user_id,
});

type Result = { data: unknown; error: unknown };

/**
 * Chainable + thenable Supabase stub: every filter is recorded (so the
 * soft-delete predicate can be asserted where it actually lives — in the
 * query), and awaiting the chain resolves whatever is queued for the table the
 * chain started from.
 */
function makeDb(results: Record<string, Result>) {
  const calls = { is: [] as Array<[string, string, unknown]> };
  let table = "";
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    from: (t: string) => {
      table = t;
      return builder;
    },
    select: chain,
    eq: chain,
    in: chain,
    order: chain,
    is: (col: string, val: unknown) => {
      calls.is.push([table, col, val]);
      return builder;
    },
    single: () => Promise.resolve(results[table]),
    then: (
      resolve: (v: Result) => unknown,
      reject: (e: unknown) => unknown
    ) => Promise.resolve(results[table]).then(resolve, reject),
  });
  return { builder, calls };
}

/** Not an admin, and holding a grant on exactly `grantedIds`. */
function memberWithGrants(grantedIds: string[]) {
  vi.mocked(listEffectiveAccess).mockResolvedValue({
    defaultLevel: "edit",
    isAdmin: false,
    teamsModeResources: TEAMS_MODE.map((id) => ({
      resourceType: "workflow" as const,
      resourceId: id,
      level: grantedIds.includes(id) ? ("edit" as const) : null,
    })),
  });
}

/** Every teams-mode workflow used below, as the access batch would report it. */
const TEAMS_MODE = ["wf-secret", "wf-shared"];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listClusters — the workflow rollup", () => {
  it("hides a teams-mode workflow the caller has no grant on: no name AND no count", async () => {
    const { builder } = makeDb({
      clusters: { data: [CLUSTER], error: null },
      workflows: {
        data: [
          wf("wf-open", "Onboard", "workspace", "someone-else"),
          wf("wf-secret", "Payroll", "teams", "someone-else"),
        ],
        error: null,
      },
    });
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
    memberWithGrants([]);

    const [row] = await listClusters(scope);

    expect(row.workflow_names).toEqual(["Onboard"]);
    // The count is the other half of the leak: 2 here would say a workflow
    // exists that the caller may not know about.
    expect(row.workflow_count).toBe(1);
    expect(row.workflow_count).toBe(row.workflow_names.length);
  });

  it("shows the same workflow to a caller who IS granted it", async () => {
    const { builder } = makeDb({
      clusters: { data: [CLUSTER], error: null },
      workflows: {
        data: [wf("wf-shared", "Payroll", "teams", "someone-else")],
        error: null,
      },
    });
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
    memberWithGrants(["wf-shared"]);

    const [row] = await listClusters(scope);

    expect(row.workflow_names).toEqual(["Payroll"]);
    expect(row.workflow_count).toBe(1);
  });

  it("keeps trashed workflows out of the rollup", async () => {
    const { builder, calls } = makeDb({
      clusters: { data: [CLUSTER], error: null },
      workflows: { data: [], error: null },
    });
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
    memberWithGrants([]);

    await listClusters(scope);

    // Soft-delete is enforced in the query, exactly as the workflows service
    // enforces it — a trashed workflow is never a candidate to be counted.
    expect(calls.is).toContainEqual(["workflows", "deleted_at", null]);
  });
});

describe("getCluster — the workflow detail", () => {
  const detailDb = (rows: unknown[]) =>
    makeDb({
      clusters: { data: CLUSTER, error: null },
      workflows: { data: rows, error: null },
    });

  it("drops the invisible rows and never hands back their slug or description", async () => {
    const { builder } = detailDb([
      wf("wf-open", "Onboard", "workspace", "someone-else"),
      wf("wf-secret", "Payroll", "teams", "someone-else"),
    ]);
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
    memberWithGrants([]);

    const detail = await getCluster("ops", scope);

    expect(detail.workflows.map((w) => w.id)).toEqual(["wf-open"]);
    expect(detail.workflow_count).toBe(1);
    expect(JSON.stringify(detail)).not.toContain("payroll");
    expect(JSON.stringify(detail)).not.toContain("Payroll does things");
  });

  it("returns the cluster with an EMPTY rollup when nothing in it is visible — not a 404", async () => {
    // The cluster itself is a workspace-scoped container with no access_mode of
    // its own; only its contents are filtered. Same house pattern as
    // getWorkflow, which filters unreadable attachments rather than 404ing.
    const { builder } = detailDb([wf("wf-secret", "Payroll", "teams", "someone-else")]);
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
    memberWithGrants([]);

    const detail = await getCluster("ops", scope);

    expect(detail.slug).toBe("ops");
    expect(detail.workflows).toEqual([]);
    expect(detail.workflow_count).toBe(0);
    expect(detail.workflow_names).toEqual([]);
  });

  it("does not leak the filter's own columns into the summary", async () => {
    const { builder } = detailDb([wf("wf-open", "Onboard", "workspace", "user-1")]);
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
    memberWithGrants([]);

    const detail = await getCluster("ops", scope);

    // `access_mode` / `user_id` are selected to run the rule, not to be served.
    expect(Object.keys(detail.workflows[0]).sort()).toEqual([
      "description",
      "id",
      "name",
      "slug",
    ]);
  });

  it("keeps trashed workflows out of the detail too", async () => {
    const { builder, calls } = detailDb([]);
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
    memberWithGrants([]);

    await getCluster("ops", scope);

    expect(calls.is).toContainEqual(["workflows", "deleted_at", null]);
  });
});
