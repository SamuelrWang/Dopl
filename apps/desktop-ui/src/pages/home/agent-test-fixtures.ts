import { fireEvent, screen } from "@testing-library/react";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import { SEGMENT, USER_ID, WORKSPACE_ID, bridgeCalls, ok } from "#/test-utils/bridge";
import type { AgentTemplate } from "@/features/agent-templates/client/types";
import {
  CONTAINER_BASES,
  KB_SHARED,
  LINK_WORKSPACE_ID,
  routes,
} from "./home-test-harness";

/**
 * THE /home AGENTS FIXTURES AND THEIR ROUTING TABLE — shared by
 * `agent-panels.test.tsx` (the reading face, M2) and `agent-authoring.test.tsx`
 * (the writing face, M3/M4).
 *
 * ⚠ EXTRACTED 2026-08-26 BECAUSE `agent-panels.test.tsx` WAS AT 412 LINES with
 * the authoring wave still to cover (§1: a file near the cap cannot absorb the
 * next entry). Extracting the fixtures rather than copying them is the point —
 * a second `T_HOME` is how two suites come to disagree about what a
 * home-workspace template looks like, and this face's whole hazard (F-331) is
 * two workspaces being mistaken for each other.
 *
 * ⚠ THE ROUTES ARE CHAINED IN FRONT OF THE HOME HARNESS, not added to it:
 * `/api/agent-templates` is this face's read alone, and the harness answers
 * every other path the page opens with.
 */

export const OTHER_WS = "ws-link-2";

/** One template, typed so a rename of any `AgentTemplate` field breaks the
 *  fixture at compile time rather than leaving these suites green against a
 *  shape the endpoint stopped sending. */
export function template(
  over: Partial<AgentTemplate> & { id: string; name: string }
): AgentTemplate {
  return {
    workspaceId: LINK_WORKSPACE_ID,
    description: null,
    instructions: null,
    model: null,
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [],
    createdBy: USER_ID,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    ...over,
  };
}

/** Scope A, mine — shared into the channel, no authorship marker. */
export const T_SHARED = template({
  id: "tpl-shared-1",
  name: "Renewal chaser",
  visibility: "workspace",
});
/** ⚠ Scope A, the PEER's. A member-granted claimer can create templates in the
 *  container (Q5), so this is the row the marker exists for. */
export const T_SHARED_PEER = template({
  id: "tpl-shared-2",
  name: "Priya's intake bot",
  visibility: "workspace",
  createdBy: "user-2",
});
/** Scope B — private, mine, in the container. */
export const T_PRIVATE = template({ id: "tpl-private-1", name: "Scratch agent" });
/** ⚠ Private but SOMEBODY ELSE'S. The server would not send it; the client
 *  filter is a second fence and this is what pins it. */
export const T_PRIVATE_PEER = template({
  id: "tpl-private-2",
  name: "Priya's drafts bot",
  createdBy: "user-2",
});
/** ⚠ NEITHER SECTION. `team` has no referent in a container, so it must be
 *  DROPPED — without a row in this state, deleting the grouping's unknown-value
 *  guard changes nothing visible. */
export const T_TEAM = template({
  id: "tpl-team-1",
  name: "Team ops bot",
  visibility: "team",
  teamIds: ["team-1"],
});
/**
 * Scope C — private, mine, in the caller's HOME workspace.
 *
 * ⚠ IT CARRIES AN ATTACHED KNOWLEDGE BASE, INSTRUCTIONS AND A MODEL ON PURPOSE.
 * The copy (M4) must carry the fields and DROP the base; a bare fixture would
 * leave "knowledgeBaseIds cleared" indistinguishable from "there were none".
 */
export const T_HOME = template({
  id: "tpl-home-1",
  name: "Fundraise analyst",
  workspaceId: WORKSPACE_ID,
  description: "Reads the data room",
  instructions: "Cite the memo.",
  model: "claude-opus-5",
  fields: [{ key: "round", value: "seed" }],
  knowledgeBases: [{ id: "kb-home-1", name: "Fundraise memos" }],
});
/** …and a `team` row over there too, so the drop is pinned on both reads. */
export const T_HOME_TEAM = template({
  id: "tpl-home-2",
  name: "Team ops bot",
  workspaceId: WORKSPACE_ID,
  visibility: "team",
  teamIds: ["team-9"],
});
export const DANA_TEMPLATE = template({
  id: "tpl-dana-1",
  name: "Dana's assistant",
  workspaceId: OTHER_WS,
  visibility: "workspace",
});

/** The home workspace's teams — the ONLY thing this face reads the boot
 *  segment for, and a container must never ask for it. */
export const TEAMS_PATH = `/api/workspaces/${SEGMENT}/teams`;

/**
 * `GET/POST/PATCH/DELETE /api/agent-templates`, routed by WHICH WORKSPACE was
 * asked for.
 *
 * ⚠ `x-workspace-id` is an `opts` field over the bridge, not part of the path —
 * both scopes hit the SAME url, so a suite matching on the path alone would
 * serve the container's templates to the home scope and pass while the two
 * scopes were wired to one workspace (which is precisely F-331's shape).
 *
 * ⚠ THE POST ECHOES THE WORKSPACE IT WAS ADDRESSED TO. The created row's
 * `workspaceId` is `opts.workspaceId`, so a write aimed at the wrong workspace
 * comes back WEARING that mistake — the reconcile then files it under the wrong
 * list on screen instead of reading correct either way.
 * ⚠ IT DOES NOT RESOLVE `knowledgeBaseIds` INTO `{id,name}` PAIRS the way the
 * real route does. Nothing here asserts on the created row's attachments; the
 * assertion that matters for the copy is on the REQUEST BODY, which is the
 * thing the client composed.
 */
