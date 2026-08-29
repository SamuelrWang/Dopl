import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import KnowledgePage from "./index";
import KnowledgeDetailPage from "./detail";
import { WORKSPACE_ID } from "#/test-utils/bridge";

/**
 * Shared fixture + harness for the knowledge page suites (`./index.test.tsx` —
 * deep links and base detail; `./home.test.tsx` — the card grid). ⚠ One fake
 * for both: duplicating it lets the suites drift into testing different
 * servers.
 *
 * Mocked at `window.dopl` — the ONE seam both clients sit on. The SPA transport
 * picks the bridge over `fetch`, and so does the web `api-client` every reused
 * knowledge module (`client/api.ts`, `client/hooks.ts`) calls, so one fake
 * serves the whole tree and the request log is real wire traffic. Its presence
 * also puts reused components in desktop mode, where realtime/presence no-op.
 */

const USER_ID = "user-1";

const BASE_A = {
  id: "base-a",
  workspaceId: WORKSPACE_ID,
  name: "Product specs",
  slug: "product-specs",
  publicId: "aaaaaaaaaaaa",
  description: "What we ship",
  visibility: "private",
  accessMode: "workspace",
  agentWriteEnabled: false,
  createdBy: USER_ID,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};
const BASE_B = {
  ...BASE_A,
  id: "base-b",
  name: "Sales playbook",
  slug: "sales-playbook",
  publicId: "bbbbbbbbbbbb",
  description: "How we sell",
  createdBy: "user-2",
};

/**
 * 🔴 THE OTHER SHELF, AND IT IS IN THIS FIXTURE ON PURPOSE (Samuel's ruling
 * 2026-08-26). Same workspace, same owner, also private — the ONLY thing that
 * keeps it off this page is `?shelf=workspace`. A page that forgets the param
 * gets it, which is what makes `home.test.tsx`'s exclusion pin cost something.
 * ⚠ Never add it to the workspace rows below.
 */
const BASE_HOME_SHELF = {
  ...BASE_A,
  id: "base-home",
  name: "Home shelf notes",
  slug: "home-shelf-notes",
  publicId: "hhhhhhhhhhhh",
  description: "Kept on /home, not here",
};

const ENTRY_1 = {
  id: "entry-1",
  baseId: "base-b",
  folderId: null,
  title: "Cold outreach",
  slug: "cold-outreach",
  body: "# Cold outreach\n\nOpen with the problem.",
  excerpt: "Open with the problem.",
  position: 0,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-02T00:00:00Z",
};
const ENTRY_2 = {
  ...ENTRY_1,
  id: "entry-2",
  title: "Discovery call",
  slug: "discovery-call",
  body: "# Discovery call\n\nAsk about the pain.",
  position: 1,
};

const NEW_BASE = {
  ...BASE_A,
  id: "base-c",
  name: "Onboarding",
  slug: "onboarding",
  publicId: "cccccccccccc",
  description: null,
};

const requests: Array<{ path: string; method: string }> = [];
/** Base ids the fake server believes this user has starred. */
const starred = new Set<string>();

/**
 * ⚠ HELD star writes. An optimistic patch is only observably optimistic while
 * its request is STILL IN FLIGHT — against an instant fake, "patched on click"
 * and "patched on settle" give the same DOM. `defer` parks every star write
 * until `settleStarWrites` releases it.
 */
let starGate: Promise<"ok" | "fail"> | null = null;
let openStarGate: ((outcome: "ok" | "fail") => void) | null = null;

export function deferStarWrites(): void {
  starGate = new Promise((resolve) => {
    openStarGate = resolve;
  });
}

/** Release the held star write(s) as a success or a 500. */
export function settleStarWrites(outcome: "ok" | "fail"): void {
  openStarGate?.(outcome);
  starGate = null;
  openStarGate = null;
}
/** Set once the create POST lands, so the list refetch reflects it. */
let created: typeof NEW_BASE | null = null;
/** Set once the slug PATCH lands, so the list refetch reflects it. */
let renamedB: typeof BASE_B | null = null;
/** Set once the DELETE lands — hard delete, so the row never comes back. */
let deletedB = false;

function ok(body: unknown) {
  return { status: 200, statusText: "OK", hasBody: true, body };
}

