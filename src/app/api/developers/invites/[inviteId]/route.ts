import { withUserAuth } from "@/shared/auth/with-auth";
import { revokeInvite } from "@/features/device-sdk/server/portal-invites";
import { noStore, pathId, portalRoute } from "@/features/device-sdk/server/portal-http";

/** `DELETE /api/developers/invites/{inviteId}`: revoke an open invite. Owner or admin of its org. */
export const DELETE = withUserAuth(
  portalRoute("invites", async (_request, { userId, params }) => {
    await revokeInvite(userId, pathId(params?.inviteId, "Invite"));
    return noStore({ ok: true });
  }),
  { sessionOnly: true }
);
