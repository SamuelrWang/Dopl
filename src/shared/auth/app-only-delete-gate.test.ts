/**
 * THE APP-ONLY DELETION RULE, AS CODE RATHER THAN AS PROSE (2026-09-02).
 *
 * Every `_admin` tool in `packages/mcp-server` served this sentence:
 *
 *   "Deletion is app-only … there is no MCP path to it, for any role or token."
 *
 * ⚠ UNTIL THIS FILE, `packages/mcp-server/src/gating.ts › opRefusal` WAS THE
 * ONLY THING THAT MADE THAT TRUE, and it guards ONE door. The MCP server reaches
 * the app over LOOPBACK HTTP, a `full`-profile session has Bash and its own
 * `dopl_at_*` bearer, and every REST `DELETE` the refusal covers was
 * `withWorkspaceAuth(…, { minRole: "member" })` — so the agent that had just
 * been told "no role, scope or argument changes that" could `curl` the row away.
 * A tool description is a PROMPT; `sessionOnly` is a FENCE.
 *
 * ⚠ AND THE NEXT WAVE CAME THE SAME DAY. Because this file exists, the five
 * `_admin` tools were deleted outright — 9,295 served chars publishing a
 * refusal — so `opRefusal` no longer guards anything that is registered, and
 * THIS FILE IS THE FENCE. `DELETE_BLOCKED_OPS` survives as the ledger of delete
 * capabilities the app owns and the MCP surface may never publish, re-keyed
 * from `<tool>_admin` onto the DOMAIN tool a delete op could only arrive on.
 *
 * Two properties, and the second is the one that outlives any tool:
 *   1. per ROUTE — an agent token is refused `SESSION_REQUIRED` and a session
 *      caller still deletes (below);
 *   2. per LISTED OP — every op in `DELETE_BLOCKED_OPS` maps to a REST route on
 *      this list, so a delete op cannot ship without the fence behind it. Its
 *      twin lives in `packages/mcp-server/src/tools/delete-block.test.ts`, which
 *      asserts none of these ops is in a live `op` enum.
 *
 * ⚠ THE WRAPPER IS FAKED, AND THE FAKE MIRRORS `with-auth.ts`'s REAL BRANCH
 * (the `options.sessionOnly` → 403 `SESSION_REQUIRED` arm, verbatim in shape).
 * What is under test here is that each ROUTE registers the option and therefore
 * takes that arm — the arm ITSELF is pinned against the real implementation by
 * `with-auth.test.ts` and `with-workspace-auth.test.ts` (a)/(b)/(c). Same
 * structure `with-workspace-auth.test.ts` already uses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";

const REPO_ROOT = process.cwd();
const API_ROOT = path.join(REPO_ROOT, "src/app/api");

/** Flipped per test: does the caller present a `dopl_at_*` bearer or a cookie? */
let callerIsAgent = false;

const AUTH: Omit<WorkspaceAuthContext, "params"> = {
  userId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "pub-1",
  role: "member",
  apiKeyWorkspaceId: null,
};

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth:
    (
      handler: (req: NextRequest, ctx: WorkspaceAuthContext) => Promise<Response>,
      options?: Record<string, unknown>
    ) =>
      (req: NextRequest, rc?: unknown) => {
        void rc;
        // ⚠ MIRRORS `with-auth.ts`'s sessionOnly arm: agent tokens are refused
        // BEFORE the handler, regardless of scope or role.
        if (callerIsAgent && options?.sessionOnly) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  code: "SESSION_REQUIRED",
                  message:
                    "This action requires an interactive Dopl session and can't be performed over an MCP connection. Sign in to the Dopl app to continue.",
                },
              }),
              { status: 403, headers: { "content-type": "application/json" } }
            )
          );
        }
        return handler(req, {
          ...AUTH,
          ...(callerIsAgent ? { agentTokenId: "tok-1" } : {}),
          params: currentParams,
        });
      },
}));

