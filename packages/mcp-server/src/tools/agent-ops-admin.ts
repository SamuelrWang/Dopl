/**
 * `dopl_agent_admin` DESTRUCTIVE op handler: delete. Routed from the registrar
 * in `agent.ts`.
 *
 * UNREACHABLE BY CONSTRUCTION, twice over: `delete-policy.ts ›
 * DELETE_BLOCKED_OPS` names it, and `DELETE_OP_SHAPE` would refuse it anyway on
 * the name alone — and `DELETE /api/agent-templates/{id}` is additionally
 * `sessionOnly`, so even the loopback would 403. **Doubly refused, and the tool
 * exists so the refusal is discoverable** — an absent tool reads as a broken
 * connection and gets retried, where a refusal naming the app is acted on.
 *
 * ⚠ THE HANDLER STAYS HONEST ANYWAY. Nothing here can run today, and it is kept
 * so the capability would return by removing a gate rather than by writing new
 * handlers — which is exactly why its narration must not promise a delete this
 * package cannot perform. There is no `deleteAgentTemplate` on `@dopl/client`
 * (deliberately unbound), so this op has nothing to call: it names the app.
 */

import type { DoplClient } from "@dopl/client";
import { err, type ToolResponse } from "./respond.js";
import { inlineOr } from "./narration.js";
import { NO_NAME } from "./agent-shared.js";

export async function opDelete(
  _client: DoplClient,
  ref: string,
): Promise<ToolResponse> {
  // ⚠ NO RESOLUTION FIRST. Looking the template up before refusing would spend
  // a round trip and, worse, would make the refusal's wording depend on whether
  // the ref existed — which is an existence oracle behind a refusal that is
  // supposed to be unconditional.
  return err(
    `Nothing was deleted. Deleting an agent template is app-only: it is permanent (no trash, no restore), it destroys an identity a whole team may be launching from, and an MCP call has no confirmation dialog at the moment the row goes. Ask the user to delete ${inlineOr(ref, NO_NAME)} in the Dopl app. Do not retry with different parameters — no role, scope or argument changes this. To take a template out of use without destroying it, dopl_agent(op="update", visibility="private") removes everyone else's access to it.`,
  );
}
