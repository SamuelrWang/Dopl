import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import { USER_ID, WORKSPACE_ID, ok } from "#/test-utils/bridge";
import type { KnowledgeBaseList } from "@/features/knowledge/client/api";
import type { KnowledgeBase } from "@/features/knowledge/types";
import { LINK_WORKSPACE_ID } from "./home-test-ids";

/**
 * THE /home KNOWLEDGE FACE'S FIXTURES (plan M3) AND ITS BASE-LIST READ.
 *
 * ⚠ SPLIT OUT OF `home-test-harness.tsx` ON 2026-09-01, for the reason that
 * file records about its OWN birth: it sat at EXACTLY 500 lines
 * (`eslint.config.mjs › max-lines`, an error over `apps/*​/src/**`), so the
 * Overview wave could not add a single route row to it. **A file at the cap
 * cannot absorb a new entry** (INVARIANTS §1) — the remedy is to relieve it by
 * a whole FACE, not to shave comments off it. Overview's fixtures went to
 * `overview-test-harness.ts` in the same change.
 *
 * ⚠ THE HARNESS RE-EXPORTS EVERYTHING HERE, so every suite still imports these
 * from `./home-test-harness` and no call site moved.
 *
 * ⚠ A `.ts` FILE, NOT `.tsx`: nothing here renders, and the /home no-concave
 * sweep (`template-editor.test.tsx › no concave surfaces`) enumerates every
 * non-test `.tsx` in this directory.
 */

/** One base, typed so a rename of any `KnowledgeBase` field breaks the fixture
 *  at compile time rather than leaving the panels' suite green against a shape
 *  the endpoint stopped sending. */
function base(over: Partial<KnowledgeBase> & { id: string; name: string }): KnowledgeBase {
  return {
    workspaceId: LINK_WORKSPACE_ID,
    slug: over.name.toLowerCase().replace(/\s+/g, "-"),
    publicId: over.id.slice(-6),
    description: null,
    agentWriteEnabled: false,
    visibility: "public",
    accessMode: "workspace",
    createdBy: USER_ID,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    deletedAt: null,
    ...over,
  };
}

/** Scope A, `visible` — the peer sees this one in the channel. ⚠ Created by the
 *  PEER, so the card's owner label is a real lookup rather than "You". */
export const KB_SHARED = base({ id: "kb-shared-1", name: "Renewals", createdBy: "user-2" });
/** Scope A, `agent_only` — reachable by the agent, invisible to the peer. */
export const KB_AGENT = base({ id: "kb-agent-1", name: "Pricing rules" });
/** Scope B — private, mine, in the container, NO grant row. */
export const KB_PRIVATE = base({
  id: "kb-private-1",
  name: "Call notes",
  visibility: "private",
});
/** ⚠ Private but SOMEBODY ELSE'S: scope B must drop it. A container base the
 *  caller cannot have created is the case a `createdBy` filter typo passes. */
export const KB_PRIVATE_PEER = base({
  id: "kb-private-2",
  name: "Priya's drafts",
  visibility: "private",
  createdBy: "user-2",
});
/** ⚠ NEITHER SCOPE. Mine and ungranted, but PUBLIC to the container — so it is
 *  not shared into the channel and it is not private either. Without a base in
 *  this state, dropping scope B's `visibility` test changes nothing visible. */
export const KB_PUBLIC_UNGRANTED = base({
  id: "kb-public-1",
  name: "Team playbook",
});
/** Scope C — private, mine, in the HOME workspace (a different container). */
export const KB_HOME = base({
  id: "kb-home-1",
  name: "Fundraise memos",
  workspaceId: WORKSPACE_ID,
  visibility: "private",
});