/** Route params the faked wrapper injects for whichever route is under test. */
let currentParams: Record<string, string> = {};

vi.mock("@/features/knowledge/server/service", () => ({
  buildKnowledgeContext: (auth: WorkspaceAuthContext) => ({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
  }),
  getBaseById: vi.fn(),
  updateBase: vi.fn(),
  deleteBase: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
  createFolderByPath: vi.fn(),
  listDirByPath: vi.fn(),
  deleteByPath: vi.fn(),
  getEntry: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
}));

vi.mock("@/features/skills/server/service", () => ({
  buildSkillContext: (auth: WorkspaceAuthContext) => ({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
  }),
  deleteSkill: vi.fn(),
  resolveSkillBody: vi.fn(),
  updateSkill: vi.fn(),
}));

vi.mock("@/features/chats/server/service", () => ({
  buildChatContext: (auth: WorkspaceAuthContext) => ({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
  }),
  getChat: vi.fn(),
  updateChatHeader: vi.fn(),
  deleteChat: vi.fn(),
  updateFolderForUser: vi.fn(),
  deleteFolderForUser: vi.fn(),
}));

vi.mock("@/features/ontology/server/service", () => ({
  buildOntologyContext: (auth: WorkspaceAuthContext) => ({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
  }),
  updateObject: vi.fn(),
  deleteObject: vi.fn(),
  updateCluster: vi.fn(),
  deleteCluster: vi.fn(),
}));

import { DELETE as deleteKbBase } from "@/app/api/knowledge/bases/[baseId]/route";
import { DELETE as deleteKbFolder } from "@/app/api/knowledge/folders/[folderId]/route";
import { DELETE as deleteKbByPath } from "@/app/api/knowledge/bases/[baseId]/folders-by-path/route";
import { DELETE as deleteKbEntry } from "@/app/api/knowledge/entries/[entryId]/route";
import { DELETE as deleteSkillRoute } from "@/app/api/skills/[skillSlug]/route";
import { DELETE as deleteChatRoute } from "@/app/api/chats/[chatId]/route";
import { DELETE as deleteChatFolder } from "@/app/api/chats/folders/[folderId]/route";
import { DELETE as deleteOntologyObject } from "@/app/api/ontology/objects/[objectId]/route";
import { DELETE as deleteOntologyCluster } from "@/app/api/ontology/clusters/[clusterId]/route";

import * as knowledgeService from "@/features/knowledge/server/service";
import * as skillService from "@/features/skills/server/service";
import * as chatService from "@/features/chats/server/service";
import * as ontologyService from "@/features/ontology/server/service";

type Handler = (
  req: NextRequest,
  rc: { params: Promise<Record<string, string>> }
) => Promise<Response>;

/**
 * ⚠ THE MAP IS THE POINT OF THIS FILE. Left column: the delete op the MCP
 * surface must never publish. Right column: the REST door behind it. An op with
 * no row here is a promise with nothing behind it, and the census below fails
 * on one.
 */
