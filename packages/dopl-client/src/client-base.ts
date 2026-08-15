/**
 * THE FIRST LINK of `DoplClient`'s per-domain method-group chain.
 *
 * This class owns construction and the transport-level accessors, NOTHING
 * else. Each domain contributes one `client-<domain>.ts` method group
 * extending the previous link; `client.ts` is the terminal `DoplClient`. The
 * chain keeps every file under the 500-line cap while `DoplClient` stays a
 * SINGLE class with one flat, unchanged public surface.
 *
 * THE CHAIN, in order — ⚠ the only place the whole order is written down; each
 * link names only its own predecessor:
 *
 *   DoplClientBase        (here)
 *     → WorkspaceMethods  client-workspaces.ts
 *     → KnowledgeMethods  client-knowledge.ts
 *     → OntologyMethods   client-ontology.ts
 *     → ChatMethods       client-chats.ts
 *     → MemberMethods     client-members.ts
 *     → ChannelMethods    client-channels.ts
 *     → SkillMethods      client-skills.ts
 *     → BillingMethods    client-billing.ts
 *     → DoplClient        client.ts
 *
 * Order carries NO meaning — no link may depend on a sibling's methods, only
 * on `this.transport`. Inserting a domain means editing two files (the new
 * link and the one that used to extend its predecessor) and this comment.
 */

import { DoplTransport } from "./transport.js";

export class DoplClientBase {
  /**
   * ⚠ PROTECTED, not private, and it stays that way: the hook every
   * per-domain method group in the chain above reads.
   */
  protected transport: DoplTransport;

  constructor(
    baseUrl: string,
    apiKey: string,
    opts: ConstructorParameters<typeof DoplTransport>[2] = {}
  ) {
    this.transport = new DoplTransport(baseUrl, apiKey, opts);
  }

  getBaseUrl(): string {
    return this.transport.getBaseUrl();
  }

  /** Active canvas. Set → every request carries `X-Workspace-Id`. Null clears. */
  setWorkspaceId(workspaceId: string | null): void {
    this.transport.setWorkspaceId(workspaceId);
  }

  getWorkspaceId(): string | null {
    return this.transport.getWorkspaceId();
  }
}
