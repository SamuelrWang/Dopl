import { withUserAuth } from "@/shared/auth/with-auth";
import { rotateProjectKey } from "@/features/device-sdk/server/portal-admin";
import { noStore, pathId, portalRoute } from "@/features/device-sdk/server/portal-http";

/**
 * `POST /api/developers/keys/{keyId}/rotate`: the portal's Rotate button. Body `{ grace_hours? }`. The response
 * carries the new raw key ONCE, `no-store`. ⚠ `sessionOnly`: this mints a credential, so an agent's OAuth token
 * is refused. Reach and refusals: `portal-admin.ts › rotateProjectKey`.
 */
export const POST = withUserAuth(
  portalRoute("keys/rotate", async (request, { userId, params }) => {
    const keyId = pathId(params?.keyId, "Key");
    const body = (await request.json().catch(() => null)) as { grace_hours?: unknown } | null;
    const rotated = await rotateProjectKey(userId, keyId, body?.grace_hours);
    return noStore({ secret: rotated.secret, key: rotated.key, previous: rotated.previous });
  }),
  { sessionOnly: true }
);
