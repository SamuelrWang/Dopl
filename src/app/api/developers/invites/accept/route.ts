import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import { acceptInvite } from "@/features/device-sdk/server/portal-invites";
import { noStore, portalRoute, readJsonObject } from "@/features/device-sdk/server/portal-http";

/**
 * `POST /api/developers/invites/accept`: join an org from an invite. Body `{ token }` (in the
 * body, never the URL, so it stays out of access logs). The caller's confirmed email must equal
 * the invite's.
 */
export const POST = withUserAuth(
  portalRoute("invites/accept", async (request, { userId }) => {
    const body = await readJsonObject(request);
    if (typeof body.token !== "string") throw new HttpError(400, "BAD_REQUEST", "token is required");
    return noStore(await acceptInvite(userId, body.token));
  }),
  { sessionOnly: true }
);
