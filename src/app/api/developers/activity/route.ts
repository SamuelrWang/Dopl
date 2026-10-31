import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import { isUuid } from "@/shared/lib/id/uuid";
import { FEED_LIMIT, readCalls, type CallsQuery } from "@/features/device-sdk/server/portal-activity";
import { requireProject } from "@/features/device-sdk/server/portal-admin";
import { noStore, parseEnv, portalRoute } from "@/features/device-sdk/server/portal-http";

const MAX_OPEN = 50;

function moment(value: string | null): string | undefined {
  if (value === null) return undefined;
  const at = Date.parse(value);
  if (Number.isNaN(at)) throw new HttpError(400, "BAD_REQUEST", "Expected a time");
  return new Date(at).toISOString();
}

/**
 * `GET /api/developers/activity?project&env`: part of a project's feed, for any of its members, the same reach as
 * the Activity page. `since` and `open` (ids still moving) are the live poll; `before` is an older page; `user` is
 * one user's calls. A project the caller cannot see reads 404.
 */
export const GET = withUserAuth(
  portalRoute("activity", async (request, { userId }) => {
    const q = new URL(request.url).searchParams;
    const env = parseEnv(q.get("env"));
    const project = await requireProject(userId, q.get("project") ?? "");
    const source = q.get("source");
    const limit = Math.min(Math.max(Number(q.get("limit")) || FEED_LIMIT, 1), FEED_LIMIT);
    const base: CallsQuery = { projectId: project.id, env, internal: project.org.internal, limit, source: source === "webhooks" || source === "devices" ? source : undefined };
    const open = (q.get("open") ?? "").split(",").filter(isUuid).slice(0, MAX_OPEN);
    const [calls, moved] = await Promise.all([
      readCalls({ ...base, since: moment(q.get("since")), before: moment(q.get("before")), userId: q.get("user") ?? undefined }),
      open.length > 0 ? readCalls({ ...base, ids: open }) : [],
    ]);
    return noStore({ calls: [...calls, ...moved], now: new Date().toISOString() });
  }),
  { sessionOnly: true }
);
