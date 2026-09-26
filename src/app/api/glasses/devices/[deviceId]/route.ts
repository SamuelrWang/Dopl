import { withUserAuth } from "@/shared/auth/with-auth";
import { userHandlers } from "@/features/glasses/glasses-runtime";

/** Rename / link a channel (PATCH) or revoke (DELETE) one paired device (docs/glasses-mcp.md). */
export const dynamic = "force-dynamic";

export const PATCH = withUserAuth((request, { userId, params }) =>
  userHandlers.patch(request, userId, params?.deviceId ?? ""),
);
export const DELETE = withUserAuth((_request, { userId, params }) =>
  userHandlers.revoke(userId, params?.deviceId ?? ""),
);
