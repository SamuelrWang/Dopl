/**
 * `DoplClient` — the shared HTTP client for the Dopl API, consumed by
 * `@dopl/mcp-server` and the app.
 *
 * THIS FILE IS NOW THE TERMINAL LINK of a per-domain method-group chain, not
 * the whole facade. It was 720 lines carrying every method of every domain,
 * 220 over §2's 500-line hard cap and the longest-running row in that
 * section's table; §2 had been scheduling exactly this split since the
 * `ChannelAgentsClient` link was deleted in the channels rollback.
 *
 * NOTHING PUBLIC MOVED. `DoplClient` is still one class with one flat method
 * surface — the methods are declared in the chain's links instead of here,
 * and inheritance flattens them back onto the same instance. Callers import
 * the same class from the same entry point and call the same methods with the
 * same signatures. See `client-base.ts` for the chain and its ordering rules;
 * the domain method groups are the `client-<domain>.ts` files, and the HTTP
 * itself lives in the free-function modules they delegate to (`clusters.ts`,
 * `workflows.ts`, `workspaces.ts`, `knowledge.ts`, `ontology.ts`, `chats.ts`,
 * `members.ts`, `channel.ts`, `skills.ts`).
 *
 * ADD NOTHING TO THIS FILE. A new method belongs in its domain's link — or in
 * a new link, added per the rules in `client-base.ts`. The whole point of the
 * split is that this file stops being where methods accumulate.
 */
import { SkillMethods } from "./client-skills.js";
export type { DoplTransportOptions as DoplClientOptions } from "./transport.js";
export { parseRetryAfter } from "./retry.js";
export declare class DoplClient extends SkillMethods {
}
