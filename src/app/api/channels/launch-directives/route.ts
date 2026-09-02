import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import { LaunchCreateSchema } from "@/features/channels/schema";
import {
  buildChannelContext,
  createLaunchDirective,
  listPendingLaunchDirectives,
} from "@/features/channels/server/service";

/**
 * FILE A LAUNCH DIRECTIVE — an operator's own agent asking that operator's own
 * desktop to start an agent in a channel (Samuel's ruling, 2026-08-22: approved,
 * with a local desktop toggle as the consent).
 *
 * ⚠ **THE OPERATOR IS `ctx.userId` AND THERE IS NO BODY FIELD FOR IT.** An agent
 * may ask its own machine and no other; the way that stays true is that no
 * schema and no service signature on this path accepts an operator id.
 *
 * ⚠ **NOT `sessionOnly`, DELIBERATELY, AND THAT IS THE WHOLE POINT OF THE
 * FEATURE.** The caller here IS an agent token — an external Claude Desktop /
 * Claude Code session over MCP. Gating this to a cookie session would make the
 * op unreachable by the only caller it exists for. The consent that replaces the
 * session gate is Samuel's: a LOCAL TOGGLE on the desktop, enforced by the
 * machine that would run the agent, which refuses with `no-bridge` when it is
 * off. ⚠ That is a real trade and it is stated rather than buried: the server
 * cannot verify the toggle, so the server is not the gate — the desktop is, and
 * the desktop is the only party that can be.
 *
 * ⚠ `minRole` stays at the viewer floor because the CHANNEL fence is the real
 * one: the service requires a MEMBERSHIP ROW, not merely readability, so a
 * public channel the caller never joined is refused (see `service-launch.ts ›
 * createLaunchDirective`).
 *
 * ⚠ A DIRECTIVE IS NOT A MESSAGE and never touches `channel_messages` — the loop
 * brake and transcript purity, INVARIANTS §5.
 */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, LaunchCreateSchema);
    const ctx = buildChannelContext(auth);
    const result = await createLaunchDirective(ctx, {
      channel: input.channel,
      threadId: input.threadId,
      goal: input.goal,
      model: input.model,
      // ⚠ A REF (id OR exact name), resolved in the service under THIS caller's
      // visibility. An ambiguous name is a 409 `AGENT_TEMPLATE_AMBIGUOUS` whose
      // `details.matches` lists every row the caller can already see; an
      // unresolvable one is a 404 `AGENT_TEMPLATE_NOT_FOUND`, the same code and
      // the same shape `/api/agent-templates/[id]/resolve` answers.
      template: input.template,
      // ⚠ **THE POSTURE IS PASSED THROUGH AND IS NOT A GRANT** (T24, 2026-09-01).
      // The two axes and the chain are a REQUEST: the operator's machine clamps
      // each axis to that operator's own stored channel posture and REFUSES a
      // chain the channel forbids (`main/launch-posture.js › resolveLaunch`).
      // ⚠ THE SERVER CANNOT VERIFY THAT ANY MORE THAN IT CAN VERIFY THE TOGGLE
      // ABOVE — the ceiling is an `electron-store` record — which is exactly why
      // nothing here tries, and why no operator carve-out may be added.
      tools: input.tools,
      messages: input.messages,
      // ⚠ NOT COLLAPSED WITH `||` — the row is a faithful record of what was
      // sent. ⚠ It is NOT a promise that `false` does anything: the desktop's
      // narrower reads only `true`, so a `false` resolves there exactly as an
      // omission does (`schema-launch.ts › chain` carries the measurement).
      chain: input.chain,
    });
    // ⚠ 200 WITH `offline: true`, NOT AN ERROR STATUS. Nothing failed: the
    // server looked, the operator's machine is not listening, and NO ROW WAS
    // CREATED. A 4xx/5xx here would make the MCP op render a fault for the most
    // ordinary outcome there is (a closed laptop), and `isNotFound`-style
    // classifiers would mis-handle it.
    return NextResponse.json(result);
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

/**
 * **THE BREAKER-OPEN BACKSTOP READ** — what is still awaiting this operator's
 * decision in this workspace (F-273, filed by the desktop lane and resolved
 * here).
 *
 * ⚠ WHY IT HAD TO EXIST: realtime is the delivery path, and a desktop that was
 * asleep, reconnecting, or whose subscription went unhealthy never sees the
 * INSERT frame. The desktop already had the poll loop; there was no route under
 * it, so its backstop self-disabled on the first 404 and logged the gap. Without
 * this, a directive missed by realtime can only expire.
 *
 * ⚠ OPERATOR-SCOPED EXACTLY LIKE THE REST — `operator_user_id = ctx.userId`, in
 * the SQL predicate rather than a branch above it. This is a LIST, so the fence
 * matters more than on the by-id read: an unfenced version would hand every
 * device token the workspace's whole launch history.
 *
 * ⚠ RETURNS `pending` AND `claimed`, EXPIRED DROPPED. A machine that claimed and
 * crashed must find its own row again; expiry is applied by the service, where
 * the lazy rule has its one home.
 *
 * ⚠ ENVELOPE IS `{ directives }` — the desktop reads `body.directives ||
 * body.rows` (`main/launch-directives.js › pollWorkspace`), so either name works
 * and this picks the one that says what it is.
 */
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const directives = await listPendingLaunchDirectives(ctx);
    return NextResponse.json({ directives });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost);
