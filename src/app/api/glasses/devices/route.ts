import { withUserAuth } from "@/shared/auth/with-auth";
import { userHandlers } from "@/features/glasses/glasses-runtime";

/** The caller's paired glasses (docs/glasses-mcp.md). */
export const dynamic = "force-dynamic";

export const GET = withUserAuth((_request, { userId }) => userHandlers.list(userId));
