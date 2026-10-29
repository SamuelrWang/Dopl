import { withUserAuth } from "@/shared/auth/with-auth";
import { revokeProjectKey } from "@/features/device-sdk/server/portal-admin";
import { noStore, pathId, portalErrorResponse } from "@/features/device-sdk/server/portal-http";

/**
 * `DELETE /api/developers/keys/{keyId}` — revoke a key now. Owner or admin of its project; a key
 * the caller cannot see is 404; an already revoked key is 409 `KEY_REVOKED`.
 */
export const DELETE = withUserAuth(
  async (_request, { userId, params }) => {
    try {
      await revokeProjectKey(userId, pathId(params?.keyId, "Key"));
      return noStore({ ok: true });
    } catch (err) {
      return portalErrorResponse("keys/revoke", err);
    }
  },
  { sessionOnly: true }
);
