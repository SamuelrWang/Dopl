import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { KeyNotRotatableError, rotateApiKey } from "@/features/device-sdk/server/keys";
import { getKeyProject, listPortalProjects } from "@/features/device-sdk/server/portal";
import { refuseInternalUnlessOwner, refuseLockedKey } from "@/features/device-sdk/server/portal-admin";
import { canManageKeys } from "@/features/device-sdk/portal/scope";

/** How long the old secret keeps working, in hours. The only values the portal offers. */
const GRACE_HOURS = [0, 1, 24];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `POST /api/developers/keys/{keyId}/rotate` — the developer portal's Rotate button (W1.3).
 *
 * Mints a replacement with the same env, kind and scopes and gives the old key the default
 * overlap window (`keys.ts › rotateApiKey`). The response carries the new raw key ONCE; it is
 * never stored or logged, and `no-store` keeps it out of every cache.
 *
 * ⚠ `sessionOnly`: this mints a credential, so an agent's OAuth token is refused (the
 * credential-minting class in `write-gate-coverage.test.ts`). ⚠ Reach is checked HERE: the key's
 * project must be one of the caller's (`listPortalProjects`) with an owner or admin role. A key
 * the caller cannot see answers 404, the same as one that does not exist. A revoked, expired or
 * already-rotating key answers 409 (`KEY_REVOKED` / `KEY_EXPIRED` / `KEY_ROTATING`).
 */
export const POST = withUserAuth(
  async (request, { userId, params }) => {
    try {
      const keyId = params?.keyId ?? "";
      if (!UUID.test(keyId)) throw new HttpError(404, "NOT_FOUND", "Key not found");

      const [key, projects] = await Promise.all([getKeyProject(keyId), listPortalProjects(userId)]);
      const project = key ? projects.find((p) => p.id === key.projectId) : undefined;
      if (!key || !project) throw new HttpError(404, "NOT_FOUND", "Key not found");
      if (!canManageKeys(project.role)) {
        throw new HttpError(403, "FORBIDDEN", "Only an org owner or admin can rotate keys");
      }
      refuseInternalUnlessOwner(project);
      // Only a live, never-rotated key rotates: an expired key would mint a working credential off
      // a dead one; a key in its overlap window would get a second live replacement. The same
      // refusals hold atomically inside `rotateApiKey` (the check→rotate race lands there).
      if (key.revokedAt) throw new KeyNotRotatableError("KEY_REVOKED", "A revoked key cannot be rotated");
      if (key.expiresAt && Date.parse(key.expiresAt) <= Date.now()) {
        throw new KeyNotRotatableError("KEY_EXPIRED", "An expired key cannot be rotated");
      }
      if (key.expiresAt) throw new KeyNotRotatableError("KEY_ROTATING", "This key is already being rotated");

      await refuseLockedKey(project, keyId);
      const body = (await request.json().catch(() => null)) as { grace_hours?: unknown } | null;
      const grace = body?.grace_hours;
      if (grace !== undefined && !GRACE_HOURS.includes(grace as number)) throw new HttpError(400, "BAD_REQUEST", "grace_hours must be 0, 1 or 24");
      const rotated = await rotateApiKey({ projectId: project.id, keyId, overlapMs: grace === undefined ? undefined : (grace as number) * 3_600_000 });
      return NextResponse.json(
        { secret: rotated.secret, key: rotated.key, previous: rotated.previous },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch (err) {
      return toHttpErrorResponse("developers/keys/rotate", err, (e) =>
        e instanceof KeyNotRotatableError ? new HttpError(409, e.code, e.message) : null
      );
    }
  },
  { sessionOnly: true }
);