const WORKSPACE = {
  id: WORKSPACE_ID,
  slug: "acme",
  publicId: "ab12cd34ef56",
  name: "Acme",
};

/**
 * ⚠ TAKES THE FULL PATH, QUERY INCLUDED, because `?shelf=` now CHANGES THE
 * ANSWER and a fake server that matched the bare path would serve both shelves
 * to every caller — i.e. pass while the separation is broken.
 */
function route(path: string) {
  const [bare, query] = path.split("?");
  const shelf = new URLSearchParams(query ?? "").get("shelf");
  // ONE read for workspace + role + caller id: `resolve`/`me` stay live, but
  // the boot answer is seeded into their cache entries.
  if (bare === "/api/boot") {
    return ok({
      isOnboarded: true,
      surveyCompleted: true,
      userId: USER_ID,
      workspace: WORKSPACE,
      segment: "acme-ab12cd34ef56",
      needsRedirect: false,
      role: "admin",
      myAccess: { defaultLevel: "edit", overrides: [] },
    });
  }
  if (bare.startsWith("/api/workspaces/resolve")) {
    return ok({
      workspace: WORKSPACE,
      canonical: "acme-ab12cd34ef56",
      needsRedirect: false,
    });
  }
  if (bare === "/api/workspaces/me") return ok({ role: "admin", userId: USER_ID });
  if (bare === "/api/knowledge/bases") {
    // The WORKSPACE shelf — what this page asks for. `created` lands here
    // because this page's create dialog sends no `homeScoped`.
    const workspaceShelf = [
      BASE_A,
      ...(deletedB ? [] : [renamedB ?? BASE_B]),
      ...(created ? [created] : []),
    ];
    // ⚠ ABSENT `shelf` = BOTH, mirroring the route (`?shelf=` absent means "no
    // filter"). This branch is the one a forgotten param falls into, and it is
    // what turns the exclusion pin from a tautology into a measurement.
    return ok({
      bases:
        shelf === "workspace"
          ? workspaceShelf
          : shelf === "home"
            ? [BASE_HOME_SHELF]
            : [...workspaceShelf, BASE_HOME_SHELF],
      ownerNames: { "user-2": "Dana Reed" },
      baseStats: {
        "base-a": { entryCount: 0, lastEntryUpdatedAt: null, storageBytes: 0 },
        "base-b": {
          entryCount: 2,
          lastEntryUpdatedAt: "2026-07-02T00:00:00Z",
          storageBytes: 1_250_000,
        },
        ...(created
          ? {
              "base-c": {
                entryCount: 0,
                lastEntryUpdatedAt: null,
                storageBytes: 0,
              },
            }
          : {}),
      },
      kbStorageLimit: 5_000_000,
      // Per-user stars, mutable: star routes below write it, so a refetch
      // reflects what the toggle SENT, not what the optimistic patch guessed.
      starredBaseIds: [...starred],
    });
  }
  if (bare === "/api/knowledge/bases/base-c/tree") {
    return ok({ base: created, folders: [], entries: [] });
  }
  if (bare.endsWith("/teams")) {
    return ok({
      teams: [
        {
          id: "team-1",
          name: "Revenue",
          color: "#f00",
          grants: [
            {
              teamId: "team-1",
              resourceType: "knowledge_base",
              resourceId: "base-b",
              level: "edit",
            },
          ],
          memberIds: [],
        },
      ],
    });
  }
  if (bare === "/api/knowledge/bases/base-b/tree") {
    // ⚠ A hard-deleted base's tree is GONE, not merely absent from the list.
    // Serving it would let a stale cache (or an eviction-triggered refetch)
    // repopulate content the delete destroyed, and the test would pass on a
    // fiction. See `evictDeletedBase`.
    if (deletedB) {
      return { status: 404, statusText: "Not Found", hasBody: true, body: { error: "Not found" } };
    }
    return ok({ base: BASE_B, folders: [], entries: [ENTRY_1, ENTRY_2] });
  }
  if (bare === "/api/knowledge/bases/base-a/tree") {
    return ok({ base: BASE_A, folders: [], entries: [] });
  }
  if (bare === "/api/knowledge/entries/entry-1") return ok({ entry: ENTRY_1 });
  if (bare === "/api/knowledge/entries/entry-2") return ok({ entry: ENTRY_2 });
  if (bare.startsWith("/api/members/my-access")) return ok({ resources: [] });
  if (bare === "/api/user/profile") return ok({ display_name: "Sam", email: "s@x.io" });
  return null;
}

