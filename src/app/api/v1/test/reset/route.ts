import { NextResponse } from "next/server";
import { devSdkError } from "@/features/device-sdk/server/errors";
import { testResetStore } from "@/features/device-sdk/server/test-reset";
import { withDeveloperKey } from "@/features/device-sdk/server/with-developer-key";

export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/test/reset` — wipe the CALLING project's TEST env (end users, devices, connections,
 * connect sessions, actions, events, webhook outbox) so CI starts clean (A6).
 *
 * ⚠ CONTRACT GAP: not in `openapi.yaml` (frozen) nor in `@dopl/sdk`; pending Samuel's ruling
 * (`features/device-sdk/server/test-reset.ts`). Secret `sk_test_` keys only: `pk_` is refused by
 * `withDeveloperKey` (no `publishable` opt-in), `sk_live_` here. The key must carry `connect` and
 * `actions:write`, the scopes that create what it deletes.
 */
export const POST = withDeveloperKey(
  async (_request, ctx) => {
    ctx.event.setRouteDecision({ target: "test_env", reason: "test reset", candidates: [] });
    if (ctx.env !== "test" || ctx.key.kind !== "secret") {
      return devSdkError("insufficient_scope", "Test reset needs a secret test key (sk_test_…). Live data is never reset.");
    }
    const deleted = await testResetStore().resetTestEnv(ctx.projectId);
    return NextResponse.json({ ok: true, project_id: ctx.projectId, env: "test", deleted });
  },
  { scopes: ["connect", "actions:write"] }
);