const GATED: Array<{
  /** `<tool>.<op>` exactly as `DELETE_BLOCKED_OPS` spells it — DOMAIN tool. */
  refusedOps: string[];
  /** Path relative to `src/app/api`, as `write-gate-coverage.test.ts` keys them. */
  file: string;
  url: string;
  params: Record<string, string>;
  handler: Handler;
  /** The service call that must NOT fire for an agent token. */
  service: () => ReturnType<typeof vi.fn>;
}> = [
  {
    refusedOps: ["dopl_kb.delete_base"],
    file: "knowledge/bases/[baseId]/route.ts",
    url: "http://localhost/api/knowledge/bases/kb-1",
    params: { baseId: "kb-1" },
    handler: deleteKbBase as unknown as Handler,
    service: () => vi.mocked(knowledgeService.deleteBase),
  },
  {
    refusedOps: ["dopl_kb.delete_folder"],
    file: "knowledge/folders/[folderId]/route.ts",
    url: "http://localhost/api/knowledge/folders/f-1",
    params: { folderId: "f-1" },
    handler: deleteKbFolder as unknown as Handler,
    service: () => vi.mocked(knowledgeService.deleteFolder),
  },
  {
    // ⚠ THE SECOND DOOR ONTO THE SAME TWO ACTS, and the one easiest to miss:
    // `?path=` resolves to a folder OR an entry, so leaving it ungated would
    // have kept both refused ops reachable by name instead of by id.
    refusedOps: ["dopl_kb.delete_folder", "dopl_kb.delete_file"],
    file: "knowledge/bases/[baseId]/folders-by-path/route.ts",
    url: "http://localhost/api/knowledge/bases/kb-1/folders-by-path?path=notes",
    params: { baseId: "kb-1" },
    handler: deleteKbByPath as unknown as Handler,
    service: () => vi.mocked(knowledgeService.deleteByPath),
  },
  {
    refusedOps: ["dopl_kb.delete_file"],
    file: "knowledge/entries/[entryId]/route.ts",
    url: "http://localhost/api/knowledge/entries/e-1",
    params: { entryId: "e-1" },
    handler: deleteKbEntry as unknown as Handler,
    service: () => vi.mocked(knowledgeService.deleteEntry),
  },
  {
    refusedOps: ["dopl_skill.delete"],
    file: "skills/[skillSlug]/route.ts",
    url: "http://localhost/api/skills/my-skill",
    params: { skillSlug: "my-skill" },
    handler: deleteSkillRoute as unknown as Handler,
    service: () => vi.mocked(skillService.deleteSkill),
  },
  {
    refusedOps: ["dopl_chats.delete"],
    file: "chats/[chatId]/route.ts",
    url: "http://localhost/api/chats/c-1",
    params: { chatId: "c-1" },
    handler: deleteChatRoute as unknown as Handler,
    service: () => vi.mocked(chatService.deleteChat),
  },
  {
    refusedOps: ["dopl_chats.delete_folder"],
    file: "chats/folders/[folderId]/route.ts",
    url: "http://localhost/api/chats/folders/cf-1",
    params: { folderId: "cf-1" },
    handler: deleteChatFolder as unknown as Handler,
    service: () => vi.mocked(chatService.deleteFolderForUser),
  },
  {
    refusedOps: ["dopl_ontology.delete_object"],
    file: "ontology/objects/[objectId]/route.ts",
    url: "http://localhost/api/ontology/objects/o-1",
    params: { objectId: "o-1" },
    handler: deleteOntologyObject as unknown as Handler,
    service: () => vi.mocked(ontologyService.deleteObject),
  },
  {
    refusedOps: ["dopl_ontology.delete_cluster"],
    file: "ontology/clusters/[clusterId]/route.ts",
    url: "http://localhost/api/ontology/clusters/cl-1",
    params: { clusterId: "cl-1" },
    handler: deleteOntologyCluster as unknown as Handler,
    service: () => vi.mocked(ontologyService.deleteCluster),
  },
];

/**
 * `dopl_agent.delete` is the tenth op and is NOT in the table above because
 * `DELETE /api/agent-templates/[templateId]` has carried `sessionOnly` since
 * 2026-08-22 — it is pinned per-method by that route's own `route.test.ts`. The
 * census below reads it from here so a rename there fails loudly rather than
 * silently shrinking the map.
 */
const ALREADY_GATED_ELSEWHERE: Record<string, string> = {
  "dopl_agent.delete": "agent-templates/[templateId]/route.ts",
};

function req(url: string): NextRequest {
  return new NextRequest(url, { method: "DELETE" });
}

beforeEach(() => {
  vi.clearAllMocks();
  callerIsAgent = false;
  // The one route that answers with a BODY rather than 204 — give the mock a
  // serializable result so the session-caller case exercises the happy path
  // instead of the error envelope.
  vi.mocked(knowledgeService.deleteByPath).mockResolvedValue({
    deleted: "folder",
    id: "f-1",
  } as unknown as Awaited<ReturnType<typeof knowledgeService.deleteByPath>>);
});