const STAR_PATH = /^\/api\/knowledge\/bases\/([^/]+)\/star$/;

const apiRequest = vi.fn((path: string, opts?: { method?: string }) => {
  requests.push({ path, method: opts?.method ?? "GET" });
  const star = STAR_PATH.exec(path.split("?")[0]);
  if (star && (opts?.method === "PUT" || opts?.method === "DELETE")) {
    const wants = opts.method === "PUT";
    const apply = () => {
      if (wants) starred.add(star[1]);
      else starred.delete(star[1]);
      return ok({ starred: wants });
    };
    const fail = {
      status: 500,
      statusText: "Internal Server Error",
      hasBody: true,
      body: { error: { code: "INTERNAL_ERROR", message: "star write failed" } },
    };
    if (starGate) {
      return starGate.then((outcome) => (outcome === "fail" ? fail : apply()));
    }
    return Promise.resolve(apply());
  }
  if (path === "/api/knowledge/bases/base-b" && opts?.method === "PATCH") {
    renamedB = { ...BASE_B, slug: "playbook-v2" };
    return Promise.resolve({
      status: 200,
      statusText: "OK",
      hasBody: true,
      body: { base: renamedB },
    });
  }
  if (path === "/api/knowledge/bases/base-b" && opts?.method === "DELETE") {
    deletedB = true;
    return Promise.resolve({
      status: 204,
      statusText: "No Content",
      hasBody: false,
      body: null,
    });
  }
  if (path === "/api/knowledge/bases" && opts?.method === "POST") {
    created = NEW_BASE;
    return Promise.resolve({
      status: 201,
      statusText: "Created",
      hasBody: true,
      body: { base: NEW_BASE },
    });
  }
  const answer = route(path);
  if (!answer) return Promise.reject(new Error(`unexpected request: ${path}`));
  return Promise.resolve(answer);
});

export const paths = () => requests.map((r) => r.path);

/**
 * The base-list request THIS PAGE makes, query and all. ⚠ Assertions match the
 * FULL path: `?shelf=workspace` is what keeps the /home shelf off this surface
 * (Samuel's ruling 2026-08-26), so a suite that matched the bare path would go
 * green with the separation removed.
 */
export const WORKSPACE_BASES_PATH = "/api/knowledge/bases?shelf=workspace";

export const SEGMENT = "acme-ab12cd34ef56";
export const BASE_A_SEG = "product-specs-aaaaaaaaaaaa";
export const BASE_B_SEG = "sales-playbook-bbbbbbbbbbbb";
export const NEW_BASE_SEG = "onboarding-cccccccccccc";
export const RENAMED_B_SEG = "playbook-v2-bbbbbbbbbbbb";

/** Both knowledge rows, wired exactly as `routes.tsx` registers them. */
export function renderAt(entry: string) {
  const router = createMemoryRouter(
    [
      { path: "/:workspaceSegment/knowledge", element: <KnowledgePage /> },
      { path: "/:workspaceSegment/knowledge/:kbSlug", element: <KnowledgeDetailPage /> },
    ],
    { initialEntries: [entry] }
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}


/**
 * ⚠ Per-test reset + `window.dopl` bridge install; every suite calls this from
 * `beforeEach`. The fake server carries mutable state (created / renamed /
 * deleted) and a leaked flag silently changes the NEXT test's list answer.
 */
export function installKnowledgeBridge(): void {
  requests.length = 0;
  created = null;
  renamedB = null;
  deletedB = false;
  starred.clear();
  starGate = null;
  openStarGate = null;
  vi.stubGlobal("dopl", {
    apiRequest,
    getAuthState: () => Promise.resolve({ signedIn: true, userId: USER_ID }),
    onAuthState: () => () => {},
    openExternal: () => Promise.resolve({ ok: true }),
  });
  // ⚠ Nothing may reach the network; a call here is a bug, not a fallback.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network"))));
}