/** `GET /api/knowledge/bases?channelId=` for the link container. */
export const CONTAINER_BASES: KnowledgeBaseList = {
  bases: [KB_SHARED, KB_AGENT, KB_PRIVATE, KB_PRIVATE_PEER, KB_PUBLIC_UNGRANTED],
  ownerNames: { "user-2": "Priya Shah" },
  baseStats: {},
  kbStorageLimit: null,
  starredBaseIds: [],
  // ⚠ THE TWO GRANTED BASES, and the fixture would be self-contradictory
  // without them: `sharedBaseIds` is "granted into at least one channel", and
  // these two carry the grants below. BOTH levels count — `agent_only` is still
  // a share (the base has left the private shelf), which is why `KB_AGENT` is
  // here beside the `visible` one.
  sharedBaseIds: [KB_SHARED.id, KB_AGENT.id],
  channelGrants: {
    [KB_SHARED.id]: { level: "visible", guestWrite: false },
    [KB_AGENT.id]: { level: "agent_only", guestWrite: false },
  },
};

/**
 * 🔴 THE WORKSPACE SHELF — SAMUEL'S BUG, MADE REPEATABLE (ruling 2026-08-26).
 * Same workspace as `KB_HOME`, private, the caller's own: every property scope C
 * used to select on. Only `?shelf=home` separates them. Nothing was leaking
 * across workspaces (measured in production 2026-08-26) — the RANGE was wrong.
 * ⚠ Never add it to `HOME_BASES`.
 */
export const KB_WORKSPACE_SHELF = base({
  id: "kb-ws-shelf-1",
  name: "Dopl GTM",
  workspaceId: WORKSPACE_ID,
  visibility: "private",
});

/** `GET /api/knowledge/bases?shelf=home` for the caller's HOME workspace — no
 *  channel, so the route sends no `channelGrants` key at all (INVARIANTS §9). */
export const HOME_BASES: KnowledgeBaseList = {
  bases: [KB_HOME],
  ownerNames: {},
  baseStats: {},
  kbStorageLimit: null,
  starredBaseIds: [],
  // The personal shelf's base is shared nowhere — the card keeps "Private".
  sharedBaseIds: [],
  channelGrants: {},
};

/**
 * The base list, routed by WHICH WORKSPACE was asked for — `x-workspace-id` is
 * an `opts` field over the bridge, not part of the path, so a suite that
 * matched on the path alone would serve the container's bases to the home
 * scope and pass while the two scopes were wired to one workspace.
 *
 * 🔒 ⚠ AND BY WHICH SHELF (2026-08-26) — hence the PATH argument: `?shelf=` is a
 * query param, so the workspace axis alone no longer separates scope C from the
 * workspace Knowledge page, which ask the SAME workspace for different shelves.
 * ⚠ ABSENT `shelf` ANSWERS BOTH, mirroring the route. That branch is what a
 * forgotten param falls into and the only reason the exclusion pin can fail —
 * collapse it into "home" and the pin goes vacuous.
 */
export function knowledgeBases(
  opts: BridgeRequestOpts,
  path = ""
): Promise<BridgeResponse> {
  if (opts.method === "POST") {
    const body = (opts.body ?? {}) as { name?: string; visibility?: string };
    return Promise.resolve(
      ok({
        base: base({
          id: "kb-new-1",
          name: body.name ?? "Untitled",
          workspaceId: opts.workspaceId ?? LINK_WORKSPACE_ID,
          visibility: body.visibility === "private" ? "private" : "public",
        }),
      })
    );
  }
  if (opts.workspaceId !== WORKSPACE_ID) return Promise.resolve(ok(CONTAINER_BASES));
  const shelf = new URLSearchParams(path.split("?")[1] ?? "").get("shelf");
  if (shelf === "home") return Promise.resolve(ok(HOME_BASES));
  if (shelf === "workspace") {
    return Promise.resolve(ok({ ...HOME_BASES, bases: [KB_WORKSPACE_SHELF] }));
  }
  return Promise.resolve(
    ok({ ...HOME_BASES, bases: [KB_HOME, KB_WORKSPACE_SHELF] })
  );
}

/** Any base's tree. The panels resolve one BEFORE mounting the detail view
 *  (`knowledge-base-view.tsx`), so a suite that opens a base must answer this
 *  or the pane sits on its skeleton forever. */
export const EMPTY_TREE_PATH = /^\/api\/knowledge\/bases\/[^/]+\/tree$/;
