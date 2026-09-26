import { withUserAuth } from "@/shared/auth/with-auth";
import { userHandlers } from "@/features/glasses/glasses-runtime";

/** Claim the code a pair of glasses is showing (docs/glasses-mcp.md). */
export const dynamic = "force-dynamic";

export const POST = withUserAuth((request, { userId }) => userHandlers.claim(request, userId));
