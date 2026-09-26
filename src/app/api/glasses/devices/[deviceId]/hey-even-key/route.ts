import { withUserAuth } from "@/shared/auth/with-auth";
import { glassesSessionOnly, userHandlers } from "@/features/glasses/glasses-runtime";

/** Rotate a device's Hey Even key; the key and URL are returned once (docs/glasses-mcp.md). */
export const dynamic = "force-dynamic";

export const POST = withUserAuth(
  (request, { userId, params }) => userHandlers.rotateHeyEvenKey(request, userId, params?.deviceId ?? ""),
  { sessionOnly: glassesSessionOnly() },
);
