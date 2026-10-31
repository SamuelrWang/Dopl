import { withUserAuth } from "@/shared/auth/with-auth";
import { revokeProjectKey } from "@/features/device-sdk/server/portal-admin";
import { noStore, pathId, portalRoute } from "@/features/device-sdk/server/portal-http";

/** `DELETE /api/developers/keys/{keyId}`: revoke a key now. Rules: `portal-admin.ts`. */
export const DELETE = withUserAuth(
  portalRoute("keys/revoke", async (_request, { userId, params }) => {
    await revokeProjectKey(userId, pathId(params?.keyId, "Key"));
    return noStore({ ok: true });
  }),
  { sessionOnly: true }
);