describe("app-only deletion — the REST fence behind the MCP refusal", () => {
  for (const row of GATED) {
    describe(row.file, () => {
      it("refuses a `dopl_at_*` agent token with 403 SESSION_REQUIRED and deletes nothing", async () => {
        callerIsAgent = true;
        currentParams = row.params;

        const res = await row.handler(req(row.url), {
          params: Promise.resolve({}),
        });

        expect(res.status).toBe(403);
        expect((await res.json()).error.code).toBe("SESSION_REQUIRED");
        // ⚠ The refusal is at the DOOR: nothing downstream ran, so the delete
        // cannot half-happen.
        expect(row.service()).not.toHaveBeenCalled();
      });

      it("still lets a cookie session through — the app is where deleting happens", async () => {
        callerIsAgent = false;
        currentParams = row.params;

        const res = await row.handler(req(row.url), {
          params: Promise.resolve({}),
        });

        expect(res.status).not.toBe(403);
        expect(row.service()).toHaveBeenCalledOnce();
      });
    });
  }
});

describe("the census — every app-only delete op has a REST fence", () => {
  /**
   * Parsed out of the MCP package's SOURCE TEXT rather than imported, for the
   * reason `tools/parity-harness.ts` gives: the `src` vitest project does not
   * build `packages/`, and the parse follows the CONSTANT, not the filename.
   */
  function refusedOpsFromSource(): string[] {
    const src = readFileSync(
      path.join(REPO_ROOT, "packages/mcp-server/src/delete-policy.ts"),
      "utf8"
    );
    const block = /DELETE_BLOCKED_OPS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src);
    if (!block) throw new Error("DELETE_BLOCKED_OPS no longer parses out of delete-policy.ts");
    const out: string[] = [];
    const entry = /(\w+):\s*new Set\(\[([^\]]*)\]\)/g;
    let m: RegExpExecArray | null;
    while ((m = entry.exec(block[1])) !== null) {
      const tool = m[1];
      for (const q of m[2].matchAll(/"([^"]+)"/g)) out.push(`${tool}.${q[1]}`);
    }
    return out.sort();
  }

  it("parses a non-trivial op set (harness sanity check)", () => {
    expect(refusedOpsFromSource().length).toBeGreaterThan(5);
  });

  it("maps EVERY refused op onto a route this suite gates, or onto one gated elsewhere", () => {
    const covered = new Set<string>([
      ...GATED.flatMap((r) => r.refusedOps),
      ...Object.keys(ALREADY_GATED_ELSEWHERE),
    ]);
    const unfenced = refusedOpsFromSource().filter((op) => !covered.has(op));
    expect(
      unfenced,
      "these delete ops are declared app-only with NOTHING behind the claim — " +
        "map each to its REST route and give that route `sessionOnly: true`:\n  " +
        unfenced.join("\n  ")
    ).toEqual([]);
  });

  it("names no op that the MCP server no longer refuses", () => {
    const live = new Set(refusedOpsFromSource());
    const stale = [...GATED.flatMap((r) => r.refusedOps), ...Object.keys(ALREADY_GATED_ELSEWHERE)]
      .filter((op) => !live.has(op))
      .sort();
    expect(stale, "these rows claim to fence an op that is not in DELETE_BLOCKED_OPS").toEqual([]);
  });

  it("every mapped route file really carries `sessionOnly: true` in its CODE", () => {
    // ⚠ Comments stripped first, for `write-gate-coverage.test.ts`'s reason: a
    // docblock quoting the option would keep this green after the option went.
    for (const file of [
      ...GATED.map((r) => r.file),
      ...Object.values(ALREADY_GATED_ELSEWHERE),
    ]) {
      const src = readFileSync(path.join(API_ROOT, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(src, `${file} lost its sessionOnly gate`).toMatch(/sessionOnly:\s*true/);
    }
  });
});
