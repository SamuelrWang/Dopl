import { withUserAuth } from "@/shared/auth/with-auth";
import { revokeInvite } from "@/features/device-sdk/server/portal-invites";
import { noStore, pathId, portalErrorResponse } from "@/features/device-sdk/server/portal-http";

/** `DELETE /api/developers/invites/{inviteId}` — revoke an open invite. Owner or admin of its org. */
export const DELETE = withUserAuth(
  async (_request, { userId, params }) => {
    try {
      await revokeInvite(userId, pathId(params?.inviteId, "Invite"));
      return noStore({ ok: true });
    } catch (err) {
      return portalErrorResponse("invites", err);
    }
  },
  { sessionOnly: true }
);
