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
import { type ToolResponse } from "./respond.js";
export declare function opDelete(_client: DoplClient, ref: string): Promise<ToolResponse>;