export function agentTemplates(
  path: string,
  opts: BridgeRequestOpts
): Promise<BridgeResponse> {
  const body = (opts.body ?? {}) as Partial<AgentTemplate>;
  if (opts.method === "POST") {
    const name = body.name ?? "Untitled";
    return Promise.resolve(
      ok({
        template: template({
          id: `tpl-new-${name.toLowerCase().replace(/\W+/g, "-")}`,
          name,
          description: body.description ?? null,
          instructions: body.instructions ?? null,
          model: body.model ?? null,
          fields: body.fields ?? [],
          visibility: body.visibility ?? "private",
          workspaceId: opts.workspaceId ?? LINK_WORKSPACE_ID,
        }),
      })
    );
  }
  if (opts.method === "PATCH") {
    const source = ALL.find((t) => path.endsWith(t.id)) ?? T_PRIVATE;
    return Promise.resolve(ok({ template: { ...source, ...body } }));
  }
  return Promise.resolve(
    ok({
      templates:
        opts.workspaceId === WORKSPACE_ID
          ? [T_HOME, T_HOME_TEAM]
          : [T_SHARED, T_SHARED_PEER, T_PRIVATE, T_PRIVATE_PEER, T_TEAM],
    })
  );
}

const ALL = [T_SHARED, T_SHARED_PEER, T_PRIVATE, T_PRIVATE_PEER, T_TEAM, T_HOME];

/**
 * A base ONLY the CHANNEL-SCOPED read carries. `GET /api/knowledge/bases?channelId=`
 * folds in `channelGrants` and is a different cache entry from the plain
 * workspace read (INVARIANTS §9) — but until 2026-08-26 this table stripped the
 * query before dispatching, so both reads got the same body and
 * `agent-authoring.test.tsx › attaches the TARGET workspace's knowledge bases`
 * pinned NOTHING about which entry the attach picker uses. This row is what
 * makes the two answers distinguishable: the attach picker must never show it.
 */
export const CHANNEL_ONLY_BASE = "Granted into this channel";

/** `GET /api/knowledge/bases?channelId=` — the Knowledge pane's entry. */
function channelScopedBases(): Promise<BridgeResponse> {
  return Promise.resolve(
    ok({
      ...CONTAINER_BASES,
      bases: [
        ...CONTAINER_BASES.bases,
        { ...KB_SHARED, id: "kb-granted-1", name: CHANNEL_ONLY_BASE },
      ],
    })
  );
}

/**
 * Every path the /home Agents face opens, and the harness for the rest.
 *
 * ⚠ QUERY-AWARE ON ONE PATH, DELIBERATELY. Everything else is matched on the
 * BARE path — `x-workspace-id` rides `opts`, not the url — but the base list is
 * the one read where the QUERY names a different cache entry with a different
 * body, so a table that strips it hands the picker an answer it should not be
 * able to see and calls it a pass.
 */
export function agentRoutes(
  path: string,
  opts: BridgeRequestOpts = {}
): Promise<BridgeResponse> {
  const bare = path.split("?")[0];
  if (bare.startsWith("/api/agent-templates")) return agentTemplates(bare, opts);
  // ⚠ Answered so the HOME-workspace editor's teams read resolves. A CONTAINER
  // mount must never reach it, and `agent-authoring.test.tsx` asserts on the
  // absence of this very call.
  if (bare === TEAMS_PATH) return Promise.resolve(ok({ teams: [] }));
  if (
    bare === "/api/knowledge/bases" &&
    path.includes("channelId=") &&
    opts.workspaceId !== WORKSPACE_ID
  ) {
    return channelScopedBases();
  }
  return routes(bare, opts) ?? Promise.reject(new Error(`unexpected: ${path}`));
}

// ─── The three gestures both suites make ─────────────────────────────────

/** Open the Agents face through the header's `SegmentedControl` — the same
 *  control the operator clicks, so nothing here bypasses the pane token.
 *  ⚠ Each suite declares its OWN `channel-surface` stub: `vi.mock` is hoisted
 *  per file and its factory may not close over module imports. */
export async function openAgents(): Promise<void> {
  await screen.findByTestId("channel-surface");
  fireEvent.click(screen.getByText("Agents"));
}

/** Point the private section at one of the two shelves. */
export async function chooseScope(label: string): Promise<void> {
  fireEvent.click(screen.getByLabelText("Which private agents"));
  fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(label) }));
}

/** The template calls, split by which workspace they addressed. */
export function templateCalls(
  mock: { mock: { calls: unknown[][] } },
  workspaceId: string | undefined
) {
  return bridgeCalls(mock).filter(
    (c) =>
      c.path.split("?")[0].startsWith("/api/agent-templates") &&
      c.opts.workspaceId === workspaceId
  );
}
