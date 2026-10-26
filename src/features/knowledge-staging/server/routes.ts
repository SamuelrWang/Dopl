/**
 * The staged API: every `/api/**` route the /home Knowledge face calls through `apiRequest`,
 * answered from the in-memory DB (`../fake-store.ts`). A handler's value is the route's JSON body;
 * `undefined` is a 204. The export download is a plain `fetch`, not `apiRequest`, so it has no
 * route here.
 */
import * as bases from "./bases";
import * as entries from "./entries";
import * as extras from "./extras";
import * as people from "./people";

export interface FakeRequest {
  method: string;
  /** The path's `:param` captures, in order. */
  params: string[];
  query: URLSearchParams;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the request body as each route's schema reads it
  body: any;
  workspaceId: string | undefined;
}

type Handler = (req: FakeRequest) => unknown;

const ROUTES: Array<[method: string, pattern: string, handler: Handler]> = [
  ["GET", "/api/knowledge/bases", (r) => bases.listBases(r.workspaceId, r.query.get("channelId"))],
  ["POST", "/api/knowledge/bases", (r) => bases.createBase(r.body, r.workspaceId)],
  ["PATCH", "/api/knowledge/bases/:id", (r) => bases.updateBase(r.params[0], r.body)],
  ["DELETE", "/api/knowledge/bases/:id", (r) => bases.deleteBase(r.params[0])],
  ["PUT", "/api/knowledge/bases/:id/star", (r) => bases.setStar(r.params[0], true)],
  ["DELETE", "/api/knowledge/bases/:id/star", (r) => bases.setStar(r.params[0], false)],
  ["GET", "/api/knowledge/bases/:id/channel-grants", (r) => bases.channelGrants(r.params[0])],
  ["PUT", "/api/knowledge/bases/:id/channel-grants", (r) => bases.setChannelGrant(r.params[0], r.body)],
  ["GET", "/api/knowledge/bases/:id/tree", (r) => bases.tree(r.params[0])],
  ["GET", "/api/knowledge/bases/:id/revisions", (r) => extras.baseRevisions(r.params[0], r.query.get("cursor"))],
  ["POST", "/api/knowledge/bases/:id/folders", (r) => entries.createFolder(r.params[0], r.body, r.workspaceId)],
  ["POST", "/api/knowledge/bases/:id/entries", (r) => entries.createEntry(r.params[0], r.body, r.workspaceId)],
  ["PATCH", "/api/knowledge/folders/:id", (r) => entries.updateFolder(r.params[0], r.body)],
  ["DELETE", "/api/knowledge/folders/:id", (r) => entries.deleteFolder(r.params[0])],
  ["POST", "/api/knowledge/folders/:id/move", (r) => entries.moveFolder(r.params[0], r.body)],
  ["GET", "/api/knowledge/entries/:id", (r) => entries.getEntry(r.params[0])],
  ["PATCH", "/api/knowledge/entries/:id", (r) => entries.updateEntry(r.params[0], r.body)],
  ["DELETE", "/api/knowledge/entries/:id", (r) => entries.deleteEntry(r.params[0])],
  ["POST", "/api/knowledge/entries/:id/move", (r) => entries.moveEntry(r.params[0], r.body)],
  ["GET", "/api/knowledge/entries/:id/revisions", (r) => extras.entryRevisions(r.params[0], r.query.get("cursor"))],
  [
    "POST",
    "/api/knowledge/entries/:id/revisions/:id/restore",
    (r) => extras.restoreRevision(r.params[0], r.params[1]),
  ],
  [
    "GET",
    "/api/knowledge/search",
    (r) => extras.search(r.query.get("q") ?? "", r.query.get("base"), Number(r.query.get("limit") ?? 10)),
  ],
  ["GET", "/api/workspaces/:id/teams", () => people.teams()],
  ["GET", "/api/workspaces/:id/my-access", () => people.myAccess()],
  ["GET", "/api/channels/:id/members", (r) => people.channelMembers(r.params[0])],
];

/** The handler for one request, with its `:param` captures, or `null` for a route staging does not serve. */
export function matchRoute(method: string, pathname: string): { handler: Handler; params: string[] } | null {
  const parts = pathname.split("/");
  for (const [m, pattern, handler] of ROUTES) {
    if (m !== method) continue;
    const want = pattern.split("/");
    if (want.length !== parts.length) continue;
    const params: string[] = [];
    if (
      want.every((seg, i) => {
        if (seg === ":id") {
          params.push(decodeURIComponent(parts[i]));
          return true;
        }
        return seg === parts[i];
      })
    ) {
      return { handler, params };
    }
  }
  return null;
}
